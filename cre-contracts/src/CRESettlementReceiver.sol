// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.29;

import {UniJar} from "unijar/UniJar.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";

/// @notice Restricted delivery of existing permissionless UniJar auction exits.
/// @dev Simulation-only instances trust a mock forwarder, NOT a production DON.
/// No sale terms, recipients, token approvals or refund calls can be supplied.
contract CRESettlementReceiver is IReceiver {
    uint8 public constant FINALIZE_AUCTION = 1;
    uint8 public constant RECOVER_UNSOLD = 2;

    struct Settings {
        address releaser;
        bytes32 releaserCodeHash;
        uint256 chainId;
        address forwarder;
        bool simulationOnly;
        bytes32 workflowId;
        bytes10 workflowName;
        address workflowOwner;
        address automationAdmin;
        bytes32 sourceId;
        uint32 maxReportAge;
        uint16 maxBlockLag;
        uint32 actionGasLimit;
        uint256 maxGasPriceWei;
    }
    struct ActionReport {
        uint256 chainId;
        address releaser;
        uint256 lotId;
        uint8 action;
        uint8 expectedState;
        uint64 expectedExpiry;
        uint64 observedBlock;
        bytes32 observedBlockHash;
        uint64 observedAt;
        uint64 deadline;
        bytes32 requestId;
        bytes32 sourceId;
        bytes32 sourceDataHash;
        uint64 externalObservedAt;
        uint256 gasPriceWei;
    }

    UniJar public immutable releaser;
    bytes32 public immutable releaserCodeHash;
    uint256 public immutable expectedChainId;
    address public immutable forwarder;
    bytes32 public immutable forwarderCodeHash;
    bool public immutable simulationOnly;
    bytes32 public immutable workflowId;
    bytes10 public immutable workflowName;
    address public immutable workflowOwner;
    address public immutable automationAdmin;
    bytes32 public immutable sourceId;
    uint32 public immutable maxReportAge;
    uint16 public immutable maxBlockLag;
    uint32 public immutable actionGasLimit;
    uint256 public immutable maxGasPriceWei;
    bool public automationPaused;
    mapping(bytes32 => bool) public processed;
    bool private entered;

    error InvalidConfiguration();
    error UnauthorizedForwarder();
    error WorkflowIdentityMismatch();
    error AutomationPaused();
    error InvalidReport();
    error StaleReport();
    error ReorgedObservation();
    error AlreadyProcessed();
    error IneligibleLot();
    error InsufficientDeliveryGas();
    error ActionFailed();
    error ReentrantCall();
    error UnauthorizedAdmin();

    event AutomationPauseSet(bool paused);
    event CREActionExecuted(uint256 indexed lotId, uint8 indexed action, bytes32 indexed requestId,
        uint8 resultingState, uint256 txBlock, bytes32 sourceId, bytes32 sourceDataHash,
        uint64 externalObservedAt, uint256 gasPriceWei);

    constructor(Settings memory s) {
        if (s.chainId != block.chainid || (s.chainId != 31337 && s.chainId != 11155111)
            || s.releaser.code.length == 0 || s.releaser.codehash != s.releaserCodeHash
            || s.forwarder.code.length == 0 || s.automationAdmin == address(0)
            || s.sourceId == bytes32(0) || s.maxReportAge < 30 || s.maxReportAge > 3600
            || s.maxBlockLag == 0 || s.maxBlockLag > 255
            || s.actionGasLimit < 100000 || s.actionGasLimit > 500000
            || s.maxGasPriceWei == 0 || s.maxGasPriceWei > 1000 gwei) revert InvalidConfiguration();
        if (s.simulationOnly) {
            if (s.workflowId != bytes32(0) || s.workflowName != bytes10(0) || s.workflowOwner != address(0)) revert InvalidConfiguration();
        } else if (s.workflowId == bytes32(0) || s.workflowName == bytes10(0) || s.workflowOwner == address(0)) revert InvalidConfiguration();
        if (UniJar(s.releaser).operator() != s.automationAdmin) revert InvalidConfiguration();
        releaser = UniJar(s.releaser); releaserCodeHash = s.releaserCodeHash;
        expectedChainId = s.chainId; forwarder = s.forwarder; forwarderCodeHash = s.forwarder.codehash;
        simulationOnly = s.simulationOnly; workflowId = s.workflowId;
        workflowName = s.workflowName; workflowOwner = s.workflowOwner;
        automationAdmin = s.automationAdmin; sourceId = s.sourceId;
        maxReportAge = s.maxReportAge; maxBlockLag = s.maxBlockLag;
        actionGasLimit = s.actionGasLimit; maxGasPriceWei = s.maxGasPriceWei;
    }

    function supportsInterface(bytes4 id) external pure override returns (bool) {
        // IReceiver's onReport selector and ERC165 are advertised separately.
        return id == type(IReceiver).interfaceId || id == 0x01ffc9a7;
    }

    function setAutomationPaused(bool value) external {
        if (msg.sender != automationAdmin) revert UnauthorizedAdmin();
        automationPaused = value; emit AutomationPauseSet(value);
    }

    /// @notice EVM-capability context, including BASEFEE absent from CRE Header.
    function readContext() external view returns (uint256 chainId, uint256 blockNumber,
        uint256 observedAt, uint256 baseFeeWei, bytes32 currentReleaserCodeHash, uint256 activeId) {
        return (block.chainid, block.number, block.timestamp, block.basefee,
            address(releaser).codehash, releaser.activeId());
    }

    function onReport(bytes calldata metadata, bytes calldata encoded) external override {
        if (msg.sender != forwarder || msg.sender.codehash != forwarderCodeHash) revert UnauthorizedForwarder();
        if (entered) revert ReentrantCall();
        if (automationPaused) revert AutomationPaused();
        if (!simulationOnly) _authenticate(metadata);
        // The fixed-width ABI report must contain exactly 15 words.
        if (encoded.length != 15 * 32) revert InvalidReport();
        ActionReport memory r = abi.decode(encoded, (ActionReport));
        if (r.chainId != expectedChainId || block.chainid != expectedChainId
            || r.releaser != address(releaser) || address(releaser).codehash != releaserCodeHash
            || r.lotId == 0 || r.requestId == bytes32(0) || r.sourceId != sourceId
            || r.sourceDataHash == bytes32(0) || r.gasPriceWei == 0 || r.gasPriceWei > maxGasPriceWei) revert InvalidReport();
        if (processed[r.requestId]) revert AlreadyProcessed();
        if (r.observedAt > block.timestamp || block.timestamp - r.observedAt > maxReportAge
            || r.deadline < block.timestamp || r.deadline < r.observedAt
            || uint256(r.deadline) > uint256(r.observedAt) + maxReportAge
            || r.externalObservedAt > block.timestamp || block.timestamp - r.externalObservedAt > maxReportAge
            || r.observedBlock >= block.number || block.number - r.observedBlock > maxBlockLag) revert StaleReport();
        if (r.observedBlockHash == bytes32(0) || blockhash(r.observedBlock) != r.observedBlockHash) revert ReorgedObservation();
        UniJar.Lot memory lot = releaser.getLot(r.lotId);
        if (lot.mode != UniJar.Mode.Auction || uint8(lot.state) != r.expectedState
            || lot.expiry != r.expectedExpiry || r.observedAt < lot.committedAt
            || releaser.activeId() != r.lotId) revert IneligibleLot();
        bytes memory data;
        if (r.action == FINALIZE_AUCTION) {
            if (lot.state != UniJar.State.Open || block.timestamp < lot.expiry) revert IneligibleLot();
            data = abi.encodeCall(UniJar.finalizeAuction, (r.lotId));
        } else if (r.action == RECOVER_UNSOLD) {
            if (lot.state != UniJar.State.Unsold && lot.state != UniJar.State.Cancelled) revert IneligibleLot();
            data = abi.encodeCall(UniJar.recover, (r.lotId));
        } else revert InvalidReport();
        if (gasleft() < uint256(actionGasLimit) + actionGasLimit / 63 + 35000) revert InsufficientDeliveryGas();
        entered = true;
        // This tentative effect rolls back with the whole report on any failure.
        processed[r.requestId] = true;
        bool success; address target = address(releaser); uint256 callGas = actionGasLimit;
        assembly { success := call(callGas, target, 0, add(data, 32), mload(data), 0, 0) }
        if (!success) revert ActionFailed();
        uint8 resultingState = uint8(releaser.getLot(r.lotId).state);
        if (r.action == FINALIZE_AUCTION ? (resultingState != uint8(UniJar.State.Sold) && resultingState != uint8(UniJar.State.Unsold)) : resultingState != uint8(UniJar.State.Recovered)) revert IneligibleLot();
        emit CREActionExecuted(r.lotId, r.action, r.requestId, resultingState, block.number,
            r.sourceId, r.sourceDataHash, r.externalObservedAt, r.gasPriceWei);
        entered = false;
    }

    function _authenticate(bytes calldata metadata) private view {
        // Real KeystoneForwarder supplies 64 bytes: 62 identity bytes + reportId.
        if (metadata.length != 64) revert WorkflowIdentityMismatch();
        bytes32 id; bytes10 name; address author;
        assembly {
            id := calldataload(metadata.offset)
            name := calldataload(add(metadata.offset, 32))
            author := shr(96, calldataload(add(metadata.offset, 42)))
        }
        if (id != workflowId || name != workflowName || author != workflowOwner) revert WorkflowIdentityMismatch();
    }
}
