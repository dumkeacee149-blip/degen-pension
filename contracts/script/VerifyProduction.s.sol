// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProductionMarketActivator} from "../src/ProductionMarketActivator.sol";
import {SplitBuyGatewayV2} from "../src/SplitBuyGatewayV2.sol";
import {PonsProjectAdapterFactory} from "../src/adapters/PonsProjectAdapter.sol";
import {RobinhoodQqqAdapter} from "../src/adapters/RobinhoodQqqAdapter.sol";
import {SignedEligibilityVerifier} from "../src/eligibility/SignedEligibilityVerifier.sol";

interface VmVerifyProduction {
    function envAddress(string calldata name) external returns (address value);
    function envBytes32(string calldata name) external returns (bytes32 value);
    function envUint(string calldata name) external returns (uint256 value);
}

/// @notice Read-only verification of every immutable CA-independent production binding.
contract VerifyProduction {
    VmVerifyProduction private constant VM =
        VmVerifyProduction(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant ROBINHOOD_MAINNET_CHAIN_ID = 4663;

    error WrongChain(uint256 actualChainId);
    error MissingCode(address target);
    error BindingMismatch(bytes32 binding);

    event ProductionPredeploymentVerified(
        address indexed registry,
        address indexed implementation,
        address indexed eligibilityChecker,
        address stockAdapter,
        address ponsAdapterFactory,
        bool operatorAuthorized,
        uint256 chainId
    );

    function run() external returns (bool verified) {
        if (block.chainid != ROBINHOOD_MAINNET_CHAIN_ID) revert WrongChain(block.chainid);

        address registryAddress = VM.envAddress("REGISTRY_ADDRESS");
        _requireCode(registryAddress);
        ProductionMarketActivator registry = ProductionMarketActivator(registryAddress);

        if (registry.registry() != registryAddress || registry.protocolVersion() != 2) {
            revert BindingMismatch("REGISTRY_IDENTITY");
        }
        if (registry.projectAuthority() != VM.envAddress("PROJECT_AUTHORITY")) {
            revert BindingMismatch("PROJECT_AUTHORITY");
        }
        if (registry.launchOperator() != VM.envAddress("LAUNCH_OPERATOR")) {
            revert BindingMismatch("LAUNCH_OPERATOR");
        }
        if (registry.guardian() != VM.envAddress("GUARDIAN")) revert BindingMismatch("GUARDIAN");
        if (registry.maxAmountIn() != VM.envUint("MAX_AMOUNT_IN")) revert BindingMismatch("MAX_AMOUNT_IN");

        SplitBuyGatewayV2 implementation = registry.implementation();
        SignedEligibilityVerifier checker = registry.eligibilityChecker();
        RobinhoodQqqAdapter stockAdapter = registry.stockAdapter();
        PonsProjectAdapterFactory adapterFactory = registry.ponsAdapterFactory();
        _requireCode(address(implementation));
        _requireCode(address(checker));
        _requireCode(address(stockAdapter));
        _requireCode(address(adapterFactory));

        if (!implementation.initialized() || !implementation.paused()) {
            revert BindingMismatch("LOCKED_IMPLEMENTATION");
        }
        if (
            checker.policyAdmin() != registry.projectAuthority()
                || checker.eligibilityAuthority() != VM.envAddress("ELIGIBILITY_AUTHORITY")
                || checker.policyHash() != VM.envBytes32("ELIGIBILITY_POLICY_HASH")
        ) revert BindingMismatch("ELIGIBILITY_POLICY");
        if (
            address(stockAdapter.marketRegistry()) != registryAddress
                || stockAdapter.inputToken() != stockAdapter.WETH() || stockAdapter.outputToken() != stockAdapter.QQQ()
                || stockAdapter.router() != stockAdapter.SWAP_ROUTER()
                || stockAdapter.quoter() != stockAdapter.QUOTER_V2()
        ) revert BindingMismatch("QQQ_ADAPTER");
        if (adapterFactory.marketRegistry() != registryAddress) revert BindingMismatch("PONS_ADAPTER_FACTORY");

        emit ProductionPredeploymentVerified(
            registryAddress,
            address(implementation),
            address(checker),
            address(stockAdapter),
            address(adapterFactory),
            registry.operatorAuthorized(),
            block.chainid
        );
        return true;
    }

    function _requireCode(address target) private view {
        if (target.code.length == 0) revert MissingCode(target);
    }
}
