// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./MockERC20.sol";
import {IWETH} from "../interfaces/IWETH.sol";

contract MockWETH is MockERC20, IWETH {
    error NativeTransferFailed();

    constructor() MockERC20("Wrapped Ether", "WETH") {}

    receive() external payable {
        _deposit(msg.sender, msg.value);
    }

    function deposit() external payable override {
        _deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external override {
        if (balanceOf[msg.sender] < amount) revert InsufficientBalance();
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;

        (bool success,) = payable(msg.sender).call{value: amount}("");
        if (!success) revert NativeTransferFailed();
    }

    function _deposit(address account, uint256 amount) private {
        balanceOf[account] += amount;
        totalSupply += amount;
    }
}

