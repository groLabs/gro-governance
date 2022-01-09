// SPDX-License-Identifier: AGPLv3
pragma solidity 0.8.4;

import "contracts/mock/MockToken.sol";

contract MockUniswapPool is MockToken {
    address public token0;
    address public token1;
    uint112 public reserve0;
    uint112 public reserve1;

    constructor(string memory name, string memory symbol) MockToken(name, symbol) {}

    function setToken0(address token, uint112 reserve) external {
        token0 = token;
        reserve0 = reserve;
    }

    function setToken1(address token, uint112 reserve) external {
        token1 = token;
        reserve1 = reserve;
    }

    function getReserves()
        external
        view
        returns (
            uint112 _reserve0,
            uint112 _reserve1,
            uint32 _blockTimestampLast
        )
    {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
    }
}
