// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MarketFactory} from "../src/MarketFactory.sol";
import {AdoptionConfig} from "./AdoptionConfig.sol";

/// @notice Relays a signed adoption and creates the CA-bound market atomically.
contract CreateMarket is AdoptionConfig {
    event MarketActivationComplete(
        address indexed market,
        address indexed factory,
        address indexed officialToken,
        uint256 activatedBlock,
        uint256 nonce
    );

    function run() external returns (address market) {
        (MarketFactory factory, MarketFactory.AdoptMarket memory adoption) = _loadAdoption();
        bytes memory authoritySignature = VM.envBytes("ADOPTION_SIGNATURE");

        VM.startBroadcast();
        market = factory.createMarket(adoption, authoritySignature);
        VM.stopBroadcast();

        emit MarketActivationComplete(market, address(factory), adoption.officialToken, block.number, adoption.nonce);
    }
}
