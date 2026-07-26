// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProductionMarketActivator} from "../src/ProductionMarketActivator.sol";

interface VmDeployProduction {
    function envAddress(string calldata name) external returns (address value);
    function envBytes32(string calldata name) external returns (bytes32 value);
    function envUint(string calldata name) external returns (uint256 value);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Deploys the complete CA-independent production stack in one transaction.
contract DeployProduction {
    VmDeployProduction private constant VM =
        VmDeployProduction(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant ROBINHOOD_MAINNET_CHAIN_ID = 4663;

    error WrongChain(uint256 actualChainId);

    event ProductionPredeploymentComplete(
        address indexed registry,
        address indexed implementation,
        address indexed eligibilityChecker,
        address stockAdapter,
        address ponsAdapterFactory,
        address projectAuthority,
        address launchOperator,
        address guardian,
        address eligibilityAuthority,
        bytes32 eligibilityPolicyHash,
        uint256 maxAmountIn,
        uint256 chainId
    );

    function run() external returns (ProductionMarketActivator registry) {
        if (block.chainid != ROBINHOOD_MAINNET_CHAIN_ID) revert WrongChain(block.chainid);

        address projectAuthority = VM.envAddress("PROJECT_AUTHORITY");
        address launchOperator = VM.envAddress("LAUNCH_OPERATOR");
        address guardian = VM.envAddress("GUARDIAN");
        address eligibilityAuthority = VM.envAddress("ELIGIBILITY_AUTHORITY");
        bytes32 eligibilityPolicyHash = VM.envBytes32("ELIGIBILITY_POLICY_HASH");
        uint256 maxAmountIn = VM.envUint("MAX_AMOUNT_IN");

        VM.startBroadcast();
        registry = new ProductionMarketActivator(
            projectAuthority, launchOperator, guardian, eligibilityAuthority, eligibilityPolicyHash, maxAmountIn
        );
        VM.stopBroadcast();

        emit ProductionPredeploymentComplete(
            address(registry),
            address(registry.implementation()),
            address(registry.eligibilityChecker()),
            address(registry.stockAdapter()),
            address(registry.ponsAdapterFactory()),
            projectAuthority,
            launchOperator,
            guardian,
            eligibilityAuthority,
            eligibilityPolicyHash,
            maxAmountIn,
            block.chainid
        );
    }
}
