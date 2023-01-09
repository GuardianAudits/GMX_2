import { bigNumberify, expandDecimals } from "./math";
import { executeWithOracleParams, executeLimitWithOracleParams } from "./exchange";
import { TOKEN_ORACLE_TYPES } from "./oracle";
import { mine } from "@nomicfoundation/hardhat-network-helpers";

export const OrderType = {
  MarketSwap: 0,
  LimitSwap: 1,
  MarketIncrease: 2,
  LimitIncrease: 3,
  MarketDecrease: 4,
  LimitDecrease: 5,
  StopLossDecrease: 6,
  Liquidation: 7,
};

export async function createOrder(fixture, overrides) {
  const { initialCollateralToken, initialCollateralDeltaAmount, orderType } = overrides;

  const { orderStore, orderHandler, wnt, exchangeRouter } = fixture.contracts;
  const { wallet, user0 } = fixture.accounts;

  const account = overrides.account || user0;
  const receiver = overrides.receiver || account;
  const callbackContract = overrides.callbackContract || { address: ethers.constants.AddressZero };
  const market = overrides.market || { marketToken: ethers.constants.AddressZero };
  const sizeDeltaUsd = overrides.sizeDeltaUsd || "0";
  const swapPath = overrides.swapPath || [];
  const acceptablePrice = overrides.acceptablePrice || "0";
  const triggerPrice = overrides.triggerPrice || "0";
  const isLong = overrides.isLong || false;
  const executionFee = overrides.executionFee || fixture.props.executionFee;
  const callbackGasLimit = overrides.callbackGasLimit || bigNumberify(0);
  const minOutputAmount = overrides.minOutputAmount || 0;
  const shouldUnwrapNativeToken = overrides.shouldUnwrapNativeToken || false;
  const referral = overrides.referral || "";

  if (orderType == OrderType.MarketIncrease || orderType == OrderType.LimitIncrease || orderType == OrderType.MarketSwap || orderType == OrderType.LimitSwap) {
    await initialCollateralToken.mint(orderStore.address, initialCollateralDeltaAmount);
  }
  await wnt.mint(orderStore.address, executionFee);

  const params = {
    addresses: {
      receiver: receiver.address,
      callbackContract: callbackContract.address,
      market: market.marketToken,
      initialCollateralToken: initialCollateralToken.address,
      swapPath,
    },
    numbers: {
      sizeDeltaUsd,
      acceptablePrice,
      triggerPrice,
      executionFee,
      callbackGasLimit,
      minOutputAmount,
    },
    orderType,
    isLong,
    shouldUnwrapNativeToken,
  };

  if(!referral) await orderHandler.connect(wallet).createOrder(account.address, params)
  else {
    await exchangeRouter.connect(account).createOrder(params, referral);
  }
}

function isLimitOrder(order) {
  return order.flags.orderType == OrderType.LimitDecrease || order.flags.orderType == OrderType.LimitIncrease
      || order.flags.orderType == OrderType.StopLossDecrease || order.flags.orderType == OrderType.LimitSwap;
}

export async function executeOrder(fixture, overrides) {
  const { wnt, usdc } = fixture.contracts;
  const { gasUsageLabel, priceFeedTokens } = overrides;
  const { orderStore, orderHandler } = fixture.contracts;
  const tokens = overrides.tokens || [wnt.address, usdc.address];
  const tokenOracleTypes = overrides.tokenOracleTypes || [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT];
  const precisions = overrides.precisions || [8, 18];
  const minPrices = overrides.minPrices || [expandDecimals(5000, 4), expandDecimals(1, 6)];
  const maxPrices = overrides.maxPrices || [expandDecimals(5000, 4), expandDecimals(1, 6)];
  const orderKeys = await orderStore.getOrderKeys(0, 1);
  const orderKey = overrides.key || orderKeys[0];
  const order = await orderStore.get(orderKey);
  const oracleBlockNumber = overrides.oracleBlockNumber || order.numbers.updatedAtBlock;

  const params = {
    key: orderKey,
    oracleBlockNumber,
    tokens,
    tokenOracleTypes,
    precisions,
    minPrices,
    maxPrices,
    execute: orderHandler.executeOrder,
    gasUsageLabel,
    priceFeedTokens: priceFeedTokens || [],
  };

  if (isLimitOrder(order)) {
    await mine();
    await mine();

    const limitParams = {
      ...params,
      firstOracleBlockNumber: overrides.firstOracleBlockNumber || oracleBlockNumber.add(1),
      secondOracleBlockNumber: overrides.secondOracleBlockNumber || oracleBlockNumber.add(2),
    }

    await executeLimitWithOracleParams(fixture, limitParams);
  } else {
    await executeWithOracleParams(fixture, params);
  }
}

export async function handleOrder(fixture, overrides = {}) {
  await createOrder(fixture, overrides.create);
  await executeOrder(fixture, overrides.execute);
}

export async function executeLiquidation(fixture, overrides) {
  const { user0 } = fixture.accounts;
  const { roleStore } = fixture.contracts;

  const { wnt, usdc } = fixture.contracts;
  const { account, market, collateralToken, isLong, gasUsageLabel } = overrides;
  const { orderHandler } = fixture.contracts;
  const tokens = overrides.tokens || [wnt.address, usdc.address];
  const tokenOracleTypes = overrides.tokenOracleTypes || [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT];
  const precisions = overrides.precisions || [8, 18];
  const minPrices = overrides.minPrices || [expandDecimals(5000, 4), expandDecimals(1, 6)];
  const maxPrices = overrides.maxPrices || [expandDecimals(5000, 4), expandDecimals(1, 6)];

  const block = await ethers.provider.getBlock();

  const params = {
    oracleBlockNumber: bigNumberify(block.number),
    tokens,
    tokenOracleTypes,
    precisions,
    minPrices,
    maxPrices,
    execute: async (key, oracleParams) => {
      return await orderHandler
        .connect(user0)
        .executeLiquidation(account, market.marketToken, collateralToken.address, isLong, oracleParams);
    },
    gasUsageLabel,
  };

  await executeWithOracleParams(fixture, params);
}
