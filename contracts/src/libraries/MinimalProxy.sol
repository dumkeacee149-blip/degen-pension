// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal EIP-1167 clone deployment helper.
library MinimalProxy {
    error CloneDeploymentFailed();

    function clone(address implementation) internal returns (address instance) {
        bytes memory creationCode = abi.encodePacked(
            hex"3d602d80600a3d3981f3", hex"363d3d373d3d3d363d73", implementation, hex"5af43d82803e903d91602b57fd5bf3"
        );

        assembly ("memory-safe") {
            instance := create(0, add(creationCode, 0x20), mload(creationCode))
        }

        if (instance == address(0)) revert CloneDeploymentFailed();
    }
}

