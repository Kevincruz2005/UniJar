// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.7.6;

import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import '@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3MintCallback.sol';
import '@uniswap/v3-core/contracts/interfaces/callback/IUniswapV3SwapCallback.sol';

interface IToken { function transferFrom(address, address, uint256) external returns (bool); }

/// @notice Owner-only controlled test liquidity and activity, bound to one actual pool.
contract LiquidityFixture is IUniswapV3MintCallback, IUniswapV3SwapCallback {
    address public immutable owner;
    IUniswapV3Pool public immutable pool;
    bool private active;
    constructor(address pool_) { owner = msg.sender; pool = IUniswapV3Pool(pool_); }
    modifier onlyOwner() { require(msg.sender == owner && !active, 'OWNER'); active = true; _; active = false; }
    function mint(int24 lower, int24 upper, uint128 liquidity) external onlyOwner {
        pool.mint(address(this), lower, upper, liquidity, '');
    }
    function swap(bool zeroForOne, int256 amount, uint160 limit) external onlyOwner {
        require(amount > 0, 'AMOUNT'); pool.swap(owner, zeroForOne, amount, limit, '');
    }
    function uniswapV3MintCallback(uint256 a, uint256 b, bytes calldata) external override {
        require(msg.sender == address(pool) && active, 'POOL'); _pay(a, b);
    }
    function uniswapV3SwapCallback(int256 a, int256 b, bytes calldata) external override {
        require(msg.sender == address(pool) && active, 'POOL'); _pay(a > 0 ? uint256(a) : 0, b > 0 ? uint256(b) : 0);
    }
    function _pay(uint256 a, uint256 b) private {
        if (a > 0) require(IToken(pool.token0()).transferFrom(owner, address(pool), a), 'TOKEN0');
        if (b > 0) require(IToken(pool.token1()).transferFrom(owner, address(pool), b), 'TOKEN1');
    }
}
