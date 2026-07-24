// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice A narrowly scoped adapter used by SplitBuyGateway.
/// @dev The gateway transfers `amountIn` to the adapter before calling
///      `swapExactInput`. Implementations must deliver the configured output
///      token directly to `recipient`.
interface ISwapAdapter {
    function inputToken() external view returns (address);

    function outputToken() external view returns (address);

    function swapExactInput(uint256 amountIn, uint256 minAmountOut, address recipient)
        external
        returns (uint256 amountOut);
}

