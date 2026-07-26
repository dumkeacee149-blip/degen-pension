// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    IPonsLaunchFactory,
    IPonsLaunchToken,
    IQuoterV2,
    ISwapRouter02,
    IUniswapV3Factory
} from "../interfaces/IProduction.sol";
import {UniswapV3AdapterBase} from "./UniswapV3AdapterBase.sol";

/// @notice One immutable Pons project-token adapter per official CA.
contract PonsProjectAdapter is UniswapV3AdapterBase {
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;
    address public constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address public constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address public constant SWAP_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address public constant QUOTER_V2 = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    uint24 public constant POOL_FEE = 10_000;

    address public immutable pool;

    error WrongChain(uint256 actualChainId);
    error PoolMismatch(address expected, address actual);

    constructor(address marketRegistry_, address officialToken_, address pool_)
        UniswapV3AdapterBase(marketRegistry_, WETH, officialToken_, SWAP_ROUTER, QUOTER_V2)
    {
        if (block.chainid != ROBINHOOD_CHAIN_ID) revert WrongChain(block.chainid);
        _requireContract(V3_FACTORY);
        _requireContract(pool_);
        address canonicalPool = IUniswapV3Factory(V3_FACTORY).getPool(WETH, officialToken_, POOL_FEE);
        if (canonicalPool != pool_) revert PoolMismatch(pool_, canonicalPool);
        pool = pool_;
    }

    function path() public view returns (bytes memory) {
        return abi.encodePacked(WETH, POOL_FEE, outputToken);
    }

    function _swap(uint256 amountIn, uint256 minAmountOut, address recipient)
        internal
        override
        returns (uint256 amountOut)
    {
        return ISwapRouter02(SWAP_ROUTER)
            .exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                    tokenIn: WETH,
                    tokenOut: outputToken,
                    fee: POOL_FEE,
                    recipient: recipient,
                    amountIn: amountIn,
                    amountOutMinimum: minAmountOut,
                    sqrtPriceLimitX96: 0
                })
            );
    }

    function _quote(uint256 amountIn) internal override returns (uint256 amountOut) {
        (amountOut,,,) = IQuoterV2(QUOTER_V2)
            .quoteExactInputSingle(
                IQuoterV2.QuoteExactInputSingleParams({
                    tokenIn: WETH, tokenOut: outputToken, amountIn: amountIn, fee: POOL_FEE, sqrtPriceLimitX96: 0
                })
            );
    }
}

/// @notice Permissionless deterministic factory. It will only create adapters
///         for tokens recognized by the active official Pons launch factory and
///         by the fixed Robinhood Uniswap V3 1% pool.
contract PonsProjectAdapterFactory {
    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;
    address public constant PONS_FACTORY = 0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB;
    address public constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address public constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address public constant SWAP_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address public constant QUOTER_V2 = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    uint24 public constant POOL_FEE = 10_000;

    address public immutable marketRegistry;
    mapping(address officialToken => address adapter) public adapterFor;

    error WrongChain(uint256 actualChainId);
    error ZeroAddress();
    error AddressHasNoCode(address target);
    error AdapterAlreadyExists(address officialToken, address adapter);
    error NotActivePonsToken(address officialToken);
    error InvalidPonsPair(address expected, address actual);
    error InvalidPonsFee(uint24 expected, uint24 actual);
    error InvalidPonsPool(address expected, address actual);

    event PonsAdapterCreated(address indexed officialToken, address indexed pool, address indexed adapter);

    constructor(address marketRegistry_) {
        if (block.chainid != ROBINHOOD_CHAIN_ID) revert WrongChain(block.chainid);
        if (marketRegistry_ == address(0)) revert ZeroAddress();
        _requireContract(PONS_FACTORY);
        _requireContract(WETH);
        _requireContract(V3_FACTORY);
        _requireContract(SWAP_ROUTER);
        _requireContract(QUOTER_V2);
        marketRegistry = marketRegistry_;
    }

    function createAdapter(address officialToken) external returns (address adapter) {
        if (officialToken == address(0)) revert ZeroAddress();
        _requireContract(officialToken);
        address existing = adapterFor[officialToken];
        if (existing != address(0)) revert AdapterAlreadyExists(officialToken, existing);

        IPonsLaunchFactory.LaunchedToken memory launched =
            IPonsLaunchFactory(PONS_FACTORY).getLaunchedToken(officialToken);
        if (!launched.exists || launched.token != officialToken) revert NotActivePonsToken(officialToken);
        if (launched.pairedToken != WETH) revert InvalidPonsPair(WETH, launched.pairedToken);
        if (launched.poolFee != POOL_FEE) revert InvalidPonsFee(POOL_FEE, launched.poolFee);

        address canonicalPool = IUniswapV3Factory(V3_FACTORY).getPool(WETH, officialToken, POOL_FEE);
        _requireContract(canonicalPool);
        address tokenPool = IPonsLaunchToken(officialToken).liquidityPool();
        if (tokenPool != canonicalPool) revert InvalidPonsPool(canonicalPool, tokenPool);

        bytes32 salt = keccak256(abi.encode(officialToken));
        adapter = address(new PonsProjectAdapter{salt: salt}(marketRegistry, officialToken, canonicalPool));
        adapterFor[officialToken] = adapter;
        emit PonsAdapterCreated(officialToken, canonicalPool, adapter);
    }

    function predictAdapter(address officialToken, address pool) external view returns (address predicted) {
        bytes32 salt = keccak256(abi.encode(officialToken));
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(type(PonsProjectAdapter).creationCode, abi.encode(marketRegistry, officialToken, pool))
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }

    function _requireContract(address target) private view {
        if (target.code.length == 0) revert AddressHasNoCode(target);
    }
}
