// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.0;

import "./Order.sol";
import "../market/Market.sol";

import "../data/DataStore.sol";
import "../event/EventEmitter.sol";

import "../order/OrderStore.sol";
import "../position/PositionStore.sol";

import "../oracle/Oracle.sol";
import "../swap/SwapHandler.sol";

// @title Order
// @dev Libary for common order functions used in OrderUtils, IncreaseOrderUtils
// DecreaseOrderUtils, SwapOrderUtils
library OrderBaseUtils {
    using Order for Order.Props;
    using Price for Price.Props;

    // @dev CreateOrderParams struct used in createOrder to avoid stack
    // too deep errors
    //
    // @param addresses address values
    // @param numbers number values
    // @param orderType for order.orderType
    // @param isLong for order.isLong
    // @param shouldUnwrapNativeToken for order.shouldUnwrapNativeToken
    struct CreateOrderParams {
        CreateOrderParamsAddresses addresses;
        CreateOrderParamsNumbers numbers;
        Order.OrderType orderType;
        bool isLong;
        bool shouldUnwrapNativeToken;
    }

    // @param receiver for order.receiver
    // @param callbackContract for order.callbackContract
    // @param market for order.market
    // @param initialCollateralToken for order.initialCollateralToken
    // @param swapPath for order.swapPath
    struct CreateOrderParamsAddresses {
        address receiver;
        address callbackContract;
        address market;
        address initialCollateralToken;
        address[] swapPath;
    }

    // @param sizeDeltaUsd for order.sizeDeltaUsd
    // @param triggerPrice for order.triggerPrice
    // @param acceptablePrice for order.acceptablePrice
    // @param executionFee for order.executionFee
    // @param callbackGasLimit for order.callbackGasLimit
    // @param minOutputAmount for order.minOutputAmount
    struct CreateOrderParamsNumbers {
        uint256 sizeDeltaUsd;
        uint256 triggerPrice;
        uint256 acceptablePrice;
        uint256 executionFee;
        uint256 callbackGasLimit;
        uint256 minOutputAmount;
    }

    // @dev ExecuteOrderParams struct used in executeOrder to avoid stack
    // too deep errors
    //
    // @param key the key of the order to execute
    // @param order the order to execute
    // @param swapPathMarkets the market values of the markets in the swapPath
    // @param oracleBlockNumbers the oracle block numbers for the prices in the oracle
    // @param market market values of the trading market
    // @param keeper the keeper sending the transaction
    // @param startingGas the starting gas
    // @param positionKey the key of the order's position
    struct ExecuteOrderParams {
        ExecuteOrderParamsContracts contracts;
        bytes32 key;
        Order.Props order;
        Market.Props[] swapPathMarkets;
        uint256[] oracleBlockNumbers;
        Market.Props market;
        address keeper;
        uint256 startingGas;
        bytes32 positionKey;
    }

    // @param dataStore DataStore
    // @param eventEmitter EventEmitter
    // @param orderStore OrderStore
    // @param positionStore PositionStore
    // @param oracle Oracle
    // @param swapHandler SwapHandler
    // @param feeReceiver FeeReceiver
    // @param referralStorage IReferralStorage
    struct ExecuteOrderParamsContracts {
        DataStore dataStore;
        EventEmitter eventEmitter;
        OrderStore orderStore;
        PositionStore positionStore;
        Oracle oracle;
        SwapHandler swapHandler;
        FeeReceiver feeReceiver;
        IReferralStorage referralStorage;
    }

    error EmptyOrder();
    error UnsupportedOrderType();

    // @dev check if an orderType is a market order
    // @param orderType the order type
    // @return whether an orderType is a market order
    function isMarketOrder(Order.OrderType orderType) internal pure returns (bool) {
        return orderType == Order.OrderType.MarketSwap ||
               orderType == Order.OrderType.MarketIncrease ||
               orderType == Order.OrderType.MarketDecrease ||
               orderType == Order.OrderType.Liquidation;
    }

    // @dev check if an orderType is a limit order
    // @param orderType the order type
    // @return whether an orderType is a limit order
    function isLimitOrder(Order.OrderType orderType) internal pure returns (bool) {
        return orderType == Order.OrderType.LimitSwap ||
               orderType == Order.OrderType.LimitIncrease ||
               orderType == Order.OrderType.LimitDecrease;
    }

    // @dev check if an orderType is a swap order
    // @param orderType the order type
    // @return whether an orderType is a swap order
    function isSwapOrder(Order.OrderType orderType) internal pure returns (bool) {
        return orderType == Order.OrderType.MarketSwap ||
               orderType == Order.OrderType.LimitSwap;
    }

    // @dev check if an orderType is a position order
    // @param orderType the order type
    // @return whether an orderType is a position order
    function isPositionOrder(Order.OrderType orderType) internal pure returns (bool) {
        return isIncreaseOrder(orderType) || isDecreaseOrder(orderType);
    }

    // @dev check if an orderType is an increase order
    // @param orderType the order type
    // @return whether an orderType is an increase order
    function isIncreaseOrder(Order.OrderType orderType) internal pure returns (bool) {
        return orderType == Order.OrderType.MarketIncrease ||
               orderType == Order.OrderType.LimitIncrease;
    }

    // @dev check if an orderType is a decrease order
    // @param orderType the order type
    // @return whether an orderType is a decrease order
    function isDecreaseOrder(Order.OrderType orderType) internal pure returns (bool) {
        return orderType == Order.OrderType.MarketDecrease ||
               orderType == Order.OrderType.LimitDecrease ||
               orderType == Order.OrderType.StopLossDecrease ||
               orderType == Order.OrderType.Liquidation;
    }

    // @dev check if an orderType is a liquidation order
    // @param orderType the order type
    // @return whether an orderType is a liquidation order
    function isLiquidationOrder(Order.OrderType orderType) internal pure returns (bool) {
        return orderType == Order.OrderType.Liquidation;
    }

    // @dev set the price for increase / decrease orders
    //
    // for market orders, set the min and max values of the customPrice for the indexToken
    // to either secondaryPrice.min or secondaryPrice.max depending on whether the order
    // is an increase or decrease and whether it is for a long or short
    //
    // customPrice.min and customPrice.max will be equal in this case
    // this is because in getExecutionPrice the function will try to use the closest price which can fulfill
    // the order, if customPrice.min is set to secondaryPrice.min and customPrice.max is set to secondaryPrice.max
    // getExecutionPrice will pick a better price than what should be possible
    //
    // for limit / stop-loss orders, the min and max value will be set to the triggerPrice
    // and latest secondaryPrice value, this represents the price that the user desired the order
    // to be fulfilled at and the best oracle price that the order could be fulfilled at
    //
    // getExecutionPrice handles the logic for selecting the execution price to use
    //
    // @param oracle Oracle
    // @param indexToken the index token
    // @param orderType the order type
    // @param triggerPrice the order's triggerPrice
    // @param isLong whether the order is for a long or short
    function setExactOrderPrice(
        Oracle oracle,
        address indexToken,
        Order.OrderType orderType,
        uint256 triggerPrice,
        bool isLong
    ) internal {
        if (isSwapOrder(orderType)) {
            return;
        }

        bool isIncrease = isIncreaseOrder(orderType);
        // increase order:
        //     - long: use the larger price
        //     - short: use the smaller price
        // decrease order:
        //     - long: use the smaller price
        //     - short: use the larger price
        bool shouldUseMaxPrice = isIncrease ? isLong : !isLong;

        // set secondary price to primary price since increase / decrease positions use the secondary price for index token values
        if (orderType == Order.OrderType.MarketIncrease ||
            orderType == Order.OrderType.MarketDecrease ||
            orderType == Order.OrderType.Liquidation) {

            Price.Props memory price = oracle.getPrimaryPrice(indexToken);

            oracle.setCustomPrice(indexToken, Price.Props(
                price.pickPrice(shouldUseMaxPrice),
                price.pickPrice(shouldUseMaxPrice)
            ));

            return;
        }

        if (orderType == Order.OrderType.LimitIncrease ||
            orderType == Order.OrderType.LimitDecrease ||
            orderType == Order.OrderType.StopLossDecrease
        ) {
            uint256 primaryPrice = oracle.getPrimaryPrice(indexToken).pickPrice(shouldUseMaxPrice);
            uint256 secondaryPrice = oracle.getSecondaryPrice(indexToken).pickPrice(shouldUseMaxPrice);

            // increase order:
            //     - long: validate descending price
            //     - short: validate ascending price
            // decrease order:
            //     - long: validate ascending price
            //     - short: validate descending price
            bool shouldValidateAscendingPrice = isIncrease ? !isLong : isLong;

            if (shouldValidateAscendingPrice) {
                // check that the earlier price (primaryPrice) is smaller than the triggerPrice
                // and that the later price (secondaryPrice) is larger than the triggerPrice
                bool ok = primaryPrice <= triggerPrice && triggerPrice <= secondaryPrice;
                if (!ok) {
                    revert("Invalid prices for order");
                }

                oracle.setCustomPrice(indexToken, Price.Props(
                    triggerPrice, // min price that order can be executed with
                    secondaryPrice // max price that order can be executed with
                ));
            } else {
                // check that the earlier price (primaryPrice) is larger than the triggerPrice
                // and that the later price (secondaryPrice) is smaller than the triggerPrice
                bool ok = primaryPrice >= triggerPrice && triggerPrice >= secondaryPrice;
                if (!ok) {
                    revert("Invalid prices for order");
                }

                oracle.setCustomPrice(indexToken, Price.Props(
                    secondaryPrice, // min price that order can be executed with
                    triggerPrice // max price that order can be executed with
                ));
            }

            return;
        }

        revertUnsupportedOrderType();
    }

    // @dev get the execution price for an order
    //
    // see setExactOrderPrice for information on the customPrice values
    //
    // for limit / stop-loss orders, the triggerPrice is returned here if it can
    // fulfill the acceptablePrice after factoring in price impact
    //
    // if the triggerPrice cannot fulfill the acceptablePrice, check if the acceptablePrice
    // can be fulfilled using the best oracle price after factoring in price impact
    // if it can be fulfilled, fulfill the order at the acceptablePrice
    //
    // @param customIndexTokenPrice the custom price of the index token
    // @param sizeDeltaUsd the order.sizeDeltaUsd
    // @param priceImpactUsd the price impact of the order
    // @param acceptablePrice the order.acceptablePrice
    // @param isLong whether this is for a long or short order
    // @param isIncrease whether this is for an increase or decrease order
    // @return the execution price
    function getExecutionPrice(
        Price.Props memory customIndexTokenPrice,
        uint256 sizeDeltaUsd,
        int256 priceImpactUsd,
        uint256 acceptablePrice,
        bool isLong,
        bool isIncrease
    ) internal pure returns (uint256) {
        // increase order:
        //     - long: use the larger price
        //     - short: use the smaller price
        // decrease order:
        //     - long: use the smaller price
        //     - short: use the larger price
        bool shouldUseMaxPrice = isIncrease ? isLong : !isLong;

        // should price be smaller than acceptablePrice
        // increase order:
        //     - long: price should be smaller than acceptablePrice
        //     - short: price should be larger than acceptablePrice
        // decrease order:
        //     - long: price should be larger than acceptablePrice
        //     - short: price should be smaller than acceptablePrice
        bool shouldPriceBeSmaller = isIncrease ? isLong : !isLong;

        // for market orders, customIndexTokenPrice.min and customIndexTokenPrice.max should be equal, see setExactOrderPrice for more info
        // for limit orders, customIndexTokenPrice contains the triggerPrice and the best oracle
        // price, we first attempt to fulfill the order using the triggerPrice
        uint256 price = customIndexTokenPrice.pickPrice(shouldUseMaxPrice);

        // increase order:
        //     - long: lower price for positive impact, higher price for negative impact
        //     - short: higher price for positive impact, lower price for negative impact
        // decrease order:
        //     - long: higher price for positive impact, lower price for negative impact
        //     - short: lower price for positive impact, higher price for negative impact
        bool shouldFlipPriceImpactUsd = isIncrease ? isLong : !isLong;
        int256 priceImpactUsdForPriceAdjustment = shouldFlipPriceImpactUsd ? -priceImpactUsd : priceImpactUsd;

        // adjust price by price impact
        price = price * Calc.sum(sizeDeltaUsd, priceImpactUsdForPriceAdjustment) / sizeDeltaUsd;

        if (shouldPriceBeSmaller && price <= acceptablePrice) {
            return price;
        }

        if (!shouldPriceBeSmaller && price >= acceptablePrice) {
            return price;
        }

        // if the order could not be fulfilled using the triggerPrice
        // check if the best oracle price can fulfill the order
        price = customIndexTokenPrice.pickPrice(!shouldUseMaxPrice);

        // adjust price by price impact
        price = price * Calc.sum(sizeDeltaUsd, priceImpactUsdForPriceAdjustment) / sizeDeltaUsd;

        if (shouldPriceBeSmaller && price <= acceptablePrice) {
            return acceptablePrice;
        }

        if (!shouldPriceBeSmaller && price >= acceptablePrice) {
            return acceptablePrice;
        }

        revert(Keys.UNACCEPTABLE_PRICE_ERROR);
    }

    // @dev validate that an order exists
    // @param order the order to check
    function validateNonEmptyOrder(Order.Props memory order) internal pure {
        if (order.account() == address(0)) {
            revert EmptyOrder();
        }
    }

    // @dev throw an unsupported order type error
    function revertUnsupportedOrderType() internal pure {
        revert UnsupportedOrderType();
    }
}
