// SPDX-License-Identifier: AGPLv3
pragma solidity 0.8.4;

contract MockVesting {
    address public caller;
    mapping(address => uint256) position;

    struct AccountInfo {
        uint256 total;
        uint256 startTime;
    }

    mapping(address => AccountInfo) public accountInfos;
    uint256 public totalLockedAmount;

    function setCaller(address _caller) public {
        caller = _caller;
    }

    function vest(address user, uint256 amount) external {
        totalLockedAmount += amount;
        position[user] += amount;
    }

    function migrate(
        address account,
        uint256 vestingAmount,
        uint256 startTime
    ) external {
        require(msg.sender == caller, "migrate: !caller");
        accountInfos[account] = AccountInfo({total: vestingAmount, startTime: startTime});
    }
}
