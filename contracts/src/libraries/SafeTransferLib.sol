// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";

library SafeTransferLib {
    error TransferFailed(address token, address to, uint256 amount);
    error TransferFromFailed(address token, address from, address to, uint256 amount);
    error ApproveFailed(address token, address spender, uint256 amount);

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

    /// @notice Sets an exact allowance, including support for tokens that require
    ///         allowance to be reset to zero before a non-zero approval.
    function forceApprove(IERC20 token, address spender, uint256 amount) internal {
        if (_callOptionalReturnBool(token, abi.encodeCall(IERC20.approve, (spender, amount)))) return;

        if (
            !_callOptionalReturnBool(token, abi.encodeCall(IERC20.approve, (spender, 0)))
                || !_callOptionalReturnBool(token, abi.encodeCall(IERC20.approve, (spender, amount)))
        ) {
            revert ApproveFailed(address(token), spender, amount);
        }
    }

    function _callOptionalReturnBool(IERC20 token, bytes memory callData) private returns (bool) {
        (bool success, bytes memory returnData) = address(token).call(callData);
        return success && (returnData.length == 0 || (returnData.length == 32 && abi.decode(returnData, (bool))));
    }
}
