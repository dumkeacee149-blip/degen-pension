// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {ISwapAdapter} from "./interfaces/ISwapAdapter.sol";
import {IWETH} from "./interfaces/IWETH.sol";
import {SafeTransferLib} from "./libraries/SafeTransferLib.sol";

/// @notice Immutable 99/1 split-buy market initialized exactly once by MarketFactory.
/// @dev The implementation contract locks itself in its constructor. EIP-1167 clones
///      have empty storage and are initialized atomically by the factory.
contract SplitBuyGateway {
    using SafeTransferLib for IERC20;

    uint256 public constant PROJECT_BPS = 9_900;
    uint256 public constant STOCK_BPS = 100;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_EXPLICIT_FEE_BPS = 500;

    address public inputToken;
    address public officialToken;
    address public stockToken;
    address public projectAdapter;
    address public stockAdapter;
    address public feeRecipient;
    uint16 public explicitFeeBps;
    bool public initialized;

    uint256 private _entered;

    error AlreadyInitialized();
    error NotInitialized();
    error ZeroAddress();
    error AddressHasNoCode(address target);
    error IdenticalTokens();
    error AdapterInputMismatch(address adapter, address expected, address actual);
    error AdapterOutputMismatch(address adapter, address expected, address actual);
    error ExplicitFeeTooHigh(uint256 provided, uint256 maximum);
    error InvalidFeeRecipient();
    error InvalidRecipient();
    error InvalidAmount();
    error InputTransferMismatch(uint256 expected, uint256 received);
    error NativeWrapMismatch(uint256 expected, uint256 received);
    error InvalidAdapterOutput(address adapter, uint256 reported, uint256 received, uint256 minimum);
    error Reentrancy();

    event Initialized(
        address indexed inputToken,
        address indexed officialToken,
        address indexed stockToken,
        address projectAdapter,
        address stockAdapter,
        uint16 explicitFeeBps,
        address feeRecipient
    );

    event SplitBuy(
        address indexed payer,
        address indexed recipient,
        uint256 grossAmountIn,
        uint256 explicitFeeAmount,
        uint256 netAmountIn,
        uint256 projectAmountIn,
        uint256 stockAmountIn,
        uint256 projectAmountOut,
        uint256 stockAmountOut
    );

    struct BuyAmounts {
        uint256 explicitFeeAmount;
        uint256 netAmountIn;
        uint256 projectAmountIn;
        uint256 stockAmountIn;
    }

    constructor() {
        initialized = true;
    }

    modifier nonReentrant() {
        if (_entered == 2) revert Reentrancy();
        _entered = 2;
        _;
        _entered = 1;
    }

    function initialize(
        address officialToken_,
        address stockToken_,
        address projectAdapter_,
        address stockAdapter_,
        uint16 explicitFeeBps_,
        address feeRecipient_
    ) external {
        if (initialized) revert AlreadyInitialized();
        initialized = true;

        if (
            officialToken_ == address(0) || stockToken_ == address(0) || projectAdapter_ == address(0)
                || stockAdapter_ == address(0)
        ) {
            revert ZeroAddress();
        }
        if (officialToken_ == stockToken_) revert IdenticalTokens();
        if (explicitFeeBps_ > MAX_EXPLICIT_FEE_BPS) {
            revert ExplicitFeeTooHigh(explicitFeeBps_, MAX_EXPLICIT_FEE_BPS);
        }
        if (explicitFeeBps_ != 0 && (feeRecipient_ == address(0) || feeRecipient_ == address(this))) {
            revert InvalidFeeRecipient();
        }

        _requireContract(officialToken_);
        _requireContract(stockToken_);
        _requireContract(projectAdapter_);
        _requireContract(stockAdapter_);

        address projectInput = ISwapAdapter(projectAdapter_).inputToken();
        address stockInput = ISwapAdapter(stockAdapter_).inputToken();
        if (projectInput == address(0)) revert ZeroAddress();
        if (projectInput != stockInput) {
            revert AdapterInputMismatch(stockAdapter_, projectInput, stockInput);
        }
        if (projectInput == officialToken_ || projectInput == stockToken_) revert IdenticalTokens();
        _requireContract(projectInput);

        address projectOutput = ISwapAdapter(projectAdapter_).outputToken();
        if (projectOutput != officialToken_) {
            revert AdapterOutputMismatch(projectAdapter_, officialToken_, projectOutput);
        }

        address stockOutput = ISwapAdapter(stockAdapter_).outputToken();
        if (stockOutput != stockToken_) {
            revert AdapterOutputMismatch(stockAdapter_, stockToken_, stockOutput);
        }

        inputToken = projectInput;
        officialToken = officialToken_;
        stockToken = stockToken_;
        projectAdapter = projectAdapter_;
        stockAdapter = stockAdapter_;
        explicitFeeBps = explicitFeeBps_;
        feeRecipient = feeRecipient_;

        emit Initialized(
            projectInput, officialToken_, stockToken_, projectAdapter_, stockAdapter_, explicitFeeBps_, feeRecipient_
        );
    }

    /// @notice Pulls one input token amount, routes 99% and 1% through fixed adapters,
    ///         and requires both output tokens to arrive directly at `recipient`.
    function buy(uint256 amountIn, uint256 minProjectOut, uint256 minStockOut, address recipient)
        external
        nonReentrant
        returns (uint256 projectAmountOut, uint256 stockAmountOut)
    {
        _validateBuy(amountIn, recipient);
        _pullInput(amountIn);
        return _settleBuy(amountIn, minProjectOut, minStockOut, recipient);
    }

    /// @notice Wraps all msg.value into the configured input token, then executes
    ///         the same fee-first 99/1 settlement. Reverts unless inputToken is WETH-compatible.
    function buyNative(uint256 minProjectOut, uint256 minStockOut, address recipient)
        external
        payable
        nonReentrant
        returns (uint256 projectAmountOut, uint256 stockAmountOut)
    {
        _validateBuy(msg.value, recipient);
        _wrapNative(msg.value);
        return _settleBuy(msg.value, minProjectOut, minStockOut, recipient);
    }

    function _settleBuy(uint256 grossAmountIn, uint256 minProjectOut, uint256 minStockOut, address recipient)
        private
        returns (uint256 projectAmountOut, uint256 stockAmountOut)
    {
        BuyAmounts memory amounts = _calculateAmounts(grossAmountIn);
        if (amounts.projectAmountIn == 0 || amounts.stockAmountIn == 0) revert InvalidAmount();

        if (amounts.explicitFeeAmount != 0) {
            IERC20(inputToken).safeTransfer(feeRecipient, amounts.explicitFeeAmount);
        }
        projectAmountOut = _executeLeg(officialToken, projectAdapter, amounts.projectAmountIn, minProjectOut, recipient);
        stockAmountOut = _executeLeg(stockToken, stockAdapter, amounts.stockAmountIn, minStockOut, recipient);

        _emitSplitBuy(recipient, grossAmountIn, amounts, projectAmountOut, stockAmountOut);
    }

    function _calculateAmounts(uint256 grossAmountIn) private view returns (BuyAmounts memory amounts) {
        amounts.explicitFeeAmount = grossAmountIn * explicitFeeBps / BPS_DENOMINATOR;
        amounts.netAmountIn = grossAmountIn - amounts.explicitFeeAmount;
        amounts.projectAmountIn = amounts.netAmountIn * PROJECT_BPS / BPS_DENOMINATOR;
        amounts.stockAmountIn = amounts.netAmountIn - amounts.projectAmountIn;
    }

    function _pullInput(uint256 amountIn) private {
        IERC20 input = IERC20(inputToken);
        uint256 balanceBefore = input.balanceOf(address(this));
        input.safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 received = input.balanceOf(address(this)) - balanceBefore;
        if (received != amountIn) revert InputTransferMismatch(amountIn, received);
    }

    function _wrapNative(uint256 amountIn) private {
        IERC20 wrappedNative = IERC20(inputToken);
        uint256 balanceBefore = wrappedNative.balanceOf(address(this));
        IWETH(inputToken).deposit{value: amountIn}();
        uint256 received = wrappedNative.balanceOf(address(this)) - balanceBefore;
        if (received != amountIn) revert NativeWrapMismatch(amountIn, received);
    }

    function _validateBuy(uint256 amountIn, address recipient) private view {
        if (!initialized) revert NotInitialized();
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        if (amountIn == 0) revert InvalidAmount();
    }

    function _executeLeg(address outputToken, address adapter, uint256 amountIn, uint256 minimumOut, address recipient)
        private
        returns (uint256 amountOut)
    {
        uint256 balanceBefore = IERC20(outputToken).balanceOf(recipient);
        IERC20(inputToken).safeTransfer(adapter, amountIn);
        uint256 reportedOut = ISwapAdapter(adapter).swapExactInput(amountIn, minimumOut, recipient);
        amountOut = IERC20(outputToken).balanceOf(recipient) - balanceBefore;

        if (amountOut < minimumOut || amountOut != reportedOut) {
            revert InvalidAdapterOutput(adapter, reportedOut, amountOut, minimumOut);
        }
    }

    function _emitSplitBuy(
        address recipient,
        uint256 grossAmountIn,
        BuyAmounts memory amounts,
        uint256 projectAmountOut,
        uint256 stockAmountOut
    ) private {
        emit SplitBuy(
            msg.sender,
            recipient,
            grossAmountIn,
            amounts.explicitFeeAmount,
            amounts.netAmountIn,
            amounts.projectAmountIn,
            amounts.stockAmountIn,
            projectAmountOut,
            stockAmountOut
        );
    }

    function _requireContract(address target) private view {
        if (target.code.length == 0) revert AddressHasNoCode(target);
    }
}
