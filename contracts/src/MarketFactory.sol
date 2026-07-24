// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SplitBuyGateway} from "./SplitBuyGateway.sol";
import {MinimalProxy} from "./libraries/MinimalProxy.sol";
import {SignatureChecker} from "./libraries/SignatureChecker.sol";

/// @notice Deploys and initializes immutable EIP-1167 split-buy markets atomically.
contract MarketFactory {
    using MinimalProxy for address;
    using SignatureChecker for address;

    bytes32 public constant ADOPT_MARKET_TYPEHASH = keccak256(
        "AdoptMarket(address officialToken,address stockToken,address projectAdapter,address stockAdapter,uint16 explicitFeeBps,address feeRecipient,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant _NAME_HASH = keccak256("DEGEN PENSION MarketFactory");
    bytes32 private constant _VERSION_HASH = keccak256("1");

    SplitBuyGateway public immutable implementation;
    address public immutable projectAuthority;
    mapping(address market => bool) public isMarket;
    mapping(uint256 nonce => bool) public usedNonces;

    struct AdoptMarket {
        address officialToken;
        address stockToken;
        address projectAdapter;
        address stockAdapter;
        uint16 explicitFeeBps;
        address feeRecipient;
        uint256 nonce;
        uint256 deadline;
    }

    error ZeroProjectAuthority();
    error AuthorizationExpired(uint256 deadline);
    error NonceAlreadyUsed(uint256 nonce);
    error InvalidProjectAuthoritySignature();

    event MarketCreated(
        address indexed market,
        address indexed creator,
        address indexed officialToken,
        address stockToken,
        address projectAdapter,
        address stockAdapter,
        uint16 explicitFeeBps,
        address feeRecipient,
        uint256 nonce,
        bytes32 authorizationDigest
    );

    constructor(address projectAuthority_) {
        if (projectAuthority_ == address(0)) revert ZeroProjectAuthority();
        projectAuthority = projectAuthority_;
        implementation = new SplitBuyGateway();
    }

    function createMarket(AdoptMarket calldata adoption, bytes calldata signature) external returns (address market) {
        if (block.timestamp > adoption.deadline) revert AuthorizationExpired(adoption.deadline);
        if (usedNonces[adoption.nonce]) revert NonceAlreadyUsed(adoption.nonce);

        bytes32 digest = _hashAdoptMarket(adoption);
        if (!projectAuthority.isValidSignatureNow(digest, signature)) {
            revert InvalidProjectAuthoritySignature();
        }
        usedNonces[adoption.nonce] = true;

        market = address(implementation).clone();
        SplitBuyGateway(market)
            .initialize(
                adoption.officialToken,
                adoption.stockToken,
                adoption.projectAdapter,
                adoption.stockAdapter,
                adoption.explicitFeeBps,
                adoption.feeRecipient
            );
        isMarket[market] = true;

        emit MarketCreated(
            market,
            msg.sender,
            adoption.officialToken,
            adoption.stockToken,
            adoption.projectAdapter,
            adoption.stockAdapter,
            adoption.explicitFeeBps,
            adoption.feeRecipient,
            adoption.nonce,
            digest
        );
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(_DOMAIN_TYPEHASH, _NAME_HASH, _VERSION_HASH, block.chainid, address(this)));
    }

    function hashAdoptMarket(AdoptMarket calldata adoption) external view returns (bytes32) {
        return _hashAdoptMarket(adoption);
    }

    function _hashAdoptMarket(AdoptMarket calldata adoption) private view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                ADOPT_MARKET_TYPEHASH,
                adoption.officialToken,
                adoption.stockToken,
                adoption.projectAdapter,
                adoption.stockAdapter,
                adoption.explicitFeeBps,
                adoption.feeRecipient,
                adoption.nonce,
                adoption.deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }
}
