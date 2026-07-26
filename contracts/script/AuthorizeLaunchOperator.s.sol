// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProductionMarketActivator} from "../src/ProductionMarketActivator.sol";

interface VmAuthorizeOperator {
    function envAddress(string calldata name) external returns (address value);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice One-way authorization transaction sent by PROJECT_AUTHORITY before launch.
contract AuthorizeLaunchOperator {
    VmAuthorizeOperator private constant VM =
        VmAuthorizeOperator(address(uint160(uint256(keccak256("hevm cheat code")))));

    error RegistryMissingCode(address registry);
    error AlreadyAuthorized();

    function run() external {
        address registryAddress = VM.envAddress("REGISTRY_ADDRESS");
        if (registryAddress.code.length == 0) revert RegistryMissingCode(registryAddress);
        ProductionMarketActivator registry = ProductionMarketActivator(registryAddress);
        if (registry.operatorAuthorized()) revert AlreadyAuthorized();

        VM.startBroadcast();
        registry.authorizeLaunchOperator();
        VM.stopBroadcast();
    }
}
