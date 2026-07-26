// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SplitBuyGatewayV2} from "./SplitBuyGatewayV2.sol";
import {PonsProjectAdapterFactory} from "./adapters/PonsProjectAdapter.sol";
import {RobinhoodQqqAdapter} from "./adapters/RobinhoodQqqAdapter.sol";
import {SignedEligibilityVerifier} from "./eligibility/SignedEligibilityVerifier.sol";
import {MinimalProxy} from "./libraries/MinimalProxy.sol";

/// @notice Predeployed CA-only launch registry for the canonical Pons route.
/// @dev The project authority performs one pre-launch authorization. At launch,
///      the fixed operator supplies only the official CA; every other market
///      binding was made immutable when this registry was deployed.
contract ProductionMarketActivator {
    using MinimalProxy for address;

    uint256 public constant ROBINHOOD_CHAIN_ID = 4663;
    uint256 public constant PROTOCOL_VERSION = 2;
    address public constant CANONICAL_QQQ = 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68;

    address public immutable projectAuthority;
    address public immutable launchOperator;
    address public immutable guardian;
    uint256 public immutable maxAmountIn;

    SplitBuyGatewayV2 public immutable implementation;
    SignedEligibilityVerifier public immutable eligibilityChecker;
    RobinhoodQqqAdapter public immutable stockAdapter;
    PonsProjectAdapterFactory public immutable ponsAdapterFactory;

    bool public operatorAuthorized;
    address public currentMarket;
    address public currentOfficialToken;
    address public currentProjectAdapter;
    uint256 public activatedBlock;
    uint256 public activationNonce;
    mapping(address market => bool) public isMarket;

    error WrongChain(uint256 actualChainId);
    error ZeroAddress();
    error InvalidMaxAmountIn();
    error UnauthorizedProjectAuthority(address caller);
    error UnauthorizedLaunchOperator(address caller);
    error UnauthorizedGuardian(address caller);
    error LaunchOperatorNotAuthorized();
    error LaunchOperatorAlreadyAuthorized();
    error MarketAlreadyActivated(address market);
    error NoActiveMarket();
    error OldMarketNotPaused(address market);

    event LaunchOperatorAuthorized(address indexed projectAuthority, address indexed launchOperator);
    event PonsMarketActivated(
        uint256 indexed version,
        address indexed officialToken,
        address indexed market,
        address projectAdapter,
        address stockAdapter,
        uint256 activatedBlock,
        bool replacement
    );
    event CurrentMarketPauseSet(address indexed market, bool paused, address indexed guardian);

    constructor(
        address projectAuthority_,
        address launchOperator_,
        address guardian_,
        address eligibilityAuthority_,
        bytes32 eligibilityPolicyHash_,
        uint256 maxAmountIn_
    ) {
        if (block.chainid != ROBINHOOD_CHAIN_ID) revert WrongChain(block.chainid);
        if (
            projectAuthority_ == address(0) || launchOperator_ == address(0) || guardian_ == address(0)
                || eligibilityAuthority_ == address(0)
        ) revert ZeroAddress();
        if (maxAmountIn_ == 0) revert InvalidMaxAmountIn();

        projectAuthority = projectAuthority_;
        launchOperator = launchOperator_;
        guardian = guardian_;
        maxAmountIn = maxAmountIn_;

        implementation = new SplitBuyGatewayV2();
        eligibilityChecker =
            new SignedEligibilityVerifier(projectAuthority_, eligibilityAuthority_, eligibilityPolicyHash_);
        stockAdapter = new RobinhoodQqqAdapter(address(this));
        ponsAdapterFactory = new PonsProjectAdapterFactory(address(this));
    }

    /// @notice One-way pre-launch authorization. It cannot be performed by the
    ///         deployer or operator unless that address is also projectAuthority.
    function authorizeLaunchOperator() external {
        if (msg.sender != projectAuthority) revert UnauthorizedProjectAuthority(msg.sender);
        if (operatorAuthorized) revert LaunchOperatorAlreadyAuthorized();
        operatorAuthorized = true;
        emit LaunchOperatorAuthorized(msg.sender, launchOperator);
    }

    /// @notice Launch-day path. The only variable input is the official Pons CA.
    function activatePonsMarket(address officialToken) external returns (address market, address projectAdapter) {
        if (msg.sender != launchOperator) revert UnauthorizedLaunchOperator(msg.sender);
        if (!operatorAuthorized) revert LaunchOperatorNotAuthorized();
        if (currentMarket != address(0)) revert MarketAlreadyActivated(currentMarket);
        (market, projectAdapter) = _activate(officialToken, false);
    }

    /// @notice Explicit versioned replacement. The guardian must first pause the
    ///         old market; it is then permanently removed from the adapter registry.
    function replacePonsMarket(address officialToken) external returns (address market, address projectAdapter) {
        if (msg.sender != guardian) revert UnauthorizedGuardian(msg.sender);
        address oldMarket = currentMarket;
        if (oldMarket == address(0)) revert NoActiveMarket();
        if (!SplitBuyGatewayV2(payable(oldMarket)).paused()) revert OldMarketNotPaused(oldMarket);
        isMarket[oldMarket] = false;
        (market, projectAdapter) = _activate(officialToken, true);
    }

    function setCurrentMarketPaused(bool paused_) external {
        if (msg.sender != guardian) revert UnauthorizedGuardian(msg.sender);
        address market = currentMarket;
        if (market == address(0)) revert NoActiveMarket();
        SplitBuyGatewayV2(payable(market)).setPaused(paused_);
        emit CurrentMarketPauseSet(market, paused_, msg.sender);
    }

    function marketReady() external view returns (bool) {
        address market = currentMarket;
        return market != address(0) && isMarket[market] && !SplitBuyGatewayV2(payable(market)).paused();
    }

    function registry() external view returns (address) {
        return address(this);
    }

    function protocolVersion() external pure returns (uint256) {
        return PROTOCOL_VERSION;
    }

    function currentStockAdapter() external view returns (address) {
        return address(stockAdapter);
    }

    function currentActivatedBlock() external view returns (uint256) {
        return activatedBlock;
    }

    function currentVersion() external view returns (uint256) {
        return activationNonce;
    }

    function currentPolicyHash() external view returns (bytes32) {
        return eligibilityChecker.policyHash();
    }

    function _activate(address officialToken, bool replacement)
        private
        returns (address market, address projectAdapter)
    {
        projectAdapter = ponsAdapterFactory.adapterFor(officialToken);
        if (projectAdapter == address(0)) {
            projectAdapter = ponsAdapterFactory.createAdapter(officialToken);
        }

        market = address(implementation).clone();
        SplitBuyGatewayV2 gateway = SplitBuyGatewayV2(payable(market));
        gateway.initialize(
            officialToken,
            CANONICAL_QQQ,
            projectAdapter,
            address(stockAdapter),
            0,
            address(0),
            address(this),
            address(eligibilityChecker),
            maxAmountIn
        );
        isMarket[market] = true;
        gateway.setPaused(false);

        currentMarket = market;
        currentOfficialToken = officialToken;
        currentProjectAdapter = projectAdapter;
        activatedBlock = block.number;
        activationNonce += 1;

        emit PonsMarketActivated(
            activationNonce, officialToken, market, projectAdapter, address(stockAdapter), block.number, replacement
        );
    }
}
