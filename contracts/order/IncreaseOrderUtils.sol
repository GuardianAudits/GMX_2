// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.0;

import "./OrderBaseUtils.sol";
import "../swap/SwapUtils.sol";
import "../position/IncreasePositionUtils.sol";

// @title IncreaseOrderUtils
// @dev Libary for functions to help with processing an increase order
library IncreaseOrderUtils {
    using Position for Position.Props;
    using Order for Order.Props;
    using Array for uint256[];

    error UnexpectedPositionState();

    // @dev process an increase order
    // @param params OrderBaseUtils.ExecuteOrderParams
    function processOrder(OrderBaseUtils.ExecuteOrderParams memory params) external {
        params.contracts.orderStore.transferOut(
            params.order.initialCollateralToken(),
            params.order.initialCollateralDeltaAmount(),
            params.order.market()
        );

        MarketUtils.validateNonEmptyMarket(params.market);

        (address collateralToken, uint256 collateralDeltaAmount) = SwapUtils.swap(SwapUtils.SwapParams(
            params.contracts.dataStore,
            params.contracts.eventEmitter,
            params.contracts.oracle,
            params.contracts.feeReceiver,
            params.order.initialCollateralToken(),
            params.order.initialCollateralDeltaAmount(),
            params.swapPathMarkets,
            params.order.minOutputAmount(),
            address(0),
            false
        ));

        bytes32 positionKey = PositionUtils.getPositionKey(params.order.account(), params.order.market(), collateralToken, params.order.isLong());
        Position.Props memory position = params.contracts.positionStore.get(positionKey);

        // initialize position
        if (position.account() == address(0)) {
            position.setAccount(params.order.account());
            if (position.market() != address(0) || position.collateralToken() != address(0)) {
                revert UnexpectedPositionState();
            }

            position.setMarket(params.order.market());
            position.setCollateralToken(collateralToken);
            position.setIsLong(params.order.isLong());
        }

        validateOracleBlockNumbers(
            params.oracleBlockNumbers,
            params.order.orderType(),
            params.order.updatedAtBlock(),
            position.increasedAtBlock()
        );

        if (collateralToken != params.market.longToken && collateralToken != params.market.shortToken) {
            revert("OrderUtils: invalid collateralToken");
        }

        IncreasePositionUtils.increasePosition(
            IncreasePositionUtils.IncreasePositionParams(
                IncreasePositionUtils.IncreasePositionParamsContracts(
                    params.contracts.dataStore,
                    params.contracts.eventEmitter,
                    params.contracts.positionStore,
                    params.contracts.oracle,
                    params.contracts.feeReceiver,
                    params.contracts.referralStorage
                ),
                params.market,
                params.order,
                position,
                positionKey,
                collateralToken,
                collateralDeltaAmount
            )
        );

        params.contracts.orderStore.remove(params.key, params.order.account());
    }

    // @dev validate the oracle block numbers used for the prices in the oracle
    // @param oracleBlockNumbers the oracle block numbers
    // @param orderType the order type
    // @param orderUpdatedAtBlock the block at which the order was last updated
    // @param positionIncreasedAtBlock the block at which the position was last increased
    function validateOracleBlockNumbers(
        uint256[] memory oracleBlockNumbers,
        Order.OrderType orderType,
        uint256 orderUpdatedAtBlock,
        uint256 positionIncreasedAtBlock
    ) internal pure {
        if (orderType == Order.OrderType.MarketIncrease) {
            if (!oracleBlockNumbers.areEqualTo(orderUpdatedAtBlock)) {
                OracleUtils.revertOracleBlockNumbersAreNotEqual(oracleBlockNumbers, orderUpdatedAtBlock);
            }
            return;
        }

        if (orderType == Order.OrderType.LimitIncrease) {
            uint256 laterBlock = orderUpdatedAtBlock > positionIncreasedAtBlock ? orderUpdatedAtBlock : positionIncreasedAtBlock;
            if (!oracleBlockNumbers.areGreaterThan(laterBlock)) {
                OracleUtils.revertOracleBlockNumbersAreSmallerThanRequired(oracleBlockNumbers, laterBlock);
            }
            return;
        }

        OrderBaseUtils.revertUnsupportedOrderType();
    }
}
