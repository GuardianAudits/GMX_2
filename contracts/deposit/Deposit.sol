// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.0;

// @title Deposit
// @dev Struct for deposits
library Deposit {
    // @dev there is a limit on the number of fields a struct can have when being passed
    // or returned as a memory variable which can cause "Stack too deep" errors
    // use sub-structs to avoid this issue
    // @param addresses address values
    // @param numbers number values
    // @param flags boolean values
    // @param data for any additional data
    struct Props {
        Addresses addresses;
        Numbers numbers;
        Flags flags;
        bytes data;
    }

    // @param account the account depositing liquidity
    // @param receiver the address to send the liquidity tokens to
    // @param callbackContract the callback contract
    // @param market the market to deposit to
    struct Addresses {
        address account;
        address receiver;
        address callbackContract;
        address market;
    }

    // @param longTokenAmount the amount of long tokens to deposit
    // @param shortTokenAmount the amount of short tokens to deposit
    // @param minMarketTokens the minimum acceptable number of liquidity tokens
    // @param updatedAtBlock the block that the deposit was last updated at
    // sending funds back to the user in case the deposit gets cancelled
    // @param executionFee the execution fee for keepers
    // @param callbackGasLimit the gas limit for the callbackContract
    struct Numbers {
        uint256 longTokenAmount;
        uint256 shortTokenAmount;
        uint256 minMarketTokens;
        uint256 updatedAtBlock;
        uint256 executionFee;
        uint256 callbackGasLimit;
    }

    // @param shouldUnwrapNativeToken whether to unwrap the native token when
    struct Flags {
        bool shouldUnwrapNativeToken;
    }

    function account(Props memory props) internal pure returns (address) {
        return props.addresses.account;
    }

    function setAccount(Props memory props, address value) internal pure {
        props.addresses.account = value;
    }

    function receiver(Props memory props) internal pure returns (address) {
        return props.addresses.receiver;
    }

    function setReceiver(Props memory props, address value) internal pure {
        props.addresses.receiver = value;
    }

    function callbackContract(Props memory props) internal pure returns (address) {
        return props.addresses.callbackContract;
    }

    function setCallbackContract(Props memory props, address value) internal pure {
        props.addresses.callbackContract = value;
    }

    function market(Props memory props) internal pure returns (address) {
        return props.addresses.market;
    }

    function setMarket(Props memory props, address value) internal pure {
        props.addresses.market = value;
    }

    function longTokenAmount(Props memory props) internal pure returns (uint256) {
        return props.numbers.longTokenAmount;
    }

    function setLongTokenAmount(Props memory props, uint256 value) internal pure {
        props.numbers.longTokenAmount = value;
    }

    function shortTokenAmount(Props memory props) internal pure returns (uint256) {
        return props.numbers.shortTokenAmount;
    }

    function setShortTokenAmount(Props memory props, uint256 value) internal pure {
        props.numbers.shortTokenAmount = value;
    }

    function minMarketTokens(Props memory props) internal pure returns (uint256) {
        return props.numbers.minMarketTokens;
    }

    function setMinMarketTokens(Props memory props, uint256 value) internal pure {
        props.numbers.minMarketTokens = value;
    }

    function updatedAtBlock(Props memory props) internal pure returns (uint256) {
        return props.numbers.updatedAtBlock;
    }

    function setUpdatedAtBlock(Props memory props, uint256 value) internal pure {
        props.numbers.updatedAtBlock = value;
    }

    function executionFee(Props memory props) internal pure returns (uint256) {
        return props.numbers.executionFee;
    }

    function setExecutionFee(Props memory props, uint256 value) internal pure {
        props.numbers.executionFee = value;
    }

    function callbackGasLimit(Props memory props) internal pure returns (uint256) {
        return props.numbers.callbackGasLimit;
    }

    function setCallbackGasLimit(Props memory props, uint256 value) internal pure {
        props.numbers.callbackGasLimit = value;
    }

    function shouldUnwrapNativeToken(Props memory props) internal pure returns (bool) {
        return props.flags.shouldUnwrapNativeToken;
    }

    function setShouldUnwrapNativeToken(Props memory props, bool value) internal pure {
        props.flags.shouldUnwrapNativeToken = value;
    }
}
