// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.29;
import {Test} from "forge-std/Test.sol";
import {ReceiptRegistry} from "../src/ReceiptRegistry.sol";

contract PlainToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public taxed;
    bool public falseReturn;
    address public callback;
    function mint(address to, uint256 value) external { balanceOf[to] += value; }
    function approve(address spender, uint256 value) external { allowance[msg.sender][spender] = value; }
    function setTaxed(bool value) external { taxed = value; }
    function setFalse(bool value) external { falseReturn = value; }
    function setCallback(address value) external { callback = value; }
    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        if (falseReturn) return false;
        if (callback != address(0)) ReceiptRegistry(callback).pay(keccak256("callback"));
        allowance[from][msg.sender] -= value; balanceOf[from] -= value;
        balanceOf[to] += taxed ? value - 1 : value;
        return true;
    }
}
contract Jar {}
contract ReceiptRegistryTest is Test {
    PlainToken token; Jar jar; ReceiptRegistry service;
    address merchant = address(0x123); address payer = address(0x456);
    uint256 constant PRICE = 10 ether;
    bytes32 constant REF = keccak256("invoice-123");
    function setUp() public {
        token = new PlainToken(); jar = new Jar();
        service = new ReceiptRegistry(address(token), address(jar), merchant, uint128(PRICE), 1000);
        token.mint(payer, 100 ether);
        vm.prank(payer); token.approve(address(service), PRICE);
    }
    function testPaymentCreatesReceiptAndExactSplitWithoutCustody() public {
        vm.prank(payer); assertEq(service.pay(REF), 1);
        assertEq(token.balanceOf(payer), 90 ether);
        assertEq(token.balanceOf(address(jar)), 1 ether);
        assertEq(token.balanceOf(merchant), 9 ether);
        assertEq(token.balanceOf(address(service)), 0);
        assertEq(service.totalFees(), 1 ether); assertEq(service.nextReceiptId(), 2);
        (address owner, bytes32 ref, uint64 time) = service.receipts(1);
        assertEq(owner, payer); assertEq(ref, REF); assertEq(time, block.timestamp);
        assertEq(service.receiptIdOf(payer, REF), 1);
    }
    function testDuplicateAndEmptyReferencesCannotChargeAgain() public {
        vm.prank(payer); service.pay(REF);
        vm.prank(payer); vm.expectRevert(ReceiptRegistry.InvalidReference.selector); service.pay(REF);
        vm.prank(payer); vm.expectRevert(ReceiptRegistry.InvalidReference.selector); service.pay(bytes32(0));
        assertEq(token.balanceOf(payer), 90 ether);
    }
    function testInsufficientAllowanceRevertsBothTransfersAndReceipt() public {
        vm.prank(payer); token.approve(address(service), 1 ether);
        vm.prank(payer); vm.expectRevert(); service.pay(REF);
        assertEq(token.balanceOf(payer), 100 ether); assertEq(token.balanceOf(address(jar)), 0);
        assertEq(service.receiptIdOf(payer, REF), 0); assertEq(service.nextReceiptId(), 1);
        assertEq(service.totalFees(), 0);
    }
    function testTaxAndFalseReturnRollbackAllState() public {
        token.setTaxed(true);
        vm.prank(payer); vm.expectRevert(ReceiptRegistry.TransferFailed.selector); service.pay(REF);
        token.setTaxed(false); token.setFalse(true);
        vm.prank(payer); vm.expectRevert(ReceiptRegistry.TransferFailed.selector); service.pay(REF);
        assertEq(token.balanceOf(payer), 100 ether); assertEq(token.balanceOf(address(jar)), 0);
        assertEq(service.nextReceiptId(), 1); assertEq(service.totalFees(), 0);
    }
    function testReentrancyCannotCreateReceiptOrTakeFunds() public {
        token.setCallback(address(service));
        vm.prank(payer); vm.expectRevert(ReceiptRegistry.ReentrantCall.selector); service.pay(REF);
        assertEq(service.nextReceiptId(), 1); assertEq(token.balanceOf(payer), 100 ether);
    }
    function testRejectsSelfPaymentAndInvalidConfiguration() public {
        vm.prank(merchant); vm.expectRevert(ReceiptRegistry.InvalidPayer.selector); service.pay(REF);
        vm.prank(address(jar)); vm.expectRevert(ReceiptRegistry.InvalidPayer.selector); service.pay(REF);
        vm.expectRevert(ReceiptRegistry.InvalidConfiguration.selector); new ReceiptRegistry(address(token), address(jar), merchant, 1, 1);
        vm.expectRevert(ReceiptRegistry.InvalidConfiguration.selector); new ReceiptRegistry(address(token), address(jar), merchant, uint128(PRICE), 10000);
        vm.expectRevert(ReceiptRegistry.InvalidConfiguration.selector); new ReceiptRegistry(address(token), address(jar), address(jar), uint128(PRICE), 1000);
    }
    function testFuzzSplitConservation(uint128 price, uint16 bps) public {
        bps = uint16(bound(bps, 1, 9999)); price = uint128(bound(price, 10000, type(uint128).max));
        ReceiptRegistry custom = new ReceiptRegistry(address(token), address(jar), merchant, price, bps);
        token.mint(payer, price); vm.prank(payer); token.approve(address(custom), price);
        uint256 before = token.balanceOf(payer);
        vm.prank(payer); custom.pay(REF);
        assertEq(before - token.balanceOf(payer), price);
        assertEq(token.balanceOf(address(jar)) + token.balanceOf(merchant), price);
        assertEq(token.balanceOf(address(jar)), uint256(price) * bps / 10000);
    }
}
