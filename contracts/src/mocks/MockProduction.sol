// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../interfaces/IERC20.sol";
import {IPonsLaunchFactory, IQuoterV2, ISwapRouter02, IUniswapV3Factory} from "../interfaces/IProduction.sol";
import {MockERC20} from "./MockERC20.sol";

contract MockMarketRegistry {
    mapping(address market => bool) public isMarket;

    function setMarket(address market, bool allowed) external {
        isMarket[market] = allowed;
    }
}

contract MockSwapRouter02 is ISwapRouter02 {
    error MinimumOutputNotMet(uint256 amountOut, uint256 minimum);

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut) {
        address tokenIn = _addressAt(params.path, 0);
        address tokenOut = _addressAt(params.path, params.path.length - 20);
        return _swap(tokenIn, tokenOut, params.recipient, params.amountIn, params.amountOutMinimum);
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut) {
        return _swap(params.tokenIn, params.tokenOut, params.recipient, params.amountIn, params.amountOutMinimum);
    }

    function _swap(address tokenIn, address tokenOut, address recipient, uint256 amountIn, uint256 minimum)
        private
        returns (uint256 amountOut)
    {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        amountOut = amountIn * 2;
        if (amountOut < minimum) revert MinimumOutputNotMet(amountOut, minimum);
        MockERC20(tokenOut).mint(recipient, amountOut);
    }

    function _addressAt(bytes calldata data, uint256 offset) private pure returns (address value) {
        assembly ("memory-safe") {
            value := shr(96, calldataload(add(data.offset, offset)))
        }
    }
}

contract MockQuoterV2 is IQuoterV2 {
    function quoteExactInput(bytes calldata, uint256 amountIn)
        external
        pure
        returns (uint256 amountOut, uint160[] memory prices, uint32[] memory ticks, uint256 gasEstimate)
    {
        prices = new uint160[](2);
        ticks = new uint32[](2);
        return (amountIn * 2, prices, ticks, 100_000);
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams calldata params)
        external
        pure
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)
    {
        return (params.amountIn * 2, 0, 0, 70_000);
    }
}

contract MockUniswapV3Factory is IUniswapV3Factory {
    mapping(bytes32 key => address pool) private _pool;

    function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
        _pool[_key(tokenA, tokenB, fee)] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool) {
        return _pool[_key(tokenA, tokenB, fee)];
    }

    function _key(address tokenA, address tokenB, uint24 fee) private pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(token0, token1, fee));
    }
}

contract MockPonsLaunchFactory is IPonsLaunchFactory {
    mapping(address token => LaunchedToken launched) private _launches;

    function setLaunchedToken(address token, address pairedToken, uint24 poolFee, bool exists) external {
        _launches[token] = LaunchedToken({
            token: token,
            deployer: msg.sender,
            pairedToken: pairedToken,
            positionManager: address(0x1234),
            positionId: 1,
            dexId: 1,
            launchConfigId: 1,
            restrictionsEndBlock: 0,
            supply: 1_000_000_000 ether,
            isToken0: token < pairedToken,
            poolFee: poolFee,
            exists: exists,
            initialBuyAmount: 0
        });
    }

    function getLaunchedToken(address token) external view returns (LaunchedToken memory launched) {
        return _launches[token];
    }
}

contract MockPonsToken is MockERC20 {
    address public immutable liquidityPool;

    constructor(address pool_) MockERC20("Pons Project", "PONS-PROJECT") {
        liquidityPool = pool_;
    }
}
