// SPDX-License-Identifier: AGPLv3
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IVester {
    function vest(address account, uint256 amount) external;
}

interface IDistributer{
    function burn(uint256 amount) external;
}

contract MockBurner {
    using SafeERC20 for IERC20;

    address public distributer;
    address public vester;
    address public gro;

    function setDependencies(address dist, address vest, address token) public {
        distributer = dist;
        vester = vest;
        gro = token;
    }

    function burn(uint256 amount) external {

        IERC20(gro).safeTransferFrom(msg.sender, address(this), amount);
        IDistributer(distributer).burn(amount);
        IVester(vester).vest(msg.sender, amount);
    }
}
