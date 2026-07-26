// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MarketFactory} from "../src/MarketFactory.sol";

interface VmAdoption {
    function envAddress(string calldata name) external returns (address value);
    function envBytes(string calldata name) external returns (bytes memory value);
    function envUint(string calldata name) external returns (uint256 value);
    function startBroadcast() external;
    function stopBroadcast() external;
}

abstract contract AdoptionConfig {
    VmAdoption internal constant VM = VmAdoption(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 internal constant ROBINHOOD_MAINNET_CHAIN_ID = 4663;

    error WrongChain(uint256 actualChainId);
    error FeeBpsOverflow(uint256 value);

    function _loadAdoption() internal returns (MarketFactory factory, MarketFactory.AdoptMarket memory adoption) {
        if (block.chainid != ROBINHOOD_MAINNET_CHAIN_ID) revert WrongChain(block.chainid);

        uint256 feeBps = VM.envUint("EXPLICIT_FEE_BPS");
        if (feeBps > type(uint16).max) revert FeeBpsOverflow(feeBps);

        factory = MarketFactory(VM.envAddress("MARKET_FACTORY_ADDRESS"));
        adoption = MarketFactory.AdoptMarket({
            officialToken: VM.envAddress("OFFICIAL_TOKEN_ADDRESS"),
            stockToken: VM.envAddress("STOCK_TOKEN_ADDRESS"),
            projectAdapter: VM.envAddress("PROJECT_ADAPTER_ADDRESS"),
            stockAdapter: VM.envAddress("STOCK_ADAPTER_ADDRESS"),
            // forge-lint: disable-next-line(unsafe-typecast)
            explicitFeeBps: uint16(feeBps),
            feeRecipient: VM.envAddress("FEE_RECIPIENT"),
            nonce: VM.envUint("ADOPTION_NONCE"),
            deadline: VM.envUint("ADOPTION_DEADLINE")
        });
    }
}
