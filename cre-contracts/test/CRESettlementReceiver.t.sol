// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.29;
import {Test} from "forge-std/Test.sol";
import {TokenJar} from "tjar/TokenJar.sol";
import {UniJar, IReferenceReader} from "unijar/UniJar.sol";
import {FixtureToken} from "unijar/FixtureToken.sol";
import {CRESettlementReceiver as Receiver} from "../src/CRESettlementReceiver.sol";
import {IReceiver} from "../src/interfaces/IReceiver.sol";

/// @dev Unit-test delivery only; not a Chainlink CLI simulation or real DON.
contract UnitForwarder {
    function deliver(Receiver receiver, bytes memory metadata, bytes memory report) external {
        receiver.onReport(metadata, report);
    }
}
contract ReaderFixture is IReferenceReader {
    function validate(address,address,address,address,uint24) external pure {}
    function read(address,address,address,address,uint24,uint128,uint32) external view returns(uint256,int24,int24,uint128,uint32) {
        return (1e6,0,0,1e12,uint32(block.timestamp));
    }
}
contract CallbackToken is FixtureToken {
    bool public fail;
    bool public attempted;
    bytes4 public rejectedWith;
    UnitForwarder public callbackForwarder;
    Receiver public callbackReceiver;
    bytes public callbackReport;
    constructor() FixtureToken("Fixture Alt", "ALT",18) {}
    function setFail(bool value) external { fail=value; }
    function callback(UnitForwarder f, Receiver r, bytes memory report) external { callbackForwarder=f;callbackReceiver=r;callbackReport=report; }
    function _transfer(address from,address to,uint256 amount) internal override {
        require(!fail,"FIXTURE_TRANSFER_FAILED");
        if(address(callbackForwarder)!=address(0) && !attempted) {
            attempted=true;
            try callbackForwarder.deliver(callbackReceiver,"",callbackReport) {} catch(bytes memory reason) { rejectedWith=bytes4(reason); }
        }
        super._transfer(from,to,amount);
    }
}
contract CRESettlementReceiverTest is Test {
    TokenJar jar; UniJar sale; FixtureToken usd; CallbackToken alt; FixtureToken directAsset;
    UnitForwarder forwarder; Receiver receiver;
    address alice=address(0xaaa); address bob=address(0xbbb); address treasury=address(0x777);
    bytes32 constant SOURCE=keccak256("https://eth-sepolia.blockscout.com/api/v2/stats");
    bytes32 constant OBS_HASH=keccak256("unit-only-observed-block");
    function settings(bool simulated) internal view returns(Receiver.Settings memory s) {
        s=Receiver.Settings(address(sale),address(sale).codehash,31337,address(forwarder),simulated,
            simulated?bytes32(0):keccak256("workflow"),simulated?bytes10(0):bytes10("settle"),
            simulated?address(0):alice,address(this),SOURCE,600,128,250000,200 gwei);
    }
    function setUp() public {
        vm.chainId(31337);vm.warp(10000);vm.roll(100);
        vm.setBlockhash(99,OBS_HASH);
        jar=new TokenJar();usd=new FixtureToken("Fixture USD","USD",6);alt=new CallbackToken();directAsset=new FixtureToken("Direct","DIR",18);
        ReaderFixture reader=new ReaderFixture();
        sale=new UniJar(address(jar),treasury,address(this),address(usd),address(reader),address(reader));
        jar.setReleaser(address(sale));sale.setAssetMode(address(alt),UniJar.Mode.Auction);
        sale.setAssetMode(address(directAsset),UniJar.Mode.Direct);
        sale.setPolicy(address(directAsset),UniJar.Policy(address(reader),3000,1800,600,1,100e18,100,100,7200,1));
        alt.mint(address(jar),100e18);directAsset.mint(address(jar),100e18);
        usd.mint(alice,1000e6);usd.mint(bob,1000e6);
        vm.prank(alice);usd.approve(address(sale),1000e6);vm.prank(bob);usd.approve(address(sale),1000e6);
        forwarder=new UnitForwarder();receiver=new Receiver(settings(true));
    }
    function open(bool funded) internal returns(uint256 id) {
        id=sale.openAuction(address(alt),10e18,uint64(block.timestamp+100),10e6,1e6);
        if(funded){vm.prank(alice);sale.bid(id,10e6,alice);}
    }
    function report(uint256 id,uint8 action) internal view returns(Receiver.ActionReport memory r) {
        UniJar.Lot memory lot=sale.getLot(id);
        r=Receiver.ActionReport(31337,address(sale),id,action,uint8(lot.state),lot.expiry,
            99,OBS_HASH,uint64(block.timestamp),uint64(block.timestamp+300),
            keccak256(abi.encode(id,action,lot.state,block.timestamp)),SOURCE,keccak256("unit gas fixture"),uint64(block.timestamp),1 gwei);
    }
    function send(Receiver.ActionReport memory r) internal {forwarder.deliver(receiver,"",abi.encode(r));}
    function expire() internal {vm.warp(block.timestamp+100);}

    function testFundedSettlementPaysExactWinnerAndTreasuryWithoutCustody() public {
        uint256 id=open(true);expire();Receiver.ActionReport memory r=report(id,1);send(r);
        assertEq(usd.balanceOf(treasury),10e6);assertEq(alt.balanceOf(alice),10e18);
        assertEq(uint8(sale.getLot(id).state),uint8(UniJar.State.Sold));assertEq(sale.activeId(),0);
        assertTrue(receiver.processed(r.requestId));assertEq(usd.balanceOf(address(receiver)),0);assertEq(alt.balanceOf(address(receiver)),0);
    }
    function testNoBidNeedsTwoReportsAndReturnsOnlyTheCommittedInventory() public {
        uint256 id=open(false);alt.mint(address(jar),3e18);alt.mint(address(sale),7);expire();
        send(report(id,1));assertEq(uint8(sale.getLot(id).state),uint8(UniJar.State.Unsold));assertEq(sale.activeId(),id);
        send(report(id,2));assertEq(uint8(sale.getLot(id).state),uint8(UniJar.State.Recovered));assertEq(sale.activeId(),0);
        assertEq(alt.balanceOf(address(jar)),103e18);assertEq(alt.balanceOf(address(sale)),7);
        assertGt(open(false),id);
    }
    function testArbitraryWalletAndOtherForwarderCannotDeliver() public {
        uint256 id=open(false);expire();bytes memory r=abi.encode(report(id,1));
        vm.expectRevert(Receiver.UnauthorizedForwarder.selector);receiver.onReport("",r);
        UnitForwarder other=new UnitForwarder();vm.expectRevert(Receiver.UnauthorizedForwarder.selector);other.deliver(receiver,"",r);
    }
    function testProductionAuthenticates64ByteMetadataAndAllIdentityFields() public {
        Receiver.Settings memory s=settings(false);Receiver prod=new Receiver(s);uint256 id=open(false);expire();
        bytes memory r=abi.encode(report(id,1));
        for(uint256 i;i<4;i++){
            bytes memory meta=abi.encodePacked(i==0?bytes32(0):s.workflowId,i==1?bytes10(0):s.workflowName,i==2?bob:s.workflowOwner);
            if(i<3)meta=abi.encodePacked(meta,bytes2(0)); // fourth is deliberately only 62 bytes
            vm.expectRevert(Receiver.WorkflowIdentityMismatch.selector);forwarder.deliver(prod,meta,r);
        }
        forwarder.deliver(prod,abi.encodePacked(s.workflowId,s.workflowName,s.workflowOwner,bytes2(0x1234)),r);
        assertEq(uint8(sale.getLot(id).state),uint8(UniJar.State.Unsold));assertFalse(prod.simulationOnly());
    }
    function testConstructorSeparatesSimulationAndProductionTrust() public {
        Receiver.Settings memory s=settings(false);s.workflowId=bytes32(0);
        vm.expectRevert(Receiver.InvalidConfiguration.selector);new Receiver(s);
        s=settings(true);s.workflowOwner=alice;vm.expectRevert(Receiver.InvalidConfiguration.selector);new Receiver(s);
        s=settings(true);s.forwarder=alice;vm.expectRevert(Receiver.InvalidConfiguration.selector);new Receiver(s);
        s=settings(true);s.chainId=1;vm.expectRevert(Receiver.InvalidConfiguration.selector);new Receiver(s);
        s=settings(true);s.releaserCodeHash=keccak256("wrong");vm.expectRevert(Receiver.InvalidConfiguration.selector);new Receiver(s);
    }
    function testRejectsWrongChainTargetActionAndSource() public {
        uint256 id=open(false);expire();Receiver.ActionReport memory r=report(id,1);
        r.chainId=1;vm.expectRevert(Receiver.InvalidReport.selector);send(r);
        r=report(id,1);r.releaser=address(jar);vm.expectRevert(Receiver.InvalidReport.selector);send(r);
        r=report(id,3);vm.expectRevert(Receiver.InvalidReport.selector);send(r);
        r=report(id,1);r.sourceId=bytes32(0);vm.expectRevert(Receiver.InvalidReport.selector);send(r);
        r=report(id,1);r.gasPriceWei=201 gwei;vm.expectRevert(Receiver.InvalidReport.selector);send(r);
    }
    function testCorruptedReportsAndFutureOrOldObservationsCannotExecute() public {
        uint256 id=open(false);expire();Receiver.ActionReport memory r=report(id,1);
        vm.expectRevert(Receiver.InvalidReport.selector);forwarder.deliver(receiver,"",hex"1234");
        r.observedAt=uint64(block.timestamp+1);vm.expectRevert(Receiver.StaleReport.selector);send(r);
        r=report(id,1);r.deadline=uint64(block.timestamp-1);vm.expectRevert(Receiver.StaleReport.selector);send(r);
        r=report(id,1);r.observedAt=uint64(block.timestamp-601);vm.expectRevert(Receiver.StaleReport.selector);send(r);
        r=report(id,1);r.externalObservedAt=uint64(block.timestamp-601);vm.expectRevert(Receiver.StaleReport.selector);send(r);
        r=report(id,1);r.observedBlock=100;vm.expectRevert(Receiver.StaleReport.selector);send(r);
        r=report(id,1);r.observedBlockHash=keccak256("reorg");vm.expectRevert(Receiver.ReorgedObservation.selector);send(r);
    }
    function testNotExpiredWrongExpiryStateAndUnknownLotAreRejected() public {
        uint256 id=open(false);Receiver.ActionReport memory r=report(id,1);
        vm.expectRevert(Receiver.IneligibleLot.selector);send(r);expire();
        r=report(id,1);r.expectedExpiry++;vm.expectRevert(Receiver.IneligibleLot.selector);send(r);
        r=report(id,1);r.expectedState=4;vm.expectRevert(Receiver.IneligibleLot.selector);send(r);
        r=report(id,1);r.lotId=999;vm.expectRevert();send(r);
    }
    function testDirectModeIsNeverAutomatedEvenWhenRecoverable() public {
        uint256 id=sale.openDirect(address(directAsset),1e18,uint64(block.timestamp+100));sale.cancelDirect(id);
        Receiver.ActionReport memory r=report(id,2);vm.expectRevert(Receiver.IneligibleLot.selector);send(r);
        sale.recover(id);assertEq(sale.activeId(),0);
    }
    function testReplayAndManualRaceCannotTransferTwice() public {
        uint256 id=open(true);expire();Receiver.ActionReport memory r=report(id,1);send(r);
        vm.expectRevert(Receiver.AlreadyProcessed.selector);send(r);assertEq(usd.balanceOf(treasury),10e6);
        id=open(false);expire();r=report(id,1);sale.finalizeAuction(id);
        vm.expectRevert(Receiver.IneligibleLot.selector);send(r);assertFalse(receiver.processed(r.requestId));
        sale.recover(id);assertEq(sale.activeId(),0);
    }
    function testCancelledAuctionCanBeRecoveredAndOldReportsStayInvalid() public {
        uint256 id=open(false);sale.cancelAuction(id);Receiver.ActionReport memory r=report(id,2);send(r);
        vm.expectRevert(Receiver.AlreadyProcessed.selector);send(r);assertEq(alt.balanceOf(address(jar)),100e18);
    }
    function testPauseAndRotationLeaveRefundsAndManualExitsAvailable() public {
        uint256 id=open(true);vm.prank(bob);sale.bid(id,11e6,bob);sale.setPaused(true);jar.setReleaser(bob);expire();
        receiver.setAutomationPaused(true);Receiver.ActionReport memory r=report(id,1);
        vm.expectRevert(Receiver.AutomationPaused.selector);send(r);
        vm.prank(alice);sale.withdrawRefund();assertEq(sale.credits(alice),0);
        receiver.setAutomationPaused(false);send(r);assertEq(usd.balanceOf(treasury),11e6);assertEq(alt.balanceOf(bob),10e18);
        assertEq(jar.releaser(),bob);assertTrue(sale.paused());
    }
    function testOnlyOperatorCanPauseAndManualFinalizeIgnoresReceiverPause() public {
        vm.prank(alice);vm.expectRevert(Receiver.UnauthorizedAdmin.selector);receiver.setAutomationPaused(true);
        uint256 id=open(true);expire();receiver.setAutomationPaused(true);vm.prank(bob);sale.finalizeAuction(id);
        assertEq(usd.balanceOf(treasury),10e6);
    }
    function testTransferFailureDoesNotCommitReplayIdOrAlterFunds() public {
        uint256 id=open(true);expire();Receiver.ActionReport memory r=report(id,1);alt.setFail(true);
        vm.expectRevert(Receiver.ActionFailed.selector);send(r);assertFalse(receiver.processed(r.requestId));
        assertEq(uint8(sale.getLot(id).state),1);assertEq(usd.balanceOf(treasury),0);assertEq(sale.bidLiability(),10e6);
        alt.setFail(false);send(r);assertTrue(receiver.processed(r.requestId));assertEq(usd.balanceOf(treasury),10e6);
    }
    function testReentrancyViaTrustedMockCannotCauseAnotherAction() public {
        uint256 id=open(true);expire();Receiver.ActionReport memory r=report(id,1);Receiver.ActionReport memory second=report(id,1);second.requestId=keccak256("second");
        alt.callback(forwarder,receiver,abi.encode(second));send(r);
        assertTrue(alt.attempted());assertEq(alt.rejectedWith(),Receiver.ReentrantCall.selector);
        assertFalse(receiver.processed(second.requestId));assertEq(alt.balanceOf(alice),10e18);
    }
    function testGasBoundRejectsAnUnderfundedDeliveryWithoutProcessing() public {
        uint256 id=open(false);expire();Receiver.ActionReport memory r=report(id,1);
        (bool ok,)=address(forwarder).call{gas:200000}(abi.encodeCall(UnitForwarder.deliver,(receiver,bytes(""),abi.encode(r))));
        assertFalse(ok);assertFalse(receiver.processed(r.requestId));assertEq(uint8(sale.getLot(id).state),1);
    }
    function testERC165AndContextExposeNoMutableTarget() public view {
        assertTrue(receiver.supportsInterface(type(IReceiver).interfaceId));assertTrue(receiver.supportsInterface(0x01ffc9a7));assertFalse(receiver.supportsInterface(0xffffffff));
        (uint256 chain,uint256 number,uint256 time,uint256 base,bytes32 code,uint256 active)=receiver.readContext();
        assertEq(chain,31337);assertEq(number,100);assertEq(time,10000);assertEq(base,block.basefee);assertEq(code,address(sale).codehash);assertEq(active,0);
    }
    function testFuzzFundedQuantityAndPayoutConservation(uint128 quantity,uint96 bid) public {
        quantity=uint128(bound(quantity,1,100e18));bid=uint96(bound(bid,1,1000e6));
        uint256 id=sale.openAuction(address(alt),quantity,uint64(block.timestamp+100),bid,1);
        vm.prank(alice);sale.bid(id,bid,bob);expire();send(report(id,1));
        assertEq(usd.balanceOf(treasury),bid);assertEq(alt.balanceOf(bob),quantity);assertEq(alt.balanceOf(address(jar)),100e18-quantity);
        assertEq(sale.activeId(),0);assertEq(sale.bidLiability(),0);
    }
}
