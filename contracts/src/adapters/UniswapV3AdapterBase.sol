// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";
import {ISwapAdapter} from "../interfaces/ISwapAdapter.sol";
import {IMarketRegistry} from "../interfaces/IProduction.sol";
import {SafeTransferLib} from "../libraries/SafeTransferLib.sol";

/// @notice Common safety envelope for exact-input Uniswap V3 adapters.
/// @dev A registered market transfers `amountIn` into the adapter immediately
///      before calling. The adapter approves only that amount and clears the
///      allowance after the router returns.
abstract contract UniswapV3AdapterBase is ISwapAdapter {
    using SafeTransferLib for IERC20;

    IMarketRegistry public immutable marketRegistry;
    address public immutable override inputToken;
    address public immutable override outputToken;
    address public immutable router;
    address public immutable quoter;

    uint256 private _entered;

    error ZeroAddress();
    error AddressHasNoCode(address target);
    error UnauthorizedMarket(address caller);
    error InvalidRecipient();
    error InvalidAmount();
    error InsufficientPrefundedInput(uint256 available, uint256 required);
    error RouterInputMismatch(uint256 expected, uint256 spent);
    error RouterOutputMismatch(uint256 reported, uint256 received, uint256 minimum);
    error Reentrancy();

    constructor(address marketRegistry_, address inputToken_, address outputToken_, address router_, address quoter_) {
        if (
            marketRegistry_ == address(0) || inputToken_ == address(0) || outputToken_ == address(0)
                || router_ == address(0) || quoter_ == address(0)
        ) revert ZeroAddress();
        _requireContract(inputToken_);
        _requireContract(outputToken_);
        _requireContract(router_);
        _requireContract(quoter_);

        marketRegistry = IMarketRegistry(marketRegistry_);
        inputToken = inputToken_;
        outputToken = outputToken_;
        router = router_;
        quoter = quoter_;
    }

    modifier nonReentrant() {
        if (_entered == 2) revert Reentrancy();
        _entered = 2;
        _;
        _entered = 1;
    }

    function swapExactInput(uint256 amountIn, uint256 minAmountOut, address recipient)
        external
        override
        nonReentrant
        returns (uint256 amountOut)
    {
        if (!marketRegistry.isMarket(msg.sender)) revert UnauthorizedMarket(msg.sender);
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        if (amountIn == 0) revert InvalidAmount();

        IERC20 input = IERC20(inputToken);
        IERC20 output = IERC20(outputToken);
        uint256 inputBefore = input.balanceOf(address(this));
        if (inputBefore < amountIn) revert InsufficientPrefundedInput(inputBefore, amountIn);
        uint256 outputBefore = output.balanceOf(recipient);

        input.forceApprove(router, amountIn);
        uint256 reportedOut = _swap(amountIn, minAmountOut, recipient);
        input.forceApprove(router, 0);

        uint256 inputAfter = input.balanceOf(address(this));
        uint256 spent = inputAfter <= inputBefore ? inputBefore - inputAfter : 0;
        if (spent != amountIn) revert RouterInputMismatch(amountIn, spent);

        amountOut = output.balanceOf(recipient) - outputBefore;
        if (amountOut < minAmountOut || amountOut != reportedOut) {
            revert RouterOutputMismatch(reportedOut, amountOut, minAmountOut);
        }
    }

    /// @notice Convenience hook for a quote service. Uniswap Quoter V2 methods
    ///         are intentionally non-view because they simulate swaps by revert.
    function quoteExactInput(uint256 amountIn) external returns (uint256 amountOut) {
        if (amountIn == 0) revert InvalidAmount();
        return _quote(amountIn);
    }

    function _swap(uint256 amountIn, uint256 minAmountOut, address recipient)
        internal
        virtual
        returns (uint256 amountOut);

    function _quote(uint256 amountIn) internal virtual returns (uint256 amountOut);

    function _requireContract(address target) internal view {
        if (target.code.length == 0) revert AddressHasNoCode(target);
    }
}
