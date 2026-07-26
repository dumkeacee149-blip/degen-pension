// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProductionMarketActivator} from "../src/ProductionMarketActivator.sol";
import {SplitBuyGatewayV2} from "../src/SplitBuyGatewayV2.sol";

interface VmActivatePons {
    function envAddress(string calldata name) external returns (address value);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Final launch transaction. OFFICIAL_TOKEN_ADDRESS is the only variable market input.
contract ActivatePonsMarket {
    VmActivatePons private constant VM = VmActivatePons(address(uint160(uint256(keccak256("hevm cheat code")))));

    error RegistryMissingCode(address registry);
    error OperatorNotAuthorized();
    error MarketAlreadyActive(address market);
    error ActivationMismatch();

    event ProductionMarketLive(
        address indexed registry,
        address indexed officialToken,
        address indexed market,
        address projectAdapter,
        address stockAdapter,
        uint256 activatedBlock
    );

    function run() external returns (address market, address projectAdapter) {
        address registryAddress = VM.envAddress("REGISTRY_ADDRESS");
        address officialToken = VM.envAddress("OFFICIAL_TOKEN_ADDRESS");
        if (registryAddress.code.length == 0) revert RegistryMissingCode(registryAddress);

        ProductionMarketActivator registry = ProductionMarketActivator(registryAddress);
        if (!registry.operatorAuthorized()) revert OperatorNotAuthorized();
        if (registry.currentMarket() != address(0)) revert MarketAlreadyActive(registry.currentMarket());

        VM.startBroadcast();
        (market, projectAdapter) = registry.activatePonsMarket(officialToken);
        VM.stopBroadcast();

        SplitBuyGatewayV2 gateway = SplitBuyGatewayV2(payable(market));
        if (
            registry.currentMarket() != market || registry.currentOfficialToken() != officialToken
                || registry.currentProjectAdapter() != projectAdapter || !registry.isMarket(market)
                || !registry.marketReady() || gateway.officialToken() != officialToken
                || gateway.projectAdapter() != projectAdapter
        ) revert ActivationMismatch();

        emit ProductionMarketLive(
            registryAddress,
            officialToken,
            market,
            projectAdapter,
            address(registry.stockAdapter()),
            registry.activatedBlock()
        );
    }
}
