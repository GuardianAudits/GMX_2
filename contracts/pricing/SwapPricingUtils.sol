// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.0;

import "../market/MarketUtils.sol";

import "../utils/Precision.sol";
import "../utils/Calc.sol";

import "./PricingUtils.sol";

// @title SwapPricingUtils
// @dev Library for pricing functions
library SwapPricingUtils {
    using SafeCast for uint256;
    using SafeCast for int256;

    // @dev GetPriceImpactUsdParams struct used in getPriceImpactUsd to
    // avoid stack too deep errors
    // @param dataStore DataStore
    // @param market the market to check
    // @param tokenA the token to check balance for
    // @param tokenB the token to check balance for
    // @param priceForTokenA the price for tokenA
    // @param priceForTokenB the price for tokenB
    // @param usdDeltaForTokenA the USD change in amount of tokenA
    // @param usdDeltaForTokenB the USD change in amount of tokenB
    struct GetPriceImpactUsdParams {
        DataStore dataStore;
        address market;
        address tokenA;
        address tokenB;
        uint256 priceForTokenA;
        uint256 priceForTokenB;
        int256 usdDeltaForTokenA;
        int256 usdDeltaForTokenB;
    }

    // @dev PoolParams struct to contain pool values
    // @param poolUsdForTokenA the USD value of tokenA in the pool
    // @param poolUsdForTokenB the USD value of tokenB in the pool
    // @param nextPoolUsdForTokenA the next USD value of tokenA in the pool
    // @param nextPoolUsdForTokenB the next USD value of tokenB in the pool
    struct PoolParams {
        uint256 poolUsdForTokenA;
        uint256 poolUsdForTokenB;
        uint256 nextPoolUsdForTokenA;
        uint256 nextPoolUsdForTokenB;
    }

    // @dev SwapFees struct to contain swap fee values
    // @param feeReceiverAmount the fee amount for the fee receiver
    // @param feesForPool the fee amount for the pool
    // @param amountAfterFees the output amount after fees
    struct SwapFees {
        uint256 feeReceiverAmount;
        uint256 feesForPool;
        uint256 amountAfterFees;
    }

    // @dev get the price impact in USD
    //
    // note that there will be some difference between the pool amounts used for
    // calculating the price impact and fees vs the actual pool amounts after the
    // swap is done, since the pool amounts will be increased / decreased by an amount
    // after factoring in the calculated price impact and fees
    //
    // since the calculations are based on the real-time prices values of the tokens
    // if a token price increases, the pool will incentivise swapping out more of that token
    // this is useful if prices are ranging, if prices are strongly directional, the pool may
    // be selling tokens as the token price increases
    //
    // @param params GetPriceImpactUsdParams
    //
    // @return the price impact in USD
    function getPriceImpactUsd(GetPriceImpactUsdParams memory params) internal view returns (int256) {
        PoolParams memory poolParams = getNextPoolAmountsUsd(params);

        int256 priceImpactUsd = _getPriceImpactUsd(params.dataStore, params.market, poolParams);

        return priceImpactUsd;
    }

    // @dev get the price impact in USD
    // @param dataStore DataStore
    // @param market the trading market
    // @param poolParams PoolParams
    // @return the price impact in USD
    function _getPriceImpactUsd(DataStore dataStore, address market, PoolParams memory poolParams) internal view returns (int256) {
        uint256 initialDiffUsd = Calc.diff(poolParams.poolUsdForTokenA, poolParams.poolUsdForTokenB);
        uint256 nextDiffUsd = Calc.diff(poolParams.nextPoolUsdForTokenA, poolParams.nextPoolUsdForTokenB);

        // check whether an improvement in balance comes from causing the balance to switch sides
        // for example, if there is $2000 of ETH and $1000 of USDC in the pool
        // adding $1999 USDC into the pool will reduce absolute balance from $1000 to $999 but it does not
        // help rebalance the pool much, the isSameSideRebalance value helps avoid gaming using this case
        bool isSameSideRebalance = poolParams.poolUsdForTokenA <= poolParams.poolUsdForTokenB == poolParams.nextPoolUsdForTokenA <= poolParams.nextPoolUsdForTokenB;
        uint256 impactExponentFactor = dataStore.getUint(Keys.swapImpactExponentFactorKey(market));

        if (isSameSideRebalance) {
            bool hasPositiveImpact = nextDiffUsd < initialDiffUsd;
            uint256 impactFactor = dataStore.getUint(Keys.swapImpactFactorKey(market, hasPositiveImpact));

            return PricingUtils.getPriceImpactUsdForSameSideRebalance(
                initialDiffUsd,
                nextDiffUsd,
                hasPositiveImpact,
                impactFactor,
                impactExponentFactor
            );
        } else {
            uint256 positiveImpactFactor = dataStore.getUint(Keys.swapImpactFactorKey(market, true));
            uint256 negativeImpactFactor = dataStore.getUint(Keys.swapImpactFactorKey(market, false));

            return PricingUtils.getPriceImpactUsdForCrossoverRebalance(
                initialDiffUsd,
                nextDiffUsd,
                positiveImpactFactor,
                negativeImpactFactor,
                impactExponentFactor
            );
        }
    }

    // @dev get the next pool amounts in USD
    // @param params GetPriceImpactUsdParams
    // @return PoolParams
    function getNextPoolAmountsUsd(
        GetPriceImpactUsdParams memory params
    ) internal view returns (PoolParams memory) {
        uint256 poolAmountForTokenA = MarketUtils.getPoolAmount(params.dataStore, params.market, params.tokenA);
        uint256 poolAmountForTokenB = MarketUtils.getPoolAmount(params.dataStore, params.market, params.tokenB);

        uint256 poolUsdForTokenA = poolAmountForTokenA * params.priceForTokenA;
        uint256 poolUsdForTokenB = poolAmountForTokenB * params.priceForTokenB;

        uint256 nextPoolUsdForTokenA = Calc.sum(poolUsdForTokenA, params.usdDeltaForTokenA);
        uint256 nextPoolUsdForTokenB = Calc.sum(poolUsdForTokenB, params.usdDeltaForTokenB);

        PoolParams memory poolParams = PoolParams(
            poolUsdForTokenA,
            poolUsdForTokenB,
            nextPoolUsdForTokenA,
            nextPoolUsdForTokenB
        );

        return poolParams;
    }

    // @dev get the swap fees
    // @param dataStore DataStore
    // @param marketToken the address of the market token
    // @param amount the total swap fee amount
    // @param feeReceiverFactorKey the key for the feeReceiverFactor
    function getSwapFees(
        DataStore dataStore,
        address marketToken,
        uint256 amount,
        bytes32 feeReceiverFactorKey
    ) internal view returns (SwapFees memory) {
        SwapFees memory fees;

        uint256 feeFactor = dataStore.getUint(Keys.swapFeeFactorKey(marketToken));
        uint256 feeReceiverFactor = dataStore.getUint(feeReceiverFactorKey);

        uint256 feeAmount = Precision.applyFactor(amount, feeFactor);

        fees.feeReceiverAmount = Precision.applyFactor(feeAmount, feeReceiverFactor);
        fees.feesForPool = feeAmount - fees.feeReceiverAmount;
        fees.amountAfterFees = amount - feeAmount;

        return fees;
    }
}
