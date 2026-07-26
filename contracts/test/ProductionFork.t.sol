// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProductionMarketActivator} from "../src/ProductionMarketActivator.sol";
import {SplitBuyGatewayV2} from "../src/SplitBuyGatewayV2.sol";
import {SignedEligibilityVerifier} from "../src/eligibility/SignedEligibilityVerifier.sol";
import {PonsProjectAdapter} from "../src/adapters/PonsProjectAdapter.sol";
import {RobinhoodQqqAdapter} from "../src/adapters/RobinhoodQqqAdapter.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IEligibilityChecker} from "../src/interfaces/IProduction.sol";

interface VmFork {
    function envOr(string calldata name, bool defaultValue) external returns (bool value);
    function createSelectFork(string calldata rpcUrl) external returns (uint256 forkId);
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function deal(address account, uint256 newBalance) external;
    function prank(address msgSender) external;
    function mockCall(address callee, bytes calldata data, bytes calldata returnData) external;
}

/// @notice Opt-in mainnet-fork proof using a real active-factory Pons token and
///         the live WETH/USDG/QQQ pools. Run with RUN_FORK_TESTS=true.
contract ProductionForkTest {
    VmFork private constant VM = VmFork(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant LIVE_PONS_TOKEN = 0x6BE64ccE9F307c01c5a22FF45f1812403d2419cD;
    address private constant QQQ = 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68;
    address private constant PRODUCTION_REGISTRY = 0x2C2cAF5D52B5e6156f65030b92163B99FccA927e;
    address private constant PRODUCTION_OPERATOR = 0x9F2A37124db1a679A6C429859105ED4220E9d783;
    address private constant OPERATOR = address(0x0B0B);
    address private constant USER = address(0xBEEF);
    uint256 private constant ELIGIBILITY_KEY = 0xE11B1E;

    struct ForkFixture {
        ProductionMarketActivator activator;
        address market;
        PonsProjectAdapter projectAdapter;
        RobinhoodQqqAdapter stockAdapter;
    }

    function testForkRealPonsAndQqqRoutesSettleAtomically() external {
        if (!VM.envOr("RUN_FORK_TESTS", false)) return;
        VM.createSelectFork("https://rpc.mainnet.chain.robinhood.com");

        ForkFixture memory f = _deployMarket();
        uint256 grossAmount = 0.01 ether;
        uint256 projectInput = grossAmount * 9_900 / 10_000;
        uint256 stockInput = grossAmount - projectInput;
        uint256 projectQuote = f.projectAdapter.quoteExactInput(projectInput);
        uint256 stockQuote = f.stockAdapter.quoteExactInput(stockInput);
        require(projectQuote > 0, "live Pons route returned zero");
        require(stockQuote > 0, "live QQQ route returned zero");

        _executeBuy(f, grossAmount, projectQuote, stockQuote);
    }

    /// @notice Rehearses the exact already-deployed and pre-authorized production
    ///         registry without changing mainnet. Only the future eligibility
    ///         signature is mocked because the official market address does not
    ///         exist until activation; signature verification is covered elsewhere.
    function testForkDeployedProductionRegistryActivatesAndSettlesRealRoutes() external {
        if (!VM.envOr("RUN_FORK_TESTS", false)) return;
        VM.createSelectFork("https://rpc.mainnet.chain.robinhood.com");

        ProductionMarketActivator activator = ProductionMarketActivator(PRODUCTION_REGISTRY);
        require(activator.operatorAuthorized(), "production operator is not authorized");
        require(activator.currentMarket() == address(0), "production registry is already active");

        VM.prank(PRODUCTION_OPERATOR);
        (address market, address projectAdapterAddress) = activator.activatePonsMarket(LIVE_PONS_TOKEN);
        require(activator.currentOfficialToken() == LIVE_PONS_TOKEN, "fork CA was not activated");
        require(activator.currentMarket() == market && activator.marketReady(), "fork market is not ready");

        PonsProjectAdapter projectAdapter = PonsProjectAdapter(projectAdapterAddress);
        RobinhoodQqqAdapter stockAdapter = activator.stockAdapter();
        uint256 grossAmount = 0.01 ether;
        uint256 projectInput = grossAmount * 9_900 / 10_000;
        uint256 stockInput = grossAmount - projectInput;
        uint256 projectQuote = projectAdapter.quoteExactInput(projectInput);
        uint256 stockQuote = stockAdapter.quoteExactInput(stockInput);
        require(projectQuote > 0 && stockQuote > 0, "production fork route returned zero");

        uint256 deadline = block.timestamp + 60;
        bytes memory placeholderProof = hex"99";
        VM.mockCall(
            address(activator.eligibilityChecker()),
            abi.encodeWithSelector(
                IEligibilityChecker.isEligible.selector, USER, USER, deadline, placeholderProof
            ),
            abi.encode(true)
        );

        uint256 projectBefore = IERC20(LIVE_PONS_TOKEN).balanceOf(USER);
        uint256 stockBefore = IERC20(QQQ).balanceOf(USER);
        VM.deal(USER, grossAmount);
        VM.prank(USER);
        (uint256 projectOut, uint256 stockOut) = SplitBuyGatewayV2(payable(market)).buyNative{value: grossAmount}(
            projectQuote * 95 / 100,
            stockQuote * 95 / 100,
            USER,
            deadline,
            deadline,
            placeholderProof
        );

        require(projectOut > 0 && stockOut > 0, "production fork output was zero");
        require(IERC20(LIVE_PONS_TOKEN).balanceOf(USER) - projectBefore == projectOut, "project token not direct");
        require(IERC20(QQQ).balanceOf(USER) - stockBefore == stockOut, "QQQ not direct");
    }

    function _deployMarket() private returns (ForkFixture memory f) {
        f.activator = new ProductionMarketActivator(
            address(this),
            OPERATOR,
            address(this),
            VM.addr(ELIGIBILITY_KEY),
            keccak256("DEGEN_PENSION_RESTRICTED_JURISDICTIONS_2026_07_25"),
            1 ether
        );
        f.activator.authorizeLaunchOperator();
        VM.prank(OPERATOR);
        address projectAdapterAddress;
        (f.market, projectAdapterAddress) = f.activator.activatePonsMarket(LIVE_PONS_TOKEN);
        f.projectAdapter = PonsProjectAdapter(projectAdapterAddress);
        f.stockAdapter = f.activator.stockAdapter();
    }

    function _executeBuy(ForkFixture memory f, uint256 grossAmount, uint256 projectQuote, uint256 stockQuote) private {
        uint256 projectBefore = IERC20(LIVE_PONS_TOKEN).balanceOf(USER);
        uint256 stockBefore = IERC20(QQQ).balanceOf(USER);
        (uint256 projectOut, uint256 stockOut) = _callBuy(f, grossAmount, projectQuote, stockQuote);

        require(projectOut >= projectQuote * 95 / 100, "project output below fork quote floor");
        require(stockOut >= stockQuote * 95 / 100, "stock output below fork quote floor");
        require(IERC20(LIVE_PONS_TOKEN).balanceOf(USER) - projectBefore == projectOut, "project not direct");
        require(IERC20(QQQ).balanceOf(USER) - stockBefore == stockOut, "QQQ not direct");
    }

    function _callBuy(ForkFixture memory f, uint256 grossAmount, uint256 projectQuote, uint256 stockQuote)
        private
        returns (uint256 projectOut, uint256 stockOut)
    {
        uint256 deadline = block.timestamp + 60;
        bytes memory proof = _proof(f, deadline);
        VM.deal(USER, grossAmount);
        VM.prank(USER);
        return SplitBuyGatewayV2(payable(f.market)).buyNative{value: grossAmount}(
            projectQuote * 95 / 100, stockQuote * 95 / 100, USER, deadline, deadline, proof
        );
    }

    function _proof(ForkFixture memory f, uint256 deadline) private returns (bytes memory proof) {
        bytes32 digest = f.activator.eligibilityChecker().hashEligibility(f.market, USER, USER, deadline);
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(ELIGIBILITY_KEY, digest);
        return abi.encodePacked(r, s, v);
    }
}
