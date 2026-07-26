// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {IEligibilityChecker} from "./interfaces/IProduction.sol";
import {ISwapAdapter} from "./interfaces/ISwapAdapter.sol";
import {IWETH} from "./interfaces/IWETH.sol";
import {SafeTransferLib} from "./libraries/SafeTransferLib.sol";

/// @notice Production 99/1 market with immutable risk bindings and an emergency pause.
contract SplitBuyGatewayV2 {
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
    address public guardian;
    address public eligibilityChecker;
    uint256 public maxAmountIn;
    uint16 public explicitFeeBps;
    bool public initialized;
    bool public paused;

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
    error AmountExceedsLimit(uint256 provided, uint256 maximum);
    error TransactionExpired(uint256 deadline);
    error MarketPaused();
    error UnauthorizedGuardian(address caller);
    error RecipientNotEligible(address payer, address recipient);
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
        address feeRecipient,
        address guardian,
        address eligibilityChecker,
        uint256 maxAmountIn
    );
    event PauseSet(bool paused, address indexed guardian);
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
        paused = true;
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
        address feeRecipient_,
        address guardian_,
        address eligibilityChecker_,
        uint256 maxAmountIn_
    ) external {
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        paused = true;

        if (
            officialToken_ == address(0) || stockToken_ == address(0) || projectAdapter_ == address(0)
                || stockAdapter_ == address(0) || guardian_ == address(0) || eligibilityChecker_ == address(0)
        ) revert ZeroAddress();
        if (officialToken_ == stockToken_) revert IdenticalTokens();
        if (maxAmountIn_ == 0) revert InvalidAmount();
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
        _requireContract(eligibilityChecker_);

        address projectInput = ISwapAdapter(projectAdapter_).inputToken();
        address stockInput = ISwapAdapter(stockAdapter_).inputToken();
        if (projectInput == address(0)) revert ZeroAddress();
        if (projectInput != stockInput) revert AdapterInputMismatch(stockAdapter_, projectInput, stockInput);
        if (projectInput == officialToken_ || projectInput == stockToken_) revert IdenticalTokens();
        _requireContract(projectInput);

        address projectOutput = ISwapAdapter(projectAdapter_).outputToken();
        if (projectOutput != officialToken_) {
            revert AdapterOutputMismatch(projectAdapter_, officialToken_, projectOutput);
        }
        address stockOutput = ISwapAdapter(stockAdapter_).outputToken();
        if (stockOutput != stockToken_) revert AdapterOutputMismatch(stockAdapter_, stockToken_, stockOutput);

        inputToken = projectInput;
        officialToken = officialToken_;
        stockToken = stockToken_;
        projectAdapter = projectAdapter_;
        stockAdapter = stockAdapter_;
        explicitFeeBps = explicitFeeBps_;
        feeRecipient = feeRecipient_;
        guardian = guardian_;
        eligibilityChecker = eligibilityChecker_;
        maxAmountIn = maxAmountIn_;

        emit Initialized(
            projectInput,
            officialToken_,
            stockToken_,
            projectAdapter_,
            stockAdapter_,
            explicitFeeBps_,
            feeRecipient_,
            guardian_,
            eligibilityChecker_,
            maxAmountIn_
        );
    }

    function setPaused(bool paused_) external {
        if (msg.sender != guardian) revert UnauthorizedGuardian(msg.sender);
        paused = paused_;
        emit PauseSet(paused_, msg.sender);
    }

    function buy(
        uint256 amountIn,
        uint256 minProjectOut,
        uint256 minStockOut,
        address recipient,
        uint256 deadline,
        uint256 eligibilityDeadline,
        bytes calldata eligibilitySignature
    ) external nonReentrant returns (uint256 projectAmountOut, uint256 stockAmountOut) {
        _validateBuy(amountIn, recipient, deadline, eligibilityDeadline, eligibilitySignature);
        _pullInput(amountIn);
        return _settleBuy(amountIn, minProjectOut, minStockOut, recipient);
    }

    function buyNative(
        uint256 minProjectOut,
        uint256 minStockOut,
        address recipient,
        uint256 deadline,
        uint256 eligibilityDeadline,
        bytes calldata eligibilitySignature
    ) external payable nonReentrant returns (uint256 projectAmountOut, uint256 stockAmountOut) {
        _validateBuy(msg.value, recipient, deadline, eligibilityDeadline, eligibilitySignature);
        _wrapNative(msg.value);
        return _settleBuy(msg.value, minProjectOut, minStockOut, recipient);
    }

    function _validateBuy(
        uint256 amountIn,
        address recipient,
        uint256 deadline,
        uint256 eligibilityDeadline,
        bytes calldata eligibilitySignature
    ) private view {
        if (!initialized) revert NotInitialized();
        if (paused) revert MarketPaused();
        if (block.timestamp > deadline) revert TransactionExpired(deadline);
        if (recipient == address(0) || recipient == address(this)) revert InvalidRecipient();
        if (amountIn == 0) revert InvalidAmount();
        if (amountIn > maxAmountIn) revert AmountExceedsLimit(amountIn, maxAmountIn);
        if (!IEligibilityChecker(eligibilityChecker)
                .isEligible(msg.sender, recipient, eligibilityDeadline, eligibilitySignature)) {
            revert RecipientNotEligible(msg.sender, recipient);
        }
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

    function _executeLeg(address output, address adapter, uint256 amountIn, uint256 minimumOut, address recipient)
        private
        returns (uint256 amountOut)
    {
        uint256 balanceBefore = IERC20(output).balanceOf(recipient);
        IERC20(inputToken).safeTransfer(adapter, amountIn);
        uint256 reportedOut = ISwapAdapter(adapter).swapExactInput(amountIn, minimumOut, recipient);
        amountOut = IERC20(output).balanceOf(recipient) - balanceBefore;
        if (amountOut < minimumOut || amountOut != reportedOut) {
            revert InvalidAdapterOutput(adapter, reportedOut, amountOut, minimumOut);
        }
    }

    function _requireContract(address target) private view {
        if (target.code.length == 0) revert AddressHasNoCode(target);
    }
}
