// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.7.6;

import '@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
// Compile the original factory/pool graph in this project only.
import '@uniswap/v3-core/contracts/UniswapV3Factory.sol';

contract V3Reader {
    function validate(address pool, address factory, address asset, address payout, uint24 fee) public view {
        require(asset != payout && asset != address(0) && payout != address(0), 'PAIR');
        IUniswapV3Pool p = IUniswapV3Pool(pool);
        (address a, address b) = asset < payout ? (asset, payout) : (payout, asset);
        require(p.factory() == factory && p.token0() == a && p.token1() == b && p.fee() == fee, 'IDENTITY');
        require(IUniswapV3Factory(factory).getPool(a, b, fee) == pool, 'FACTORY');
    }

    function read(address pool, address factory, address asset, address payout, uint24 fee, uint128 quantity, uint32 window)
        external view returns (uint256 quote, int24 averageTick, int24 spotTick, uint128 harmonicLiquidity, uint32 latest)
    {
        validate(pool, factory, asset, payout, fee);
        (averageTick, harmonicLiquidity) = OracleLibrary.consult(pool, window);
        uint16 index;
        (, spotTick, index,,,,) = IUniswapV3Pool(pool).slot0();
        (latest,,,) = IUniswapV3Pool(pool).observations(index);
        quote = OracleLibrary.getQuoteAtTick(averageTick, quantity, asset, payout);
    }
}
