// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEligibilityChecker} from "../interfaces/IProduction.sol";
import {SignatureChecker} from "../libraries/SignatureChecker.sol";

/// @notice Privacy-preserving eligibility gate. An off-chain policy service
///         attests only that a payer/recipient pair is eligible for one market
///         until a deadline; no jurisdiction or identity data is put on-chain.
contract SignedEligibilityVerifier is IEligibilityChecker {
    using SignatureChecker for address;

    bytes32 public constant ELIGIBILITY_TYPEHASH =
        keccak256("Eligibility(address market,address payer,address recipient,uint256 validUntil,bytes32 policyHash)");
    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant _NAME_HASH = keccak256("DEGEN PENSION Eligibility");
    bytes32 private constant _VERSION_HASH = keccak256("1");

    address public immutable policyAdmin;
    address public eligibilityAuthority;
    bytes32 public policyHash;

    error UnauthorizedPolicyAdmin(address caller);
    error ZeroEligibilityAuthority();
    error ZeroPolicyHash();

    event EligibilityPolicyUpdated(
        address indexed previousAuthority,
        address indexed newAuthority,
        bytes32 indexed previousPolicyHash,
        bytes32 newPolicyHash
    );

    constructor(address policyAdmin_, address eligibilityAuthority_, bytes32 policyHash_) {
        if (policyAdmin_ == address(0) || eligibilityAuthority_ == address(0)) revert ZeroEligibilityAuthority();
        if (policyHash_ == bytes32(0)) revert ZeroPolicyHash();
        policyAdmin = policyAdmin_;
        eligibilityAuthority = eligibilityAuthority_;
        policyHash = policyHash_;
    }

    /// @notice Rotates the short-lived proof signer and/or policy version.
    /// @dev Existing proofs fail immediately after a rotation because the policy
    ///      hash is part of every signed EIP-712 message.
    function updatePolicy(address eligibilityAuthority_, bytes32 policyHash_) external {
        if (msg.sender != policyAdmin) revert UnauthorizedPolicyAdmin(msg.sender);
        if (eligibilityAuthority_ == address(0)) revert ZeroEligibilityAuthority();
        if (policyHash_ == bytes32(0)) revert ZeroPolicyHash();

        address previousAuthority = eligibilityAuthority;
        bytes32 previousPolicyHash = policyHash;
        eligibilityAuthority = eligibilityAuthority_;
        policyHash = policyHash_;

        emit EligibilityPolicyUpdated(previousAuthority, eligibilityAuthority_, previousPolicyHash, policyHash_);
    }

    function isEligible(address payer, address recipient, uint256 validUntil, bytes calldata proof)
        external
        view
        override
        returns (bool)
    {
        return _isEligible(msg.sender, payer, recipient, validUntil, proof);
    }

    /// @notice Read-only helper for preflight and monitoring. The Gateway uses
    ///         `isEligible`, which binds the market to `msg.sender`.
    function isEligibleForMarket(
        address market,
        address payer,
        address recipient,
        uint256 validUntil,
        bytes calldata proof
    ) external view returns (bool) {
        return _isEligible(market, payer, recipient, validUntil, proof);
    }

    function _isEligible(address market, address payer, address recipient, uint256 validUntil, bytes calldata proof)
        private
        view
        returns (bool)
    {
        if (payer == address(0) || recipient == address(0) || block.timestamp > validUntil) return false;
        bytes32 digest = _hashEligibility(market, payer, recipient, validUntil);
        return eligibilityAuthority.isValidSignatureNow(digest, proof);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(_DOMAIN_TYPEHASH, _NAME_HASH, _VERSION_HASH, block.chainid, address(this)));
    }

    function hashEligibility(address market, address payer, address recipient, uint256 validUntil)
        external
        view
        returns (bytes32)
    {
        return _hashEligibility(market, payer, recipient, validUntil);
    }

    function _hashEligibility(address market, address payer, address recipient, uint256 validUntil)
        private
        view
        returns (bytes32)
    {
        bytes32 structHash =
            keccak256(abi.encode(ELIGIBILITY_TYPEHASH, market, payer, recipient, validUntil, policyHash));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }
}
