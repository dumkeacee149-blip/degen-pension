// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MarketFactory} from "../src/MarketFactory.sol";
import {SplitBuyGateway} from "../src/SplitBuyGateway.sol";

interface VmVerify {
    function envAddress(string calldata name) external returns (address value);
}

/// @notice Read-only post-deployment verification for the CA-independent contracts.
contract VerifyFactory {
    VmVerify private constant VM = VmVerify(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant ROBINHOOD_MAINNET_CHAIN_ID = 4663;

    error WrongChain(uint256 actualChainId);
    error MissingCode(address target);
    error AuthorityMismatch(address expected, address actual);
    error ImplementationNotLocked();

    event PredeploymentVerified(
        address indexed factory, address indexed implementation, address indexed projectAuthority, uint256 chainId
    );

    function run() external returns (bool verified) {
        if (block.chainid != ROBINHOOD_MAINNET_CHAIN_ID) revert WrongChain(block.chainid);

        address factoryAddress = VM.envAddress("MARKET_FACTORY_ADDRESS");
        address expectedAuthority = VM.envAddress("PROJECT_AUTHORITY");
        if (factoryAddress.code.length == 0) revert MissingCode(factoryAddress);

        MarketFactory factory = MarketFactory(factoryAddress);
        address actualAuthority = factory.projectAuthority();
        if (actualAuthority != expectedAuthority) {
            revert AuthorityMismatch(expectedAuthority, actualAuthority);
        }

        address implementation = address(factory.implementation());
        if (implementation.code.length == 0) revert MissingCode(implementation);
        if (!SplitBuyGateway(implementation).initialized()) revert ImplementationNotLocked();

        emit PredeploymentVerified(factoryAddress, implementation, actualAuthority, block.chainid);
        return true;
    }
}
