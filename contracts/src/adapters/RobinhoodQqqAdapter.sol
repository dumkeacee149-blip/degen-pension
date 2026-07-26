// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IQuoterV2, ISwapRouter02, IUniswapV3Factory} from "../interfaces/IProduction.sol";
import {UniswapV3AdapterBase} from "./UniswapV3AdapterBase.sol";

/// @notice Production stock leg fixed to WETH -> USDG -> canonical QQQ.
/// @dev All venue, token, fee-tier, and pool addresses are immutable constants.
contract RobinhoodQqqAdapter is UniswapV3AdapterBase {
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;

    address public constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address public constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address public constant QQQ = 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68;

    address public constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address public constant SWAP_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address public constant QUOTER_V2 = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;

    uint24 public constant WETH_USDG_FEE = 100;
    uint24 public constant USDG_QQQ_FEE = 3000;
    address public constant WETH_USDG_POOL = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;
    address public constant USDG_QQQ_POOL = 0xEbD78dcfc8a6b3A696f1E191aD1ff321f9579f79;

    error WrongChain(uint256 actualChainId);
    error PoolMismatch(address expected, address actual);

    constructor(address marketRegistry_) UniswapV3AdapterBase(marketRegistry_, WETH, QQQ, SWAP_ROUTER, QUOTER_V2) {
        if (block.chainid != ROBINHOOD_CHAIN_ID) revert WrongChain(block.chainid);
        _requireContract(V3_FACTORY);
        _requireContract(USDG);
        _requireContract(WETH_USDG_POOL);
        _requireContract(USDG_QQQ_POOL);

        address wethUsdgPool = IUniswapV3Factory(V3_FACTORY).getPool(WETH, USDG, WETH_USDG_FEE);
        if (wethUsdgPool != WETH_USDG_POOL) revert PoolMismatch(WETH_USDG_POOL, wethUsdgPool);
        address usdgQqqPool = IUniswapV3Factory(V3_FACTORY).getPool(USDG, QQQ, USDG_QQQ_FEE);
        if (usdgQqqPool != USDG_QQQ_POOL) revert PoolMismatch(USDG_QQQ_POOL, usdgQqqPool);
    }

    function path() public pure returns (bytes memory) {
        return abi.encodePacked(WETH, WETH_USDG_FEE, USDG, USDG_QQQ_FEE, QQQ);
    }

    function _swap(uint256 amountIn, uint256 minAmountOut, address recipient)
        internal
        override
        returns (uint256 amountOut)
    {
        return ISwapRouter02(SWAP_ROUTER)
            .exactInput(
                ISwapRouter02.ExactInputParams({
                    path: path(), recipient: recipient, amountIn: amountIn, amountOutMinimum: minAmountOut
                })
            );
    }

    function _quote(uint256 amountIn) internal override returns (uint256 amountOut) {
        (amountOut,,,) = IQuoterV2(QUOTER_V2).quoteExactInput(path(), amountIn);
    }
}
