// SPDX-License-Identifier: AGPLv3
pragma solidity 0.8.4;

contract MockBonus {

    uint256 public bonus;

    function add(uint256 amount) external {
        bonus += amount;
    }
}
