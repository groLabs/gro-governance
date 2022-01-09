// SPDX-License-Identifier: AGPLv3
pragma solidity 0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockMigrator is Ownable {
    using SafeERC20 for IERC20;

    address public caller;
    address public receiver;

    mapping(address => address) public tokens;

    constructor(
        address _caller,
        address _receiver,
        address[] memory oldTokens,
        address[] memory newTokens
    ) {
        caller = _caller;
        receiver = _receiver;
        for (uint256 i = 0; i < oldTokens.length; ++i) {
            tokens[oldTokens[i]] = newTokens[i];
        }
    }

    function setCaller(address _caller) external onlyOwner {
        caller = _caller;
    }

    function setReceiver(address _receiver) external onlyOwner {
        receiver = _receiver;
    }

    function addNewToken(address oldToken, address newToken) external onlyOwner {
        tokens[oldToken] = newToken;
    }

    function migrate(IERC20 token) external returns (IERC20) {
        require(msg.sender == caller, "migrate: !caller");
        require(receiver != address(0), "migrate: !receiver");
        address nt = tokens[address(token)];
        require(nt != address(0), "migrate: !newToken");
        IERC20 newToken = IERC20(nt);

        uint256 bal = token.balanceOf(msg.sender);
        if (bal > 0) {
            token.safeTransferFrom(msg.sender, receiver, bal);
            newToken.safeTransfer(msg.sender, bal);
        }
        return newToken;
    }
}
