// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.29;

interface IReceiptToken {
    function balanceOf(address) external view returns (uint256);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// @notice A paid, onchain reference receipt. Each payment routes an explicit
/// service fee to TokenJar and the remainder to the merchant without custody.
/// @dev Intended for plain exact-transfer ERC20s. No admin, mint or withdrawal.
contract ReceiptRegistry {
    error InvalidConfiguration();
    error InvalidReference();
    error InvalidPayer();
    error TransferFailed();
    error ReentrantCall();

    struct Receipt { address payer; bytes32 referenceHash; uint64 timestamp; }
    IReceiptToken public immutable asset;
    address public immutable jar;
    address public immutable merchant;
    uint256 public immutable price;
    uint16 public immutable feeBps;
    uint256 public immutable feePerReceipt;
    uint256 public nextReceiptId = 1;
    uint256 public totalFees;
    mapping(uint256 => Receipt) public receipts;
    mapping(address => mapping(bytes32 => uint256)) public receiptIdOf;
    bool private entered;

    event ReceiptPaid(uint256 indexed id, address indexed payer, bytes32 indexed referenceHash, uint256 price, uint256 jarFee, uint256 merchantPayment);

    constructor(address asset_, address jar_, address merchant_, uint128 price_, uint16 feeBps_) {
        uint256 fee = uint256(price_) * feeBps_ / 10000;
        if (asset_.code.length == 0 || jar_.code.length == 0 || merchant_ == address(0) || jar_ == merchant_ || asset_ == jar_ || asset_ == merchant_ || feeBps_ >= 10000 || fee == 0 || fee >= price_) revert InvalidConfiguration();
        asset = IReceiptToken(asset_); jar = jar_; merchant = merchant_;
        price = price_; feeBps = feeBps_; feePerReceipt = fee;
    }

    function pay(bytes32 referenceHash) external returns (uint256 id) {
        if (entered) revert ReentrantCall();
        if (msg.sender == jar || msg.sender == merchant || msg.sender == address(this)) revert InvalidPayer();
        if (referenceHash == bytes32(0) || receiptIdOf[msg.sender][referenceHash] != 0) revert InvalidReference();
        entered = true;
        uint256 payerBefore = asset.balanceOf(msg.sender);
        uint256 jarBefore = asset.balanceOf(jar);
        uint256 merchantBefore = asset.balanceOf(merchant);
        id = nextReceiptId++;
        receipts[id] = Receipt(msg.sender, referenceHash, uint64(block.timestamp));
        receiptIdOf[msg.sender][referenceHash] = id;
        totalFees += feePerReceipt;
        if (!asset.transferFrom(msg.sender, jar, feePerReceipt) || !asset.transferFrom(msg.sender, merchant, price - feePerReceipt)) revert TransferFailed();
        if (asset.balanceOf(msg.sender) + price != payerBefore || asset.balanceOf(jar) != jarBefore + feePerReceipt || asset.balanceOf(merchant) != merchantBefore + price - feePerReceipt) revert TransferFailed();
        emit ReceiptPaid(id, msg.sender, referenceHash, price, feePerReceipt, price - feePerReceipt);
        entered = false;
    }
}
