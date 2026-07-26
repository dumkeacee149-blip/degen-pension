// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SplitBuyGatewayV2} from "./SplitBuyGatewayV2.sol";
import {MinimalProxy} from "./libraries/MinimalProxy.sol";
import {SignatureChecker} from "./libraries/SignatureChecker.sol";

/// @notice Authority-adopted factory for risk-gated V2 markets.
contract MarketFactoryV2 {
    using MinimalProxy for address;
    using SignatureChecker for address;

    bytes32 public constant ADOPT_MARKET_V2_TYPEHASH = keccak256(
        "AdoptMarketV2(address officialToken,address stockToken,address projectAdapter,address stockAdapter,uint16 explicitFeeBps,address feeRecipient,address guardian,address eligibilityChecker,uint256 maxAmountIn,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant _NAME_HASH = keccak256("DEGEN PENSION MarketFactoryV2");
    bytes32 private constant _VERSION_HASH = keccak256("2");

    SplitBuyGatewayV2 public immutable implementation;
    address public immutable projectAuthority;
    mapping(address market => bool) public isMarket;
    mapping(uint256 nonce => bool) public usedNonces;

    struct AdoptMarketV2 {
        address officialToken;
        address stockToken;
        address projectAdapter;
        address stockAdapter;
        uint16 explicitFeeBps;
        address feeRecipient;
        address guardian;
        address eligibilityChecker;
        uint256 maxAmountIn;
        uint256 nonce;
        uint256 deadline;
    }

    error ZeroProjectAuthority();
    error AuthorizationExpired(uint256 deadline);
    error NonceAlreadyUsed(uint256 nonce);
    error InvalidProjectAuthoritySignature();

    event MarketCreatedV2(
        address indexed market,
        address indexed creator,
        address indexed officialToken,
        uint256 nonce,
        bytes32 authorizationDigest
    );

    constructor(address projectAuthority_) {
        if (projectAuthority_ == address(0)) revert ZeroProjectAuthority();
        projectAuthority = projectAuthority_;
        implementation = new SplitBuyGatewayV2();
    }

    function createMarket(AdoptMarketV2 calldata adoption, bytes calldata signature) external returns (address market) {
        if (block.timestamp > adoption.deadline) revert AuthorizationExpired(adoption.deadline);
        if (usedNonces[adoption.nonce]) revert NonceAlreadyUsed(adoption.nonce);

        bytes32 digest = _hashAdoptMarket(adoption);
        if (!projectAuthority.isValidSignatureNow(digest, signature)) {
            revert InvalidProjectAuthoritySignature();
        }
        usedNonces[adoption.nonce] = true;

        market = address(implementation).clone();
        SplitBuyGatewayV2(market)
            .initialize(
                adoption.officialToken,
                adoption.stockToken,
                adoption.projectAdapter,
                adoption.stockAdapter,
                adoption.explicitFeeBps,
                adoption.feeRecipient,
                adoption.guardian,
                adoption.eligibilityChecker,
                adoption.maxAmountIn
            );
        isMarket[market] = true;

        emit MarketCreatedV2(market, msg.sender, adoption.officialToken, adoption.nonce, digest);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(_DOMAIN_TYPEHASH, _NAME_HASH, _VERSION_HASH, block.chainid, address(this)));
    }

    function hashAdoptMarket(AdoptMarketV2 calldata adoption) external view returns (bytes32) {
        return _hashAdoptMarket(adoption);
    }

    function _hashAdoptMarket(AdoptMarketV2 calldata adoption) private view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ADOPT_MARKET_V2_TYPEHASH,
                adoption.officialToken,
                adoption.stockToken,
                adoption.projectAdapter,
                adoption.stockAdapter,
                adoption.explicitFeeBps,
                adoption.feeRecipient,
                adoption.guardian,
                adoption.eligibilityChecker,
                adoption.maxAmountIn,
                adoption.nonce,
                adoption.deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }
}
