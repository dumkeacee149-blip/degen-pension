// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";

library SafeTransferLib {
    error TransferFailed(address token, address to, uint256 amount);
    error TransferFromFailed(address token, address from, address to, uint256 amount);

    function safeTransfer(IERC20 token, address to, uint256 amount) internal {
        (bool success, bytes memory returnData) = address(token).call(abi.encodeCall(IERC20.transfer, (to, amount)));

        if (!success || (returnData.length != 0 && !abi.decode(returnData, (bool)))) {
            revert TransferFailed(address(token), to, amount);
        }
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory returnData) =
            address(token).call(abi.encodeCall(IERC20.transferFrom, (from, to, amount)));

        if (!success || (returnData.length != 0 && !abi.decode(returnData, (bool)))) {
            revert TransferFromFailed(address(token), from, to, amount);
        }
    }
}

