// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.0;

import "../withdrawal/Withdrawal.sol";

// @title IWithdrawalCallbackReceiver
// @dev interface for a withdrawal callback contract
interface IWithdrawalCallbackReceiver {
    // @dev called before a withdrawal execution
    // @param key the key of the withdrawal
    // @param withdrawal the withdrawal to be executed
    function beforeWithdrawalExecution(bytes32 key, Withdrawal.Props memory withdrawal) external;

    // @dev called after a withdrawal execution
    // @param key the key of the withdrawal
    // @param withdrawal the withdrawal that was executed
    function afterWithdrawalExecution(bytes32 key, Withdrawal.Props memory withdrawal) external;

    // @dev called after a withdrawal cancellation
    // @param key the key of the withdrawal
    // @param withdrawal the withdrawal that was cancelled
    function afterWithdrawalCancellation(bytes32 key, Withdrawal.Props memory withdrawal) external;
}
