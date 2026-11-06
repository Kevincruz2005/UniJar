// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.29;
import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {UniJarTest, StubReader} from "./UniJar.t.sol";
import {UniJar} from "../src/UniJar.sol";
import {FixtureToken} from "../src/FixtureToken.sol";
import {TokenJar} from "tjar/TokenJar.sol";

contract HostileToken is FixtureToken {
    bool public fee;
    bool public broken;
    address public callback;
    bytes4 public callbackError;
    constructor() FixtureToken('Hostile','BAD',18) {}
    function configure(bool f,bool b,address c) external { fee=f; broken=b; callback=c; }
    function _transfer(address from,address to,uint256 amount) internal override {
        require(!broken,'BROKEN');
        if(callback!=address(0)) {
            (bool ok,bytes memory result)=callback.call(abi.encodeWithSignature('withdrawRefund()'));
            require(!ok); if(result.length>=4) callbackError=bytes4(result);
        }
        super._transfer(from,to,amount); if(fee && amount>0) { balanceOf[to]--; totalSupply--; }
    }
}

contract TransferTest is UniJarTest {
    function testUnsupportedIntakeAndReentryGuard() public {
        HostileToken token=new HostileToken(); sale.setAssetMode(address(alt),UniJar.Mode.Disabled); sale.setAssetMode(address(token),UniJar.Mode.Auction);
        token.mint(address(jar),100); token.configure(true,false,address(0));
        vm.expectRevert(); sale.openAuction(address(token),10,10100,1,1); assertEq(token.balanceOf(address(jar)),100);
        token.configure(false,false,address(sale)); uint256 id=sale.openAuction(address(token),10,10100,1,1);
        assertEq(token.callbackError(),UniJar.Reentered.selector); sale.cancelAuction(id);
        token.configure(false,true,address(0)); vm.expectRevert(); sale.recover(id);
        assertEq(uint256(sale.getLot(id).state),uint256(UniJar.State.Cancelled));
        token.configure(false,false,address(0)); sale.recover(id);
    }
    function testPayoutFailurePreservesRefundAndSettlement() public {
        HostileToken bad=new HostileToken();
        UniJar other=new UniJar(address(jar),treasury,address(this),address(bad),address(reader),address(reader));
        jar.setReleaser(address(other)); other.setAssetMode(address(alt),UniJar.Mode.Auction);
        bad.mint(alice,100); vm.prank(alice); bad.approve(address(other),100);
        uint256 id=other.openAuction(address(alt),1e18,10100,10,1);
        bad.configure(true,false,address(0)); vm.prank(alice); vm.expectRevert(); other.bid(id,10,alice);
        bad.configure(false,false,address(0)); vm.prank(alice); other.bid(id,10,alice); vm.prank(alice); other.bid(id,11,alice);
        bad.configure(false,true,address(0)); vm.prank(alice); vm.expectRevert(); other.withdrawRefund(); assertEq(other.credits(alice),10);
        vm.warp(10100); vm.expectRevert(); other.finalizeAuction(id); assertEq(other.bidLiability(),11);
        bad.configure(false,false,address(0)); other.finalizeAuction(id); vm.prank(alice); other.withdrawRefund();
    }
    function testTreasurySelfPaymentAndPayoutDonation() public {
        uint256 id=direct(); (uint256 amount,bytes32 hash)=sale.quoteDirect(id);
        usd.mint(treasury,amount); vm.prank(treasury); usd.approve(address(sale),amount);
        vm.prank(treasury); vm.expectRevert(); sale.fillDirect(id,amount,10100,hash,treasury);
        usd.mint(address(sale),123); vm.prank(alice); sale.fillDirect(id,amount,10100,hash,alice);
        assertEq(usd.balanceOf(address(sale)),123); assertEq(sale.totalCredits(),0);
    }
}

/// @dev Model records intended successful effects without reading contract accounting.
contract LedgerHandler is Test {
    UniJar public sale;
    FixtureToken public usd;
    FixtureToken public fee;
    FixtureToken public alt;
    TokenJar public jar;
    StubReader public reader;
    address public treasury=address(0x777);
    address[2] public actors=[address(0xaaa),address(0xbbb)];
    uint256[2] public refunds;
    uint256 public highest;
    uint256 public bidderIndex;
    uint256 public quantity;
    address public asset;
    uint256 public paid;
    uint256 public donation;
    uint256 public id;
    bool public directMode;
    constructor(TokenJar j,FixtureToken u,FixtureToken f,FixtureToken a,StubReader r) {
        jar=j;usd=u;fee=f;alt=a;reader=r;
        sale=new UniJar(address(j),treasury,address(this),address(u),address(r),address(r));
        sale.setAssetMode(address(a),UniJar.Mode.Auction); sale.setAssetMode(address(f),UniJar.Mode.Direct);
        sale.setPolicy(address(f),UniJar.Policy(address(r),3000,1800,600,1,100e18,100,100,7200,1));
        for(uint256 i;i<2;i++) {vm.prank(actors[i]);u.approve(address(sale),type(uint256).max);}
    }
    function open(bool mode,uint128 q) external {
        if(id!=0)return; q=uint128(bound(q,1,1e18)); address token=mode?address(fee):address(alt);
        if(FixtureToken(token).balanceOf(address(jar))<q)return;
        if(mode) id=sale.openDirect(token,q,uint64(block.timestamp+100));
        else id=sale.openAuction(token,q,uint64(block.timestamp+100),10,1);
        quantity=q;asset=token;directMode=mode;
    }
    function bid(uint8 who,uint96 extra) external {
        if(id==0||directMode)return;uint256 index=who%2; uint256 amount=highest+1+uint256(extra%100);
        if(amount<10)amount=10;
        vm.prank(actors[index]);try sale.bid(id,amount,actors[index]) {
            if(highest>0)refunds[bidderIndex]+=highest;highest=amount;bidderIndex=index;
        }catch{}
    }
    function withdraw(uint8 who) external {
        uint256 index=who%2;vm.prank(actors[index]);try sale.withdrawRefund(){refunds[index]=0;}catch{}
    }
    function finish() external {
        if(id==0)return;vm.warp(block.timestamp+101);
        if(directMode) { sale.expireDirect(id);sale.recover(id); }
        else {sale.finalizeAuction(id);if(highest==0)sale.recover(id);else paid+=highest;}
        id=0;quantity=0;highest=0;
    }
    function cancel() external {
        if(id==0||highest>0)return;
        if(directMode)sale.cancelDirect(id);else sale.cancelAuction(id);
        sale.recover(id);id=0;quantity=0;
    }
    function fill(uint8 who) external {
        if(id==0||!directMode)return;reader.configure(1e6,0,0,1e12,uint32(block.timestamp),false);
        UniJar.Policy memory p=sale.getPolicy(address(fee));bytes32 hash=sale.hashPolicy(address(fee),p);
        vm.prank(actors[who%2]);try sale.fillDirect(id,990000,uint64(block.timestamp),hash,actors[who%2]) {
            paid+=990000;id=0;quantity=0;
        }catch{}
    }
    function donate(uint32 amount) external {
        uint256 q=uint256(amount)%100;vm.prank(actors[0]);try usd.transfer(address(sale),q) {donation+=q;}catch{}
    }
}

contract AccountingInvariantTest is StdInvariant,Test {
    LedgerHandler internal h;
    FixtureToken internal usd;FixtureToken internal fee;FixtureToken internal alt;TokenJar internal jar;
    function setUp() public {
        vm.warp(10000);jar=new TokenJar();usd=new FixtureToken('USD','USD',6);fee=new FixtureToken('FEE','FEE',18);alt=new FixtureToken('ALT','ALT',18);
        usd.mint(address(0xaaa),1e18);usd.mint(address(0xbbb),1e18);fee.mint(address(jar),100e18);alt.mint(address(jar),100e18);
        h=new LedgerHandler(jar,usd,fee,alt,new StubReader());jar.setReleaser(address(h.sale()));targetContract(address(h));
    }
    function invariantIndependentLedgerAndConservation() public view {
        UniJar s=h.sale();assertEq(s.bidLiability(),h.highest());assertEq(s.totalCredits(),h.refunds(0)+h.refunds(1));
        assertEq(s.credits(h.actors(0)),h.refunds(0));assertEq(s.credits(h.actors(1)),h.refunds(1));
        assertEq(usd.balanceOf(address(s)),h.highest()+h.refunds(0)+h.refunds(1)+h.donation());
        assertEq(usd.balanceOf(h.treasury()),h.paid());
        assertEq(s.inventory(address(fee)),h.asset()==address(fee)?h.quantity():0);
        assertEq(s.inventory(address(alt)),h.asset()==address(alt)?h.quantity():0);
        assertEq(total(fee),fee.totalSupply());assertEq(total(alt),alt.totalSupply());assertEq(total(usd),usd.totalSupply());
    }
    function total(FixtureToken t) internal view returns(uint256) {
        return t.balanceOf(address(jar))+t.balanceOf(address(h.sale()))+t.balanceOf(h.actors(0))+t.balanceOf(h.actors(1))+t.balanceOf(h.treasury());
    }
}
