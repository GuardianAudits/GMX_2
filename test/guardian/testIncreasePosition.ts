import { expect } from "chai";

import { deployFixture } from "../../utils/fixture";
import { expandDecimals, expandFloatDecimals, bigNumberify } from "../../utils/math";
import { handleDeposit } from "../../utils/deposit";
import { OrderType, createOrder, handleOrder, executeOrder } from "../../utils/order";
import { getOracleParams, TOKEN_ORACLE_TYPES } from "../../utils/oracle";
import { revokeRole, grantRole } from "../../utils/role";

describe("Guardian.IncreasePosition", () => {
  const { provider } = ethers;

  let fixture;
  let user0, user1;
  let orderStore,
    wallet,
    positionStore,
    exchangeRouter,
    ethUsdMarket,
    wnt,
    usdc,
    wbtc,
    ethUsdIndexBtcMarket,
    eventEmitter,
    orderHandler,
    wbtcPriceFeed,
    roleStore;
  let executionFee;

  beforeEach(async () => {
    fixture = await deployFixture();
    ({ wallet, user0, user1 } = fixture.accounts);
    ({
      orderStore,
      positionStore,
      ethUsdMarket,
      wnt,
      usdc,
      exchangeRouter,
      ethUsdIndexBtcMarket,
      wbtc,
      eventEmitter,
      roleStore,
      orderHandler,
      wbtcPriceFeed,
    } = fixture.contracts);
    ({ executionFee } = fixture.props);

    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        longTokenAmount: expandDecimals(1000, 18),
        shortTokenAmount: expandDecimals(1000000000000, 6),
      },
    });

    await handleDeposit(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        longTokenAmount: expandDecimals(1000, 18),
        shortTokenAmount: expandDecimals(1000000000000, 6),
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        maxPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      },
    });
  });

  it("Cannot create a position with 0 collateral", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWntAmount = 0;
    const initialPositionSizeInUsd = expandFloatDecimals(100 * 1000);

    await createOrder(fixture, {
      market: ethUsdMarket,
      initialCollateralToken: wnt,
      initialCollateralDeltaAmount: initialWntAmount,
      sizeDeltaUsd: initialPositionSizeInUsd, // 2x position
      acceptablePrice: expandDecimals(5001, 12),
      orderType: OrderType.MarketIncrease,
      isLong: true,
    });

    const orderKey = (await orderStore.getOrderKeys(0, 1))[0];
    const order = await orderStore.get(orderKey);

    const { signers } = fixture.accounts;
    const { oracleSalt, signerIndexes } = fixture.props;

    const block = await provider.getBlock(order.numbers.updatedAtBlock.toNumber());
    const tokens = [wnt.address, usdc.address];

    const oracleParams = await getOracleParams({
      oracleSalt,
      oracleBlockNumbers: Array(tokens.length).fill(block.number, 0, tokens.length),
      oracleTimestamps: Array(tokens.length).fill(block.timestamp, 0, tokens.length),
      blockHashes: Array(tokens.length).fill(block.hash, 0, tokens.length),
      signerIndexes,
      tokens: tokens,
      tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      precisions: [8, 18],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      signers,
      priceFeedTokens: [],
    });

    await expect(orderHandler.executeOrder(orderKey, oracleParams)).to.emit(eventEmitter, "OrderCancelled");
  });

  it("Only Frozen Order Keeper can execute a frozen LimitIncrease order", async () => {
    await revokeRole(roleStore, wallet.address, "FROZEN_ORDER_KEEPER");

    const initialWntAmount = expandDecimals(10, 18);
    const initialPositionSizeInUsd = expandFloatDecimals(100 * 1000);

    await createOrder(fixture, {
      market: ethUsdMarket,
      initialCollateralToken: wnt,
      initialCollateralDeltaAmount: initialWntAmount,
      sizeDeltaUsd: initialPositionSizeInUsd, // 2x position
      acceptablePrice: expandDecimals(5001, 12),
      orderType: OrderType.LimitIncrease,
      triggerPrice: expandDecimals(5000, 12),
      isLong: true,
    });

    const orderKey = (await orderStore.getOrderKeys(0, 1))[0];
    let order = await orderStore.get(orderKey);

    const { signers } = fixture.accounts;
    const { oracleSalt, signerIndexes } = fixture.props;

    let block = await provider.getBlock(order.numbers.updatedAtBlock.toNumber());
    const tokens = [wnt.address, usdc.address];

    let oracleParams = await getOracleParams({
      oracleSalt,
      oracleBlockNumbers: Array(tokens.length).fill(1, 0, tokens.length), // Invalid block numbers will freeze this order
      oracleTimestamps: Array(tokens.length).fill(block.timestamp, 0, tokens.length),
      blockHashes: Array(tokens.length).fill(block.hash, 0, tokens.length),
      signerIndexes,
      tokens,
      tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      precisions: [8, 18],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      signers,
      priceFeedTokens: [],
    });

    await expect(orderHandler.executeOrder(orderKey, oracleParams)).to.emit(eventEmitter, "OrderFrozen");

    oracleParams = await getOracleParams({
      oracleSalt,
      oracleBlockNumbers: Array(tokens.length).fill(block.number, 0, tokens.length),
      oracleTimestamps: Array(tokens.length).fill(block.timestamp, 0, tokens.length),
      blockHashes: Array(tokens.length).fill(block.hash, 0, tokens.length),
      signerIndexes,
      tokens,
      tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      precisions: [8, 18],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      signers,
      priceFeedTokens: [],
    });

    await expect(orderHandler.executeOrder(orderKey, oracleParams)).to.revertedWith("FROZEN_ORDER_ERROR");

    await grantRole(roleStore, wallet.address, "FROZEN_ORDER_KEEPER");

    await executeOrder(fixture, {
      tokens,
      precisions: [8, 18],
      minPrices: [expandDecimals(5010, 4), expandDecimals(1, 6), expandDecimals(4990, 4), expandDecimals(1, 6)],
      maxPrices: [expandDecimals(5010, 4), expandDecimals(1, 6), expandDecimals(4990, 4), expandDecimals(1, 6)],
    });
    const positionKey = (await positionStore.getPositionKeys(0, 1))[0];
    const positionInfo = await positionStore.get(positionKey);

    expect(positionInfo.numbers.collateralAmount).to.eq(initialWntAmount);
    expect(positionInfo.numbers.sizeInUsd).to.eq(initialPositionSizeInUsd);
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("Cannot increase a position past the reserves for a pool", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWntAmount = expandDecimals(1000, 18);
    const initialPositionSizeInUsd = expandFloatDecimals(100 * 1000 * 1000); // Position size of 100M

    await createOrder(fixture, {
      market: ethUsdMarket,
      initialCollateralToken: wnt,
      initialCollateralDeltaAmount: initialWntAmount,
      sizeDeltaUsd: initialPositionSizeInUsd, // 2x position
      acceptablePrice: expandDecimals(5001, 12),
      orderType: OrderType.MarketIncrease,
      isLong: true,
    });

    const orderKey = (await orderStore.getOrderKeys(0, 1))[0];
    const order = await orderStore.get(orderKey);

    const { signers } = fixture.accounts;
    const { oracleSalt, signerIndexes } = fixture.props;

    const block = await provider.getBlock(order.numbers.updatedAtBlock.toNumber());
    const tokens = [wnt.address, usdc.address];

    const oracleParams = await getOracleParams({
      oracleSalt,
      oracleBlockNumbers: Array(tokens.length).fill(block.number, 0, tokens.length),
      oracleTimestamps: Array(tokens.length).fill(block.timestamp, 0, tokens.length),
      blockHashes: Array(tokens.length).fill(block.hash, 0, tokens.length),
      signerIndexes,
      tokens: tokens,
      tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      precisions: [8, 18],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      signers,
      priceFeedTokens: [],
    });

    await expect(orderHandler.executeOrder(orderKey, oracleParams)).to.emit(eventEmitter, "OrderCancelled");
  });

  it("Can increase a position several times", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWntAmount = expandDecimals(10, 18);
    const initialPositionSizeInUsd = expandFloatDecimals(75 * 1000);
    const initialPositionSizeInTokens = expandDecimals(15, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWntAmount,
        sizeDeltaUsd: initialPositionSizeInUsd, // 2x position
        acceptablePrice: expandDecimals(5001, 12),
        orderType: OrderType.MarketIncrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    const positionKey = (await positionStore.getPositionKeys(0, 1))[0];
    let positionInfo = await positionStore.get(positionKey);

    expect(positionInfo.numbers.collateralAmount).to.eq(initialWntAmount);
    expect(positionInfo.numbers.sizeInUsd).to.eq(initialPositionSizeInUsd);
    expect(positionInfo.numbers.sizeInTokens).to.eq(initialPositionSizeInTokens);
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWntAmount.mul(2),
        sizeDeltaUsd: initialPositionSizeInUsd, // Double my position size
        acceptablePrice: expandDecimals(5001, 12),
        orderType: OrderType.MarketIncrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    positionInfo = await positionStore.get(positionKey);

    expect(positionInfo.numbers.collateralAmount).to.eq(initialWntAmount.mul(3));
    expect(positionInfo.numbers.sizeInUsd).to.eq(initialPositionSizeInUsd.mul(2));
    expect(positionInfo.numbers.sizeInTokens).to.eq(initialPositionSizeInTokens.mul(2));
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: initialPositionSizeInUsd, // Increase my position size by 50%
        acceptablePrice: expandDecimals(10001, 12),
        orderType: OrderType.MarketIncrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(10000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(10000, 4), expandDecimals(1, 6)],
      },
    });

    positionInfo = await positionStore.get(positionKey);

    expect(positionInfo.numbers.collateralAmount).to.eq(initialWntAmount.mul(3));
    expect(positionInfo.numbers.sizeInUsd).to.eq(initialPositionSizeInUsd.mul(3));
    expect(positionInfo.numbers.sizeInTokens).to.eq(initialPositionSizeInTokens.mul(25).div(10));
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("Can increase a position several times when the index token != the long token", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWntAmount = expandDecimals(10, 18);
    const initialPositionSizeInUsd = expandFloatDecimals(100 * 1000);
    const initialPositionSizeInTokens = expandDecimals(5, 8);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWntAmount,
        sizeDeltaUsd: initialPositionSizeInUsd,
        acceptablePrice: expandDecimals(20001, 22),
        orderType: OrderType.MarketIncrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        maxPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      },
    });

    const positionKey = (await positionStore.getPositionKeys(0, 1))[0];
    let positionInfo = await positionStore.get(positionKey);

    expect(positionInfo.numbers.collateralAmount).to.eq(initialWntAmount);
    expect(positionInfo.numbers.sizeInUsd).to.eq(initialPositionSizeInUsd);
    expect(positionInfo.numbers.sizeInTokens).to.eq(initialPositionSizeInTokens);
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWntAmount, // Double my collateral
        sizeDeltaUsd: initialPositionSizeInUsd, // Double my position size
        acceptablePrice: expandDecimals(20001, 22),
        orderType: OrderType.MarketIncrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        maxPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      },
    });

    positionInfo = await positionStore.get(positionKey);

    expect(positionInfo.numbers.collateralAmount).to.eq(initialWntAmount.mul(2));
    expect(positionInfo.numbers.sizeInUsd).to.eq(initialPositionSizeInUsd.mul(2));
    expect(positionInfo.numbers.sizeInTokens).to.eq(initialPositionSizeInTokens.mul(2));
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWntAmount, // Increase my position size by 50%
        sizeDeltaUsd: initialPositionSizeInUsd, // Increase my position size by 50%
        acceptablePrice: expandDecimals(40001, 22),
        orderType: OrderType.MarketIncrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(40000, 2)], // Token price doubles
        maxPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(40000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      },
    });

    positionInfo = await positionStore.get(positionKey);

    expect(positionInfo.numbers.collateralAmount).to.eq(initialWntAmount.mul(3));
    expect(positionInfo.numbers.sizeInUsd).to.eq(initialPositionSizeInUsd.mul(3));
    expect(positionInfo.numbers.sizeInTokens).to.eq(initialPositionSizeInTokens.mul(25).div(10));
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);
  });
});
