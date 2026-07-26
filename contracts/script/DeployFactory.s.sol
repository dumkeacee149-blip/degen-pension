// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MarketFactory} from "../src/MarketFactory.sol";

interface VmDeploy {
    function envAddress(string calldata name) external returns (address value);
    function startBroadcast() external;
    function stopBroadcast() external;
}

/// @notice Deploys only the CA-independent production foundation.
/// @dev The project authority is immutable. Use the final EOA or ERC-1271 signer.
contract DeployFactory {
    VmDeploy private constant VM = VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant ROBINHOOD_MAINNET_CHAIN_ID = 4663;

    error WrongChain(uint256 actualChainId);
    error ZeroProjectAuthority();

    event PredeploymentComplete(
        address indexed factory, address indexed implementation, address indexed projectAuthority, uint256 chainId
    );

    function run() external returns (MarketFactory factory) {
        if (block.chainid != ROBINHOOD_MAINNET_CHAIN_ID) revert WrongChain(block.chainid);

        address projectAuthority = VM.envAddress("PROJECT_AUTHORITY");
        if (projectAuthority == address(0)) revert ZeroProjectAuthority();

        VM.startBroadcast();
        factory = new MarketFactory(projectAuthority);
        VM.stopBroadcast();

        emit PredeploymentComplete(address(factory), address(factory.implementation()), projectAuthority, block.chainid);
    }
}
