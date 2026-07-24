// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";
import {ISwapAdapter} from "../interfaces/ISwapAdapter.sol";
import {SafeTransferLib} from "../libraries/SafeTransferLib.sol";

contract MockAdapter is ISwapAdapter {
    using SafeTransferLib for IERC20;

    address public immutable override inputToken;
    address public immutable override outputToken;
    uint256 public immutable rateNumerator;
    uint256 public immutable rateDenominator;

    address public deliveryToken;
    uint256 public consumedInput;
    uint256 public reportOffset;
    bool public shouldRevert;

    error ForcedFailure();
    error InvalidRate();
    error InsufficientPrefundedInput();
    error MinimumOutputNotMet();

    constructor(address inputToken_, address outputToken_, uint256 rateNumerator_, uint256 rateDenominator_) {
        if (rateDenominator_ == 0) revert InvalidRate();
        inputToken = inputToken_;
        outputToken = outputToken_;
        deliveryToken = outputToken_;
        rateNumerator = rateNumerator_;
        rateDenominator = rateDenominator_;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function setDeliveryToken(address token) external {
        deliveryToken = token;
    }

    function setReportOffset(uint256 offset) external {
        reportOffset = offset;
    }

    function swapExactInput(uint256 amountIn, uint256 minAmountOut, address recipient)
        external
        override
        returns (uint256 amountOut)
    {
        if (shouldRevert) revert ForcedFailure();
        if (IERC20(inputToken).balanceOf(address(this)) < consumedInput + amountIn) {
            revert InsufficientPrefundedInput();
        }

        consumedInput += amountIn;
        amountOut = amountIn * rateNumerator / rateDenominator;
        if (amountOut < minAmountOut) revert MinimumOutputNotMet();

        IERC20(deliveryToken).safeTransfer(recipient, amountOut);
        return amountOut + reportOffset;
    }
}

