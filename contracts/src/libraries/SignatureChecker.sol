// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC1271 {
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4 magicValue);
}

library SignatureChecker {
    bytes4 private constant _ERC1271_MAGIC_VALUE = 0x1626ba7e;
    uint256 private constant _SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    function isValidSignatureNow(address signer, bytes32 digest, bytes calldata signature)
        internal
        view
        returns (bool)
    {
        if (signer.code.length == 0) return _recover(digest, signature) == signer;

        (bool success, bytes memory result) =
            signer.staticcall(abi.encodeCall(IERC1271.isValidSignature, (digest, signature)));
        return success && result.length >= 32 && abi.decode(result, (bytes4)) == _ERC1271_MAGIC_VALUE;
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address recovered) {
        if (signature.length != 65) return address(0);

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }

        if (uint256(s) > _SECP256K1_HALF_ORDER) return address(0);
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}

