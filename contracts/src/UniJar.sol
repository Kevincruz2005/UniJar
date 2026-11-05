// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.29;

import {TokenJar} from "tjar/TokenJar.sol";
import {Currency} from "v4-core/types/Currency.sol";

interface IERC20 {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IReferenceReader {
    function validate(address pool, address factory, address asset, address payout, uint24 fee) external view;
    function read(address pool, address factory, address asset, address payout, uint24 fee, uint128 quantity, uint32 window)
        external view returns (uint256 quote, int24 averageTick, int24 spotTick, uint128 harmonicLiquidity, uint32 latest);
}

/// @notice Exact-batch TokenJar releaser. Only plain, exact-transfer ERC-20s are supported.
contract UniJar {
    enum Mode { Disabled, Auction, Direct }
    enum State { Missing, Open, Sold, Cancelled, Unsold, Recovered }
    struct Policy {
        address pool;
        uint24 fee;
        uint32 window;
        uint32 maxAge;
        uint128 minLiquidity;
        uint128 maxQuantity;
        uint24 maxTickDeviation;
        uint16 discountBps;
        uint32 maxDuration;
        uint64 version;
    }
    struct Lot {
        Mode mode;
        State state;
        address asset;
        uint128 quantity;
        uint64 committedAt;
        uint64 expiry;
        uint256 reserve;
        uint256 increment;
        address bidder;
        address recipient;
        uint256 highest;
        bytes32 policyHash;
        Policy policy;
    }

    TokenJar public immutable jar;
    address public immutable treasury;
    address public immutable operator;
    IERC20 public immutable payout;
    IReferenceReader public immutable reader;
    address public immutable factory;
    uint256 public activeId;
    uint256 public nextId = 1;
    uint256 public bidLiability;
    uint256 public totalCredits;
    uint256 public directPayments;
    bool public paused;
    bool private entered;
    address public auctionAsset;
    address public directAsset;
    mapping(address => Mode) public assetModes;
    mapping(address => Policy) private policies;
    mapping(uint256 => Lot) private lots;
    mapping(address => uint256) public credits;
    mapping(address => uint256) public inventory;

    error Unauthorized();
    error Invalid();
    error WrongState();
    error AdmissionPaused();
    error TransferMismatch();
    error ReferenceRefused();
    error Reentered();

    event AssetModeSet(address indexed asset, Mode mode);
    event PolicySet(address indexed asset, uint64 version, bytes32 hash);
    event PauseSet(bool paused);
    event Opened(uint256 indexed id, Mode mode, address indexed asset, uint128 quantity, uint64 expiry, bytes32 policyHash);
    event Bid(uint256 indexed id, address indexed bidder, address recipient, uint256 amount);
    event CreditWithdrawn(address indexed account, uint256 amount);
    event Closed(uint256 indexed id, State state);
    event Sale(uint256 indexed id, bytes32 policyHash, address indexed buyer, address recipient, uint256 payment, uint128 delivered);
    event Recovered(uint256 indexed id, address indexed jar, uint128 quantity);

    modifier lock() { if (entered) revert Reentered(); entered = true; _; entered = false; }
    modifier onlyOperator() { if (msg.sender != operator) revert Unauthorized(); _; }
    modifier admission() { if (paused) revert AdmissionPaused(); _; }

    constructor(address jar_, address treasury_, address operator_, address payout_, address reader_, address factory_) {
        if (jar_.code.length == 0 || payout_.code.length == 0 || reader_.code.length == 0 || factory_.code.length == 0
            || treasury_ == address(0) || treasury_ == jar_ || treasury_ == address(this) || operator_ == address(0)) revert Invalid();
        jar = TokenJar(payable(jar_)); treasury = treasury_; operator = operator_;
        payout = IERC20(payout_); reader = IReferenceReader(reader_); factory = factory_;
    }

    function setAssetMode(address asset, Mode mode) external lock onlyOperator {
        if (asset.code.length == 0 || asset == address(payout)) revert Invalid();
        if (mode == Mode.Auction && auctionAsset != address(0) && auctionAsset != asset) revert Invalid();
        if (mode == Mode.Direct && directAsset != address(0) && directAsset != asset) revert Invalid();
        if (auctionAsset == asset) auctionAsset = address(0);
        if (directAsset == asset) directAsset = address(0);
        if (mode == Mode.Auction) auctionAsset = asset;
        if (mode == Mode.Direct) directAsset = asset;
        assetModes[asset] = mode;
        emit AssetModeSet(asset, mode);
    }

    function setPaused(bool value) external lock onlyOperator { paused = value; emit PauseSet(value); }

    function setPolicy(address asset, Policy calldata policy) external lock onlyOperator {
        if (asset.code.length == 0 || asset == address(payout) || policy.window == 0 || policy.maxAge == 0
            || policy.minLiquidity == 0 || policy.maxQuantity == 0 || policy.discountBps > 100
            || policy.maxDuration == 0 || policy.version <= policies[asset].version) revert Invalid();
        reader.validate(policy.pool, factory, asset, address(payout), policy.fee);
        policies[asset] = policy;
        emit PolicySet(asset, policy.version, hashPolicy(asset, policy));
    }

    function getPolicy(address asset) external view returns (Policy memory) { return policies[asset]; }
    function getLot(uint256 id) external view returns (Lot memory) { if (lots[id].state == State.Missing) revert Invalid(); return lots[id]; }
    function hashPolicy(address asset, Policy memory policy) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), asset, address(payout), policy));
    }

    function openAuction(address asset, uint128 quantity, uint64 expiry, uint256 reserve, uint256 increment)
        external lock onlyOperator admission returns (uint256 id)
    {
        if (reserve == 0 || increment == 0) revert Invalid();
        id = _open(asset, quantity, expiry, Mode.Auction);
        Lot storage lot = lots[id]; lot.reserve = reserve; lot.increment = increment;
        lot.policyHash = keccak256(abi.encode(block.chainid, address(this), asset, address(payout), quantity, expiry, reserve, increment));
        emit Opened(id, lot.mode, asset, quantity, expiry, lot.policyHash);
    }

    function openDirect(address asset, uint128 quantity, uint64 expiry) external lock onlyOperator admission returns (uint256 id) {
        Policy memory policy = policies[asset];
        if (policy.version == 0 || quantity > policy.maxQuantity || expiry > block.timestamp + policy.maxDuration) revert Invalid();
        id = _open(asset, quantity, expiry, Mode.Direct);
        Lot storage lot = lots[id]; lot.policy = policy; lot.policyHash = hashPolicy(asset, policy);
        emit Opened(id, lot.mode, asset, quantity, expiry, lot.policyHash);
    }

    function _open(address asset, uint128 quantity, uint64 expiry, Mode mode) private returns (uint256 id) {
        if (activeId != 0 || quantity == 0 || expiry <= block.timestamp || assetModes[asset] != mode || jar.releaser() != address(this)) revert Invalid();
        uint256 beforeBalance = IERC20(asset).balanceOf(address(this));
        uint256 available = IERC20(asset).balanceOf(address(jar));
        if (available < quantity) revert Invalid();
        Currency[] memory assets = new Currency[](1); assets[0] = Currency.wrap(asset);
        jar.release(assets, address(this));
        if (IERC20(asset).balanceOf(address(this)) != beforeBalance + available || IERC20(asset).balanceOf(address(jar)) != 0) revert TransferMismatch();
        if (available > quantity) _send(IERC20(asset), address(jar), available - quantity);
        if (IERC20(asset).balanceOf(address(this)) != beforeBalance + quantity) revert TransferMismatch();
        id = nextId++; activeId = id; inventory[asset] += quantity;
        Lot storage lot = lots[id]; lot.mode = mode; lot.state = State.Open; lot.asset = asset;
        lot.quantity = quantity; lot.committedAt = uint64(block.timestamp); lot.expiry = expiry;
        _solvent(asset);
    }

    function bid(uint256 id, uint256 amount, address recipient) external lock admission {
        Lot storage lot = _openLot(id, Mode.Auction); _recipient(recipient);
        uint256 minimum = lot.highest == 0 ? lot.reserve : lot.highest + lot.increment;
        if (amount < minimum) revert Invalid();
        _take(payout, msg.sender, address(this), amount);
        if (lot.highest != 0) { credits[lot.bidder] += lot.highest; totalCredits += lot.highest; }
        bidLiability = amount; lot.highest = amount; lot.bidder = msg.sender; lot.recipient = recipient;
        _solvent(lot.asset); emit Bid(id, msg.sender, recipient, amount);
    }

    function withdrawRefund() external lock {
        uint256 amount = credits[msg.sender]; if (amount == 0) revert Invalid();
        credits[msg.sender] = 0; totalCredits -= amount; _send(payout, msg.sender, amount);
        _solvent(address(payout)); emit CreditWithdrawn(msg.sender, amount);
    }

    function finalizeAuction(uint256 id) external lock {
        Lot storage lot = _lot(id, Mode.Auction);
        if (lot.state != State.Open || block.timestamp < lot.expiry) revert WrongState();
        if (lot.highest == 0) { lot.state = State.Unsold; emit Closed(id, State.Unsold); return; }
        lot.state = State.Sold; activeId = 0; inventory[lot.asset] -= lot.quantity; bidLiability = 0;
        _send(payout, treasury, lot.highest); _send(IERC20(lot.asset), lot.recipient, lot.quantity);
        _solvent(lot.asset); emit Sale(id, lot.policyHash, lot.bidder, lot.recipient, lot.highest, lot.quantity);
    }

    function cancelAuction(uint256 id) external lock onlyOperator {
        Lot storage lot = _openLot(id, Mode.Auction); if (lot.highest != 0) revert WrongState();
        lot.state = State.Cancelled; emit Closed(id, State.Cancelled);
    }

    function quoteDirect(uint256 id) public view returns (uint256 payment, bytes32 policyHash) {
        Lot storage lot = _openLot(id, Mode.Direct); Policy storage p = lot.policy;
        (uint256 referenceQuote, int24 averageTick, int24 spotTick, uint128 liquidity, uint32 latest) =
            reader.read(p.pool, factory, lot.asset, address(payout), p.fee, lot.quantity, p.window);
        int256 deviation = int256(spotTick) - int256(averageTick); if (deviation < 0) deviation = -deviation;
        // v3 observation timestamps intentionally use uint32 modular arithmetic.
        uint32 age; unchecked { age = uint32(block.timestamp) - latest; }
        if (referenceQuote == 0 || age > p.maxAge || liquidity < p.minLiquidity || uint256(deviation) > p.maxTickDeviation) revert ReferenceRefused();
        // Quotient/remainder form is full precision without a potentially overflowing multiplication.
        uint256 factor = 10_000 - p.discountBps;
        payment = (referenceQuote / 10_000) * factor + ((referenceQuote % 10_000) * factor + 9_999) / 10_000;
        if (payment == 0) revert ReferenceRefused();
        return (payment, lot.policyHash);
    }

    function fillDirect(uint256 id, uint256 maximum, uint64 deadline, bytes32 expectedPolicyHash, address recipient) external lock admission {
        Lot storage lot = _openLot(id, Mode.Direct); _recipient(recipient);
        if (msg.sender == treasury || block.timestamp > deadline || lot.policyHash != expectedPolicyHash) revert Invalid();
        (uint256 payment,) = quoteDirect(id); if (payment > maximum) revert Invalid();
        lot.state = State.Sold; activeId = 0; inventory[lot.asset] -= lot.quantity; directPayments += payment;
        _take(payout, msg.sender, treasury, payment); _send(IERC20(lot.asset), recipient, lot.quantity);
        _solvent(lot.asset); emit Sale(id, lot.policyHash, msg.sender, recipient, payment, lot.quantity);
    }

    function cancelDirect(uint256 id) external lock onlyOperator {
        Lot storage lot = _openLot(id, Mode.Direct); lot.state = State.Cancelled; emit Closed(id, State.Cancelled);
    }
    function expireDirect(uint256 id) external lock {
        Lot storage lot = _lot(id, Mode.Direct);
        if (lot.state != State.Open || block.timestamp < lot.expiry) revert WrongState();
        lot.state = State.Unsold; emit Closed(id, State.Unsold);
    }
    function recover(uint256 id) external lock {
        Lot storage lot = lots[id]; if (lot.state != State.Cancelled && lot.state != State.Unsold) revert WrongState();
        lot.state = State.Recovered; activeId = 0; inventory[lot.asset] -= lot.quantity;
        _send(IERC20(lot.asset), address(jar), lot.quantity); _solvent(lot.asset);
        emit Recovered(id, address(jar), lot.quantity);
    }

    function _lot(uint256 id, Mode mode) private view returns (Lot storage lot) {
        lot = lots[id]; if (lot.state == State.Missing || lot.mode != mode) revert Invalid();
    }
    function _openLot(uint256 id, Mode mode) private view returns (Lot storage lot) {
        lot = _lot(id, mode); if (lot.state != State.Open || block.timestamp >= lot.expiry) revert WrongState();
    }
    function _recipient(address recipient) private view { if (recipient == address(0) || recipient == address(jar) || recipient == address(this)) revert Invalid(); }
    function _send(IERC20 token, address to, uint256 amount) private { _move(token, address(this), to, amount, false); }
    function _take(IERC20 token, address from, address to, uint256 amount) private { _move(token, from, to, amount, true); }
    function _move(IERC20 token, address from, address to, uint256 amount, bool delegated) private {
        if (from == to) revert Invalid();
        uint256 a = token.balanceOf(from); uint256 b = token.balanceOf(to);
        bytes memory callData = delegated ? abi.encodeCall(token.transferFrom, (from, to, amount)) : abi.encodeCall(token.transfer, (to, amount));
        (bool ok, bytes memory result) = address(token).call(callData);
        if (!ok || (result.length != 0 && (result.length != 32 || !abi.decode(result, (bool))))) revert TransferMismatch();
        if (token.balanceOf(from) + amount != a || token.balanceOf(to) != b + amount) revert TransferMismatch();
    }
    function _solvent(address asset) private view {
        if (payout.balanceOf(address(this)) < bidLiability + totalCredits || IERC20(asset).balanceOf(address(this)) < inventory[asset]) revert TransferMismatch();
    }
}
