// SPDX-License-Identifier: AGPLv3
pragma solidity 0.8.4;

import "contracts/mock/MockToken.sol";

contract MockBalancerPool is MockToken {
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

    function getVault() external view returns (address) {
        return address(this);
    }

    function getPoolId() external view returns (bytes32) {
        return bytes32(0);
    }

    function getPoolTokens(bytes32 poolId)
        external
        view
        returns (
            address[] memory tokens,
            uint256[] memory balances,
            uint256 lastChangeBlock
        )
    {
        tokens = new address[](2);
        tokens[0] = token0;
        tokens[1] = token1;
        balances = new uint256[](2);
        balances[0] = reserve0;
        balances[1] = reserve1;
    }
}
