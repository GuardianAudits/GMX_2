// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.0;

import "../data/DataStore.sol";
import "../data/Keys.sol";
import "../utils/Precision.sol";

import "../deposit/Deposit.sol";
import "../withdrawal/Withdrawal.sol";
import "../order/Order.sol";
import "../order/OrderBaseUtils.sol";

import "../bank/StrictBank.sol";

// @title GasUtils
// @dev Library for execution fee estimation and payments
library GasUtils {
    using Deposit for Deposit.Props;
    using Withdrawal for Withdrawal.Props;
    using Order for Order.Props;

    // @param keeper address of the keeper
    // @param amount the amount of execution fee received
    event KeeperExecutionFee(address keeper, uint256 amount);
    // @param user address of the user
    // @param amount the amount of execution fee refunded
    event UserRefundFee(address user, uint256 amount);

    error InsufficientExecutionFee(uint256 minExecutionFee, uint256 executionFee);

    // @dev pay the keeper the execution fee and refund any excess amount to the user
    //
    // @param dataStore DataStore
    // @param bank the StrictBank contract holding the execution fee
    // @param executionFee the executionFee amount
    // @param startingGas the starting gas
    // @param keeper the keeper to pay
    // @param user the user to refund
    function payExecutionFee(
        DataStore dataStore,
        StrictBank bank,
        uint256 executionFee,
        uint256 startingGas,
        address keeper,
        address user
    ) external {
        address wnt = TokenUtils.wnt(dataStore);
        bank.transferOut(wnt, executionFee, address(this));
        IWNT(wnt).withdraw(executionFee);

        uint256 gasUsed = startingGas - gasleft();
        uint256 executionFeeForKeeper = adjustGasUsage(dataStore, gasUsed) * tx.gasprice;

        if (executionFeeForKeeper > executionFee) {
            executionFeeForKeeper = executionFee;
        }

        TokenUtils.transferNativeToken(
            dataStore,
            keeper,
            executionFeeForKeeper
        );

        emit KeeperExecutionFee(keeper, executionFeeForKeeper);

        uint256 refundFeeForUser = executionFee - executionFeeForKeeper;
        if (refundFeeForUser == 0) {
            return;
        }

        TokenUtils.transferNativeToken(
            dataStore,
            user,
            refundFeeForUser
        );

        emit UserRefundFee(user, refundFeeForUser);
    }

    // @dev validate that the provided executionFee is sufficient based on the estimatedGasLimit
    // @param dataStore DataStore
    // @param estimatedGasLimit the estimated gas limit
    // @param executionFee the execution fee provided
    function validateExecutionFee(DataStore dataStore, uint256 estimatedGasLimit, uint256 executionFee) internal view {
        uint256 gasLimit = adjustGasLimitForEstimate(dataStore, estimatedGasLimit);
        uint256 minExecutionFee = gasLimit * tx.gasprice;
        if (executionFee < minExecutionFee) {
            revert InsufficientExecutionFee(minExecutionFee, executionFee);
        }
    }

    // @dev adjust the gas usage to pay a small amount to keepers
    // @param dataStore DataStore
    // @param gasUsed the amount of gas used
    function adjustGasUsage(DataStore dataStore, uint256 gasUsed) internal view returns (uint256) {
        uint256 baseGasLimit = dataStore.getUint(Keys.EXECUTION_FEE_BASE_GAS_LIMIT);
        uint256 multiplierFactor = dataStore.getUint(Keys.EXECUTION_FEE_MULTIPLIER_FACTOR);
        uint256 gasLimit = baseGasLimit + Precision.applyFactor(gasUsed, multiplierFactor);
        return gasLimit;
    }

    // @dev adjust the estimated gas limit to help ensure the execution fee is sufficient during
    // the actual execution
    // @param dataStore DataStore
    // @param estimatedGasLimit the estimated gas limit
    function adjustGasLimitForEstimate(DataStore dataStore, uint256 estimatedGasLimit) internal view returns (uint256) {
        uint256 baseGasLimit = dataStore.getUint(Keys.ESTIMATED_FEE_BASE_GAS_LIMIT);
        uint256 multiplierFactor = dataStore.getUint(Keys.ESTIMATED_FEE_MULTIPLIER_FACTOR);
        uint256 gasLimit = baseGasLimit + Precision.applyFactor(estimatedGasLimit, multiplierFactor);
        return gasLimit;
    }

    // @dev the estimated gas limit for deposits
    // @param dataStore DataStore
    // @param deposit the deposit to estimate the gas limit for
    function estimateExecuteDepositGasLimit(DataStore dataStore, Deposit.Props memory deposit) internal view returns (uint256) {
        if (deposit.longTokenAmount() == 0 || deposit.shortTokenAmount() == 0) {
            return dataStore.getUint(Keys.depositGasLimitKey(true)) + deposit.callbackGasLimit();
        }

        return dataStore.getUint(Keys.depositGasLimitKey(false)) + deposit.callbackGasLimit();
    }

    // @dev the estimated gas limit for withdrawals
    // @param dataStore DataStore
    // @param withdrawal the withdrawal to estimate the gas limit for
    function estimateExecuteWithdrawalGasLimit(DataStore dataStore, Withdrawal.Props memory withdrawal) internal view returns (uint256) {
        if (withdrawal.marketTokensLongAmount() == 0 || withdrawal.marketTokensShortAmount() == 0) {
            return dataStore.getUint(Keys.withdrawalGasLimitKey(true)) + withdrawal.callbackGasLimit();
        }

        return dataStore.getUint(Keys.withdrawalGasLimitKey(false)) + withdrawal.callbackGasLimit();
    }

    // @dev the estimated gas limit for orders
    // @param dataStore DataStore
    // @param order the order to estimate the gas limit for
    function estimateExecuteOrderGasLimit(DataStore dataStore, Order.Props memory order) internal view returns (uint256) {
        if (OrderBaseUtils.isIncreaseOrder(order.orderType())) {
            return estimateExecuteIncreaseOrderGasLimit(dataStore, order);
        }

        if (OrderBaseUtils.isDecreaseOrder(order.orderType())) {
            return estimateExecuteDecreaseOrderGasLimit(dataStore, order);
        }

        if (OrderBaseUtils.isSwapOrder(order.orderType())) {
            return estimateExecuteSwapOrderGasLimit(dataStore, order);
        }

        OrderBaseUtils.revertUnsupportedOrderType();
    }

    // @dev the estimated gas limit for increase orders
    // @param dataStore DataStore
    // @param order the order to estimate the gas limit for
    function estimateExecuteIncreaseOrderGasLimit(DataStore dataStore, Order.Props memory order) internal view returns (uint256) {
        uint256 gasPerSwap = dataStore.getUint(Keys.singleSwapGasLimitKey());
        return dataStore.getUint(Keys.increaseOrderGasLimitKey()) + gasPerSwap * order.swapPath().length + order.callbackGasLimit();
    }

    // @dev the estimated gas limit for decrease orders
    // @param dataStore DataStore
    // @param order the order to estimate the gas limit for
    function estimateExecuteDecreaseOrderGasLimit(DataStore dataStore, Order.Props memory order) internal view returns (uint256) {
        uint256 gasPerSwap = dataStore.getUint(Keys.singleSwapGasLimitKey());
        return dataStore.getUint(Keys.decreaseOrderGasLimitKey()) + gasPerSwap * order.swapPath().length + order.callbackGasLimit();
    }

    // @dev the estimated gas limit for swap orders
    // @param dataStore DataStore
    // @param order the order to estimate the gas limit for
    function estimateExecuteSwapOrderGasLimit(DataStore dataStore, Order.Props memory order) internal view returns (uint256) {
        uint256 gasPerSwap = dataStore.getUint(Keys.singleSwapGasLimitKey());
        return dataStore.getUint(Keys.swapOrderGasLimitKey()) + gasPerSwap * order.swapPath().length + order.callbackGasLimit();
    }
}
