// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MarketFactory} from "../src/MarketFactory.sol";
import {AdoptionConfig} from "./AdoptionConfig.sol";

/// @notice Prints the exact EIP-712 digest the immutable project authority signs.
contract PrintAdoptionDigest is AdoptionConfig {
    event AdoptionDigest(bytes32 indexed digest, address indexed factory, uint256 nonce, uint256 deadline);

    function run() external returns (bytes32 digest) {
        (MarketFactory factory, MarketFactory.AdoptMarket memory adoption) = _loadAdoption();
        digest = factory.hashAdoptMarket(adoption);
        emit AdoptionDigest(digest, address(factory), adoption.nonce, adoption.deadline);
    }
}
