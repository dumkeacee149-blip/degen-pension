// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProductionMarketActivator} from "../src/ProductionMarketActivator.sol";
import {SplitBuyGatewayV2} from "../src/SplitBuyGatewayV2.sol";
import {SignedEligibilityVerifier} from "../src/eligibility/SignedEligibilityVerifier.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockWETH} from "../src/mocks/MockWETH.sol";
import {
    MockPonsLaunchFactory,
    MockPonsToken,
    MockQuoterV2,
    MockSwapRouter02,
    MockUniswapV3Factory
} from "../src/mocks/MockProduction.sol";

interface VmProduction {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function deal(address account, uint256 newBalance) external;
    function chainId(uint256 newChainId) external;
    function etch(address target, bytes calldata newRuntimeBytecode) external;
    function prank(address msgSender) external;
}

contract ProductionV2Test {
    VmProduction private constant VM = VmProduction(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address private constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address private constant QQQ = 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68;
    address private constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address private constant ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address private constant QUOTER = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    address private constant PONS_FACTORY = 0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB;
    address private constant WETH_USDG_POOL = 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca;
    address private constant USDG_QQQ_POOL = 0xEbD78dcfc8a6b3A696f1E191aD1ff321f9579f79;
    address private constant PROJECT_POOL = address(0xA11CE001);
    address private constant OPERATOR = address(0x0B0B);
    address private constant GUARDIAN = address(0xCAFE);
    address private constant USER = address(0xBEEF);

    uint256 private constant ELIGIBILITY_KEY = 0xE11B1E;
    bytes32 private constant POLICY_HASH = keccak256("DEGEN_PENSION_RESTRICTED_JURISDICTIONS_2026_07_25");
    uint256 private constant MAX_AMOUNT_IN = 10 ether;

    MockPonsToken private projectToken;

    function setUp() external {
        VM.chainId(4663);
        _installCanonicalMocks();
    }

    function testCaOnlyActivationAndAtomicNativeBuy() external {
        ProductionMarketActivator activator = _deployActivator();

        (bool unauthorized,) = _activateAsOperator(activator, address(projectToken));
        _assertFalse(unauthorized, "operator activated before authority consent");

        activator.authorizeLaunchOperator();
        (bool activated, bytes memory result) = _activateAsOperator(activator, address(projectToken));
        _assertTrue(activated, "CA-only activation failed");
        (address market, address projectAdapter) = abi.decode(result, (address, address));

        _assertEq(activator.currentOfficialToken(), address(projectToken), "official CA not registered");
        _assertEq(activator.currentMarket(), market, "current market not registered");
        _assertEq(activator.currentProjectAdapter(), projectAdapter, "project adapter not registered");
        _assertTrue(activator.isMarket(market), "market not allowlisted");
        _assertTrue(activator.marketReady(), "market did not open after atomic activation");

        SplitBuyGatewayV2 gateway = SplitBuyGatewayV2(payable(market));
        _assertEq(gateway.officialToken(), address(projectToken), "gateway CA mismatch");
        _assertEq(gateway.stockToken(), QQQ, "gateway QQQ mismatch");
        _assertEq(gateway.guardian(), address(activator), "guardian bridge mismatch");
        _assertEq(gateway.maxAmountIn(), MAX_AMOUNT_IN, "maximum input mismatch");

        uint256 deadline = block.timestamp + 60;
        bytes memory proof = _eligibilityProof(activator, market, USER, USER, deadline, ELIGIBILITY_KEY);
        VM.deal(USER, 2 ether);
        VM.prank(USER);
        (uint256 projectOut, uint256 stockOut) =
            gateway.buyNative{value: 1 ether}(1.98 ether, 0.02 ether, USER, deadline, deadline, proof);

        _assertEq(projectOut, 1.98 ether, "project output mismatch");
        _assertEq(stockOut, 0.02 ether, "stock output mismatch");
        _assertEq(projectToken.balanceOf(USER), 1.98 ether, "project token did not reach user");
        _assertEq(MockERC20(QQQ).balanceOf(USER), 0.02 ether, "QQQ did not reach user");
        _assertEq(MockERC20(WETH).balanceOf(market), 0, "gateway retained WETH");
    }

    function testFakeCaCannotActivateAndMarketCannotBeReactivated() external {
        ProductionMarketActivator activator = _deployActivator();
        activator.authorizeLaunchOperator();

        MockPonsToken fake = new MockPonsToken(PROJECT_POOL);
        (bool fakeSuccess,) = _activateAsOperator(activator, address(fake));
        _assertFalse(fakeSuccess, "non-Pons CA activated");

        (bool first,) = _activateAsOperator(activator, address(projectToken));
        _assertTrue(first, "first activation failed");
        (bool second,) = _activateAsOperator(activator, address(projectToken));
        _assertFalse(second, "market activated twice");
    }

    function testSingleReplacementWalletCanDeployAuthorizeAndActivate() external {
        ProductionMarketActivator activator = new ProductionMarketActivator(
            address(this),
            address(this),
            address(this),
            VM.addr(ELIGIBILITY_KEY),
            POLICY_HASH,
            MAX_AMOUNT_IN
        );
        activator.authorizeLaunchOperator();
        (address market,) = activator.activatePonsMarket(address(projectToken));

        _assertEq(activator.projectAuthority(), address(this), "project authority mismatch");
        _assertEq(activator.launchOperator(), address(this), "launch operator mismatch");
        _assertEq(activator.guardian(), address(this), "guardian mismatch");
        _assertEq(activator.currentMarket(), market, "replacement wallet did not activate");
        _assertTrue(activator.marketReady(), "replacement wallet market not ready");
    }

    function testGuardianPauseAndPolicyRotationFailClosed() external {
        ProductionMarketActivator activator = _deployActivator();
        activator.authorizeLaunchOperator();
        (bool activated, bytes memory result) = _activateAsOperator(activator, address(projectToken));
        _assertTrue(activated, "activation failed");
        (address market,) = abi.decode(result, (address, address));

        SignedEligibilityVerifier verifier = activator.eligibilityChecker();
        uint256 deadline = block.timestamp + 60;
        bytes memory oldProof = _eligibilityProof(activator, market, USER, USER, deadline, ELIGIBILITY_KEY);
        _assertTrue(verifier.isEligibleForMarket(market, USER, USER, deadline, oldProof), "valid proof rejected");

        uint256 newKey = 0xBADDCAFE;
        verifier.updatePolicy(VM.addr(newKey), keccak256("POLICY_V2"));
        _assertFalse(
            verifier.isEligibleForMarket(market, USER, USER, deadline, oldProof), "old proof survived policy rotation"
        );

        VM.prank(GUARDIAN);
        activator.setCurrentMarketPaused(true);
        _assertFalse(activator.marketReady(), "paused market reported ready");

        SplitBuyGatewayV2 gateway = SplitBuyGatewayV2(payable(market));
        bytes memory newProof = _eligibilityProof(activator, market, USER, USER, deadline, newKey);
        VM.deal(USER, 1 ether);
        VM.prank(USER);
        (bool buySuccess,) = address(gateway).call{value: 1 ether}(
            abi.encodeCall(SplitBuyGatewayV2.buyNative, (1, 1, USER, deadline, deadline, newProof))
        );
        _assertFalse(buySuccess, "paused market accepted a buy");
    }

    function _deployActivator() private returns (ProductionMarketActivator activator) {
        activator = new ProductionMarketActivator(
            address(this), OPERATOR, GUARDIAN, VM.addr(ELIGIBILITY_KEY), POLICY_HASH, MAX_AMOUNT_IN
        );
    }

    function _activateAsOperator(ProductionMarketActivator activator, address token)
        private
        returns (bool success, bytes memory result)
    {
        VM.prank(OPERATOR);
        return address(activator).call(abi.encodeCall(ProductionMarketActivator.activatePonsMarket, (token)));
    }

    function _eligibilityProof(
        ProductionMarketActivator activator,
        address market,
        address payer,
        address recipient,
        uint256 validUntil,
        uint256 privateKey
    ) private returns (bytes memory proof) {
        SignedEligibilityVerifier verifier = activator.eligibilityChecker();
        bytes32 digest = verifier.hashEligibility(market, payer, recipient, validUntil);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _installCanonicalMocks() private {
        MockWETH wethTemplate = new MockWETH();
        MockERC20 usdgTemplate = new MockERC20("USDG", "USDG");
        MockERC20 qqqTemplate = new MockERC20("QQQ", "QQQ");
        MockUniswapV3Factory factoryTemplate = new MockUniswapV3Factory();
        MockSwapRouter02 routerTemplate = new MockSwapRouter02();
        MockQuoterV2 quoterTemplate = new MockQuoterV2();
        MockPonsLaunchFactory ponsTemplate = new MockPonsLaunchFactory();

        VM.etch(WETH, address(wethTemplate).code);
        VM.etch(USDG, address(usdgTemplate).code);
        VM.etch(QQQ, address(qqqTemplate).code);
        VM.etch(V3_FACTORY, address(factoryTemplate).code);
        VM.etch(ROUTER, address(routerTemplate).code);
        VM.etch(QUOTER, address(quoterTemplate).code);
        VM.etch(PONS_FACTORY, address(ponsTemplate).code);
        VM.etch(WETH_USDG_POOL, hex"00");
        VM.etch(USDG_QQQ_POOL, hex"00");
        VM.etch(PROJECT_POOL, hex"00");

        MockUniswapV3Factory(V3_FACTORY).setPool(WETH, USDG, 100, WETH_USDG_POOL);
        MockUniswapV3Factory(V3_FACTORY).setPool(USDG, QQQ, 3_000, USDG_QQQ_POOL);

        projectToken = new MockPonsToken(PROJECT_POOL);
        MockUniswapV3Factory(V3_FACTORY).setPool(WETH, address(projectToken), 10_000, PROJECT_POOL);
        MockPonsLaunchFactory(PONS_FACTORY).setLaunchedToken(address(projectToken), WETH, 10_000, true);
    }

    function _assertTrue(bool value, string memory message) private pure {
        require(value, message);
    }

    function _assertFalse(bool value, string memory message) private pure {
        require(!value, message);
    }

    function _assertEq(address actual, address expected, string memory message) private pure {
        require(actual == expected, message);
    }

    function _assertEq(uint256 actual, uint256 expected, string memory message) private pure {
        require(actual == expected, message);
    }
}
