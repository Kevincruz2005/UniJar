// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.29;
import {Test} from "forge-std/Test.sol";
import {TokenJar} from "tjar/TokenJar.sol";
import {UniJar, IReferenceReader} from "../src/UniJar.sol";
import {FixtureToken} from "../src/FixtureToken.sol";

interface IV3Factory { function createPool(address,address,uint24) external returns(address); }
interface IV3Pool {
    function initialize(uint160) external;
    function increaseObservationCardinalityNext(uint16) external;
    function observe(uint32[] calldata) external view returns(int56[] memory,uint160[] memory);
    function slot0() external view returns(uint160,int24,uint16,uint16,uint16,uint8,bool);
}
interface IFixture {
    function mint(int24,int24,uint128) external;
    function swap(bool,int256,uint160) external;
    function uniswapV3MintCallback(uint256,uint256,bytes calldata) external;
}

contract RealV3Test is Test {
    function oldDeploy(string memory artifact,bytes memory args) internal returns(address result) {
        bytes memory code=abi.encodePacked(vm.getCode(string.concat('../oracle-contracts/out/',artifact)),args);
        assembly { result := create(0,add(code,32),mload(code)) } require(result!=address(0));
    }
    function testRealV3BothOrdersAndDecimals() public { flow(true); flow(false); }
    function flow(bool assetFirst) internal {
        vm.warp(10_000);
        FixtureToken usd=new FixtureToken('Mock USD','mUSDC',6);
        FixtureToken asset=new FixtureToken('Mock Fee','mFEE',18);
        for(uint256 i; (address(asset)<address(usd))!=assetFirst && i<100; i++) asset=new FixtureToken('Mock Fee','mFEE',18);
        assertEq(address(asset)<address(usd),assetFirst);
        address factory=oldDeploy('UniswapV3Factory.sol/UniswapV3Factory.json','');
        address pool=IV3Factory(factory).createPool(address(asset),address(usd),3000);
        IV3Pool(pool).initialize(assetFirst?uint160(79228162514264337593543):uint160(79228162514264337593543950336000000));
        IV3Pool(pool).increaseObservationCardinalityNext(16);
        address fixture=oldDeploy('LiquidityFixture.sol/LiquidityFixture.json',abi.encode(pool));
        asset.mint(address(this),1e30); usd.mint(address(this),1e30);
        asset.approve(fixture,type(uint256).max); usd.approve(fixture,type(uint256).max);
        IFixture(fixture).mint(-887220,887220,1e15);
        address reader=oldDeploy('V3Reader.sol/V3Reader.json','');
        vm.expectRevert(); IReferenceReader(reader).validate(pool,address(this),address(asset),address(usd),3000);
        vm.expectRevert(); IReferenceReader(reader).validate(pool,factory,address(asset),address(usd),500);
        vm.expectRevert(); IFixture(fixture).uniswapV3MintCallback(0,0,'');
        TokenJar jar=new TokenJar();
        UniJar sale=new UniJar(address(jar),address(0x777),address(this),address(usd),reader,factory);
        jar.setReleaser(address(sale)); sale.setAssetMode(address(asset),UniJar.Mode.Direct);
        UniJar.Policy memory p=UniJar.Policy(pool,3000,1800,600,1e12,100e18,100,100,7200,1);
        sale.setPolicy(address(asset),p); asset.mint(address(jar),10e18);
        uint256 id=sale.openDirect(address(asset),1e18,uint64(block.timestamp+7200));
        vm.expectRevert(); sale.quoteDirect(id); // capacity is not history
        vm.warp(block.timestamp+1801); IFixture(fixture).mint(-887220,887220,1e9);
        (uint256 payment,bytes32 hash)=sale.quoteDirect(id);
        assertApproxEqAbs(payment,990000,100); // independent one-USD base-unit vector, tick quantization
        usd.approve(address(sale),payment); sale.fillDirect(id,payment,uint64(block.timestamp),hash,address(this));
        assertEq(usd.balanceOf(address(0x777)),payment); assertEq(sale.activeId(),0);
    }
}
