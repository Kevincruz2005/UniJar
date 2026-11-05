// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.29;

import {Test} from "forge-std/Test.sol";
import {TokenJar} from "tjar/TokenJar.sol";
import {UniJar, IERC20, IReferenceReader} from "../src/UniJar.sol";
import {FixtureToken} from "../src/FixtureToken.sol";

contract StubReader is IReferenceReader {
    uint256 public price = 1_000_001;
    int24 public average;
    int24 public spot;
    uint128 public liquidity = 1e12;
    uint32 public latest;
    bool public broken;
    function configure(uint256 p, int24 a, int24 s, uint128 l, uint32 t, bool b) external { price=p; average=a; spot=s; liquidity=l; latest=t; broken=b; }
    function validate(address, address, address, address, uint24) external pure {}
    function read(address, address, address, address, uint24, uint128, uint32) external view returns (uint256,int24,int24,uint128,uint32) {
        require(!broken, 'BROKEN'); return (price,average,spot,liquidity,latest);
    }
}

contract UniJarTest is Test {
    TokenJar internal jar;
    UniJar internal sale;
    FixtureToken internal usd;
    FixtureToken internal fee;
    FixtureToken internal alt;
    StubReader internal reader;
    address internal treasury = address(0x777);
    address internal alice = address(0xaaa);
    address internal bob = address(0xbbb);

    function setUp() public virtual {
        vm.warp(10_000);
        jar = new TokenJar(); usd = new FixtureToken('Mock USD','mUSDC',6);
        fee = new FixtureToken('Mock Fee','mFEE',18); alt = new FixtureToken('Mock Alt','mALT',18);
        reader = new StubReader();
        sale = new UniJar(address(jar), treasury, address(this), address(usd), address(reader), address(reader));
        jar.setReleaser(address(sale)); sale.setAssetMode(address(alt), UniJar.Mode.Auction); sale.setAssetMode(address(fee), UniJar.Mode.Direct);
        sale.setPolicy(address(fee), policy());
        fee.mint(address(jar),100e18); alt.mint(address(jar),100e18);
        for (uint256 i; i<2; i++) {
            address user = i==0 ? alice : bob; usd.mint(user,1000e6); vm.prank(user); usd.approve(address(sale),type(uint256).max);
        }
        refresh();
    }
    function policy() internal view returns (UniJar.Policy memory) {
        return UniJar.Policy(address(reader),3000,1800,600,1e6,100e18,100,100,7200,1);
    }
    function refresh() internal { reader.configure(1_000_001,0,0,1e12,uint32(block.timestamp),false); }
    function auction() internal returns(uint256) { return sale.openAuction(address(alt),10e18,uint64(block.timestamp+100),10e6,1e6); }
    function direct() internal returns(uint256) { return sale.openDirect(address(fee),10e18,uint64(block.timestamp+100)); }

    function testCustodySurplusDonationLateDepositRotationRecovery() public {
        alt.mint(address(sale),7); uint256 id = auction();
        assertEq(alt.balanceOf(address(jar)),90e18); assertEq(alt.balanceOf(address(sale)),10e18+7);
        alt.mint(address(jar),3e18); jar.setReleaser(bob);
        sale.cancelAuction(id); sale.recover(id);
        assertEq(alt.balanceOf(address(jar)),103e18); assertEq(alt.balanceOf(address(sale)),7);
        vm.expectRevert(); auction();
    }
    function testFundedSelfOutbidRefundSettlement() public {
        uint256 id=auction(); vm.prank(alice); sale.bid(id,10e6,alice);
        vm.prank(alice); sale.bid(id,11e6,bob); assertEq(sale.credits(alice),10e6);
        vm.prank(bob); sale.bid(id,12e6,bob); assertEq(sale.credits(alice),21e6);
        vm.prank(alice); sale.withdrawRefund(); assertEq(usd.balanceOf(alice),1000e6);
        sale.setPaused(true); vm.warp(block.timestamp+100); sale.finalizeAuction(id);
        assertEq(usd.balanceOf(treasury),12e6); assertEq(alt.balanceOf(bob),10e18);
        assertEq(sale.totalCredits(),0); assertEq(sale.bidLiability(),0); assertEq(sale.activeId(),0);
    }
    function testNoBidAndCancelledRecovery() public {
        uint256 id=auction(); vm.warp(block.timestamp+100); sale.finalizeAuction(id);
        assertEq(sale.activeId(),id); sale.recover(id); assertEq(alt.balanceOf(address(jar)),100e18);
        id=auction(); sale.cancelAuction(id); sale.recover(id); assertEq(sale.activeId(),0);
    }
    function testDirectFrozenPolicyCeilingAndBuyerBounds() public {
        uint256 id=direct(); (uint256 amount,bytes32 hash)=sale.quoteDirect(id); assertEq(amount,990001);
        UniJar.Policy memory p=policy(); p.version=2; p.discountBps=0; sale.setPolicy(address(fee),p);
        (uint256 again,bytes32 same)=sale.quoteDirect(id); assertEq(again,amount); assertEq(same,hash);
        vm.prank(alice); vm.expectRevert(); sale.fillDirect(id,amount-1,uint64(block.timestamp),hash,alice);
        vm.prank(alice); vm.expectRevert(); sale.fillDirect(id,amount,uint64(block.timestamp-1),hash,alice);
        vm.prank(alice); vm.expectRevert(); sale.fillDirect(id,amount,uint64(block.timestamp),bytes32(0),alice);
        vm.prank(alice); sale.fillDirect(id,amount,uint64(block.timestamp),hash,bob);
        assertEq(usd.balanceOf(treasury),amount); assertEq(fee.balanceOf(bob),10e18); assertEq(sale.directPayments(),amount);
    }
    function testReferenceGatesLeaveLotIntact() public {
        uint256 id=direct();
        reader.configure(0,0,0,1e12,10000,false); vm.expectRevert(); sale.quoteDirect(id);
        reader.configure(1,0,0,1,10000,false); vm.expectRevert(); sale.quoteDirect(id);
        reader.configure(1,0,101,1e12,10000,false); vm.expectRevert(); sale.quoteDirect(id);
        reader.configure(1,-8388608,8388607,1e12,10000,false); vm.expectRevert(); sale.quoteDirect(id);
        reader.configure(1,0,0,1e12,9000,false); vm.expectRevert(); sale.quoteDirect(id);
        reader.configure(1,0,0,1e12,10000,true); vm.expectRevert(); sale.quoteDirect(id);
        assertEq(uint256(sale.getLot(id).state),uint256(UniJar.State.Open));
    }
    function testModeExistenceAccessPauseAndBoundaries() public {
        vm.prank(alice); vm.expectRevert(); auction();
        uint256 id=auction();
        vm.expectRevert(); sale.quoteDirect(id); vm.expectRevert(); sale.expireDirect(id);
        vm.expectRevert(); sale.getLot(900); vm.expectRevert(); sale.finalizeAuction(id);
        vm.prank(alice); vm.expectRevert(); sale.bid(id,9e6,alice);
        vm.prank(alice); vm.expectRevert(); sale.bid(id,10e6,address(jar));
        sale.setPaused(true); vm.prank(alice); vm.expectRevert(); sale.bid(id,10e6,alice);
        sale.cancelAuction(id); sale.recover(id); vm.expectRevert(); auction();
        sale.setPaused(false); id=auction(); vm.warp(block.timestamp+100);
        vm.prank(alice); vm.expectRevert(); sale.bid(id,10e6,alice); sale.finalizeAuction(id); sale.recover(id);
    }
    function testFundedCannotCancelCreditsSurviveNextLot() public {
        uint256 id=auction(); vm.prank(alice); sale.bid(id,10e6,alice); vm.prank(bob); sale.bid(id,11e6,bob);
        vm.expectRevert(); sale.cancelAuction(id); vm.warp(block.timestamp+100); sale.finalizeAuction(id); auction();
        vm.prank(bob); vm.expectRevert(); sale.withdrawRefund(); vm.prank(alice); sale.withdrawRefund(); assertEq(sale.totalCredits(),0);
    }
    function testDirectPauseExpiryAndRecovery() public {
        uint256 id=direct(); (,bytes32 hash)=sale.quoteDirect(id); sale.setPaused(true);
        vm.prank(alice); vm.expectRevert(); sale.fillDirect(id,type(uint256).max,10001,hash,alice);
        vm.warp(block.timestamp+100); sale.expireDirect(id); sale.recover(id); assertEq(fee.balanceOf(address(jar)),100e18);
    }
    function testFuzzIndependentCeiling(uint128 quote,uint16 discount) public {
        quote=uint128(bound(quote,1,type(uint128).max)); discount=uint16(bound(discount,0,100));
        UniJar.Policy memory p=policy(); p.version=2; p.discountBps=discount; sale.setPolicy(address(fee),p);
        uint256 id=direct(); reader.configure(quote,0,0,1e12,10000,false);
        (uint256 amount,)=sale.quoteDirect(id);
        uint256 numerator=uint256(quote)*(10000-discount); uint256 expected=numerator/10000; if(numerator%10000!=0)expected++;
        assertEq(amount,expected);
    }
}
