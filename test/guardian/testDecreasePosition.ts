import { expect } from "chai";

import { deployFixture } from "../../utils/fixture";
import { expandDecimals, expandFloatDecimals } from "../../utils/math";
import { handleDeposit } from "../../utils/deposit";
import { OrderType, createOrder, handleOrder } from "../../utils/order";
import { getOracleParams, TOKEN_ORACLE_TYPES } from "../../utils/oracle";

describe("Guardian.DecreasePosition", () => {
  const { provider } = ethers;

  let fixture;
  let user0, user1;
  let orderStore,
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
    btcUsdMarket,
    dataStore,
    reader;
  let executionFee;

  beforeEach(async () => {
    fixture = await deployFixture();
    ({ user0, user1 } = fixture.accounts);
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
      orderHandler,
      wbtcPriceFeed,
      btcUsdMarket,
      dataStore,
      reader,
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

    // Handle BTC/USDC deposit
    await handleDeposit(fixture, {
      create: {
        market: btcUsdMarket,
        longTokenAmount: expandDecimals(1000, 8),
        shortTokenAmount: expandDecimals(1000000000000, 6),
      },
      execute: {
        minPrices: [expandDecimals(10000, 2), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(10000, 2), expandDecimals(1, 6)],
        precisions: [2, 18],
        tokens: [wbtc.address, usdc.address],
      },
    });
  });

  it("Only make 50% in ether when ether price doubles", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWNTAmount = expandDecimals(10, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(50 * 1000),
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

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    const wntBalBefore = await wnt.balanceOf(user0.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(50 * 1000),
        acceptablePrice: 0,
        orderType: OrderType.MarketDecrease,
        isLong: true,
        gasUsageLabel: "orderHandler.createOrder",
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(10000, 4), expandDecimals(1, 6)], // Notice I should have doubled my money
        maxPrices: [expandDecimals(10000, 4), expandDecimals(1, 6)],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    const wntBalAfter = await wnt.balanceOf(user0.address);

    expect(wntBalAfter.sub(wntBalBefore)).to.eq(initialWNTAmount.mul(15).div(10)); // I gain 50% in ether since ether price doubled

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("Overcollateralized position profits as expected", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWNTAmount = expandDecimals(100, 18); // Over collateralized

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(50 * 1000),
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

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    const wntBalBefore = await wnt.balanceOf(user0.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(50 * 1000),
        acceptablePrice: 0,
        orderType: OrderType.MarketDecrease,
        isLong: true,
        gasUsageLabel: "orderHandler.createOrder",
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(10000, 4), expandDecimals(1, 6)], // Notice I should have doubled my money
        maxPrices: [expandDecimals(10000, 4), expandDecimals(1, 6)],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    const wntBalAfter = await wnt.balanceOf(user0.address);

    expect(wntBalAfter.sub(wntBalBefore)).to.eq(initialWNTAmount.add(expandDecimals(5, 18))); // I make 50% on my 10 eth position

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("Receive all collateral back when closing the position", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWNTAmount = expandDecimals(10, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(200 * 1000),
        acceptablePrice: expandDecimals(5001, 12),
        orderType: OrderType.MarketIncrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        prices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    let wntBalBefore = await wnt.balanceOf(user0.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(100 * 1000), // Decrease my position by half
        acceptablePrice: 0,
        orderType: OrderType.MarketDecrease,
        isLong: true,
        gasUsageLabel: "orderHandler.createOrder",
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        prices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    let wntBalAfter = await wnt.balanceOf(user0.address);

    expect(wntBalAfter.sub(wntBalBefore)).to.eq(0); // But I didn't get any of my collateral back yet since no initialCollateralDelta was specified

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    // Now I close my position and only now do I receive my collateral back

    wntBalBefore = await wnt.balanceOf(user0.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(100 * 1000), // Decrease my position by the rest
        acceptablePrice: 0,
        orderType: OrderType.MarketDecrease,
        isLong: true,
        gasUsageLabel: "orderHandler.createOrder",
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        prices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    wntBalAfter = await wnt.balanceOf(user0.address);

    expect(wntBalAfter.sub(wntBalBefore)).to.eq(initialWNTAmount); // Now I get my collateral back

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("Index token != long or short token, long position realizes a loss ", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWNTAmount = expandDecimals(1, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(1000),
        acceptablePrice: expandDecimals(400001, 22),
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

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);
    let wntBalBefore = await wnt.balanceOf(user0.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(1000), // Close out my position
        acceptablePrice: 0,
        orderType: OrderType.MarketDecrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(19000, 2)],
        maxPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(19000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      },
    });

    let wntBalAfter = await wnt.balanceOf(user0.address);

    expect(wntBalAfter.sub(wntBalBefore)).to.eq(expandDecimals(95, 16)); // I get back .95 ether, lose 5%
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("Index token != long or short token, long position realizes a gain", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWNTAmount = expandDecimals(1, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(1000),
        acceptablePrice: expandDecimals(400001, 22),
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

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);
    let wntBalBefore = await wnt.balanceOf(user0.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(1000), // Close out my position
        acceptablePrice: 0,
        orderType: OrderType.MarketDecrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(21000, 2)],
        maxPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(21000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      },
    });

    let wntBalAfter = await wnt.balanceOf(user0.address);

    expect(wntBalAfter.sub(wntBalBefore)).to.eq(expandDecimals(105, 16)); // I get back 1.05 ether, gain 5%
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("MarketDecreasing larger than your position reverts", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWNTAmount = expandDecimals(1, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(1000),
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

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await createOrder(fixture, {
      market: ethUsdIndexBtcMarket,
      initialCollateralToken: wnt,
      initialCollateralDeltaAmount: 0,
      sizeDeltaUsd: expandFloatDecimals(2000), // Attempt to decrease by larger than my original position amount
      acceptablePrice: 0,
      orderType: OrderType.MarketDecrease,
      isLong: true,
    });

    const orderKey = (await orderStore.getOrderKeys(0, 1))[0];
    const order = await orderStore.get(orderKey);

    const { signers } = fixture.accounts;
    const { oracleSalt, signerIndexes } = fixture.props;

    const block = await provider.getBlock(order.numbers.updatedAtBlock.toNumber());
    const tokens = [wnt.address, usdc.address, wbtc.address];

    const oracleParams = await getOracleParams({
      oracleSalt,
      oracleBlockNumbers: Array(tokens.length).fill(block.number, 0, tokens.length),
      oracleTimestamps: Array(tokens.length).fill(block.timestamp, 0, tokens.length),
      blockHashes: Array(tokens.length).fill(block.hash, 0, tokens.length),
      signerIndexes,
      tokens: tokens,
      tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      precisions: [8, 18, 20],
      minPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(21000, 2)],
      maxPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(21000, 2)],
      signers,
      priceFeedTokens: [],
    });

    await expect(orderHandler.executeOrder(orderKey, oracleParams))
      .to.emit(eventEmitter, "OrderCancelled")
      .withArgs(orderKey, "DecreasePositionUtils: Invalid order size");
  });

  it("Decrease on an empty position reverts", async () => {
    expect(await positionStore.getPositionCount()).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);

    await createOrder(fixture, {
      market: ethUsdIndexBtcMarket,
      initialCollateralToken: wnt,
      initialCollateralDeltaAmount: 0,
      sizeDeltaUsd: expandFloatDecimals(2000), // Attempt to decrease by larger than my original position amount
      acceptablePrice: 0,
      orderType: OrderType.MarketDecrease,
      isLong: true,
    });

    const orderKey = (await orderStore.getOrderKeys(0, 1))[0];
    const order = await orderStore.get(orderKey);

    const { signers } = fixture.accounts;
    const { oracleSalt, signerIndexes } = fixture.props;

    const block = await provider.getBlock(order.numbers.updatedAtBlock.toNumber());
    const tokens = [wnt.address, usdc.address, wbtc.address];

    const oracleParams = await getOracleParams({
      oracleSalt,
      oracleBlockNumbers: Array(tokens.length).fill(block.number, 0, tokens.length),
      oracleTimestamps: Array(tokens.length).fill(block.timestamp, 0, tokens.length),
      blockHashes: Array(tokens.length).fill(block.hash, 0, tokens.length),
      signerIndexes,
      tokens: tokens,
      tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      precisions: [8, 18, 20],
      minPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(21000, 2)],
      maxPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(21000, 2)],
      signers,
      priceFeedTokens: [],
    });

    await expect(orderHandler.executeOrder(orderKey, oracleParams)).to.be.revertedWith("EMPTY_POSITION_ERROR");

    expect(await orderStore.getOrderCount()).eq(1);
  });

  it("LimitDecrease executes as expected, user realizes profit", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWNTAmount = expandDecimals(1, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(1000),
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

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await positionStore.getPositionCount()).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(1000), // Close out my position
        acceptablePrice: 0,
        orderType: OrderType.LimitDecrease,
        isLong: true,
        triggerPrice: expandDecimals(24000, 22),
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        minPrices: [
          expandDecimals(1000, 4),
          expandDecimals(1, 6),
          expandDecimals(23990, 2),
          expandDecimals(1000, 4),
          expandDecimals(1, 6),
          expandDecimals(24010, 2),
        ],
        maxPrices: [
          expandDecimals(1000, 4),
          expandDecimals(1, 6),
          expandDecimals(23990, 2),
          expandDecimals(1000, 4),
          expandDecimals(1, 6),
          expandDecimals(24010, 2),
        ],
      },
    });

    // I realize my 20% profit
    expect(await wnt.balanceOf(user0.address)).to.eq(initialWNTAmount.mul(12).div(10));

    // My position is closed
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("LimitDecrease with price feed tokens for the increase only", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWNTAmount = expandDecimals(1, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(1000),
        acceptablePrice: expandDecimals(20001, 22),
        orderType: OrderType.MarketIncrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, wbtc.address],
        minPrices: [expandDecimals(1000, 4), expandDecimals(20000, 2)],
        maxPrices: [expandDecimals(1000, 4), expandDecimals(20000, 2)],
        precisions: [8, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        priceFeedTokens: [usdc.address],
      },
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await positionStore.getPositionCount()).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(1000), // Close out my position
        acceptablePrice: 0,
        orderType: OrderType.LimitDecrease,
        isLong: true,
        triggerPrice: expandDecimals(24000, 22),
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        minPrices: [
          expandDecimals(1000, 4),
          expandDecimals(1, 6),
          expandDecimals(23990, 2),
          expandDecimals(1000, 4),
          expandDecimals(1, 6),
          expandDecimals(24010, 2),
        ],
        maxPrices: [
          expandDecimals(1000, 4),
          expandDecimals(1, 6),
          expandDecimals(23990, 2),
          expandDecimals(1000, 4),
          expandDecimals(1, 6),
          expandDecimals(24010, 2),
        ],
      },
    });

    // I realize my 20% profit
    expect(await wnt.balanceOf(user0.address)).to.eq(initialWNTAmount.mul(12).div(10));

    // My position is closed
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("LimitDecrease with price feed tokens for both", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWNTAmount = expandDecimals(1, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(1000),
        acceptablePrice: expandDecimals(20001, 22),
        orderType: OrderType.MarketIncrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, wbtc.address],
        minPrices: [expandDecimals(1000, 4), expandDecimals(20000, 2)],
        maxPrices: [expandDecimals(1000, 4), expandDecimals(20000, 2)],
        precisions: [8, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        priceFeedTokens: [usdc.address],
      },
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await positionStore.getPositionCount()).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(1000), // Close out my position
        acceptablePrice: 0,
        orderType: OrderType.LimitDecrease,
        isLong: true,
        triggerPrice: expandDecimals(24000, 22),
      },
      execute: {
        tokens: [wnt.address, wbtc.address],
        precisions: [8, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        minPrices: [
          expandDecimals(1000, 4),
          expandDecimals(23990, 2),
          expandDecimals(1000, 4),
          expandDecimals(24010, 2),
        ],
        maxPrices: [
          expandDecimals(1000, 4),
          expandDecimals(23990, 2),
          expandDecimals(1000, 4),
          expandDecimals(24010, 2),
        ],
        priceFeedTokens: [usdc.address],
      },
    });

    // I realize my 20% profit
    expect(await wnt.balanceOf(user0.address)).to.eq(initialWNTAmount.mul(12).div(10));

    // My position is closed
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("MarketDecrease with pricefeed tokens", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWNTAmount = expandDecimals(1, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(1000),
        acceptablePrice: expandDecimals(20001, 22),
        orderType: OrderType.MarketIncrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, wbtc.address],
        minPrices: [expandDecimals(1000, 4), expandDecimals(20000, 2)],
        maxPrices: [expandDecimals(1000, 4), expandDecimals(20000, 2)],
        precisions: [8, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        priceFeedTokens: [usdc.address],
      },
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(1000), // Close out my position
        acceptablePrice: 0,
        orderType: OrderType.MarketDecrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, wbtc.address],
        minPrices: [expandDecimals(1000, 4), expandDecimals(24000, 2)],
        maxPrices: [expandDecimals(1000, 4), expandDecimals(24000, 2)],
        precisions: [8, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        priceFeedTokens: [usdc.address],
      },
    });

    // I realize my 20% profit
    expect(await wnt.balanceOf(user0.address)).to.eq(initialWNTAmount.mul(12).div(10));

    // My position is closed
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("Realize profits on a short position with a unique index token", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWNTAmount = expandDecimals(1, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(1000),
        acceptablePrice: expandDecimals(19999, 22),
        orderType: OrderType.MarketIncrease,
        isLong: false,
      },
      execute: {
        tokens: [wnt.address, wbtc.address],
        minPrices: [expandDecimals(1000, 4), expandDecimals(20000, 2)],
        maxPrices: [expandDecimals(1000, 4), expandDecimals(20000, 2)],
        precisions: [8, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        priceFeedTokens: [usdc.address],
      },
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);
    const user0UsdcBalBefore = await usdc.balanceOf(user0.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(1000), // Close out my position
        acceptablePrice: expandDecimals(18001, 22),
        orderType: OrderType.MarketDecrease,
        isLong: false,
      },
      execute: {
        tokens: [wnt.address, wbtc.address],
        minPrices: [expandDecimals(1000, 4), expandDecimals(16000, 2)],
        maxPrices: [expandDecimals(1000, 4), expandDecimals(16000, 2)],
        precisions: [8, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        priceFeedTokens: [usdc.address],
      },
    });

    // I receive back my original collateral
    expect(await wnt.balanceOf(user0.address)).to.eq(initialWNTAmount);

    // My 20% gain is paid out in the short token
    expect((await usdc.balanceOf(user0.address)).sub(user0UsdcBalBefore)).to.eq(expandDecimals(200, 6));

    // My position is closed
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("Realize losses on a short position with a unique index token", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWNTAmount = expandDecimals(1, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(1000),
        acceptablePrice: expandDecimals(19999, 22),
        orderType: OrderType.MarketIncrease,
        isLong: false,
      },
      execute: {
        tokens: [wnt.address, wbtc.address],
        minPrices: [expandDecimals(1000, 4), expandDecimals(20000, 2)],
        maxPrices: [expandDecimals(1000, 4), expandDecimals(20000, 2)],
        precisions: [8, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        priceFeedTokens: [usdc.address],
      },
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);
    const user0UsdcBalBefore = await usdc.balanceOf(user0.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(1000), // Close out my position
        acceptablePrice: expandDecimals(24001, 22),
        orderType: OrderType.MarketDecrease,
        isLong: false,
      },
      execute: {
        tokens: [wnt.address, wbtc.address],
        minPrices: [expandDecimals(1000, 4), expandDecimals(24000, 2)],
        maxPrices: [expandDecimals(1000, 4), expandDecimals(24000, 2)],
        precisions: [8, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        priceFeedTokens: [usdc.address],
      },
    });

    // I receive back my 80% of my original collateral
    expect(await wnt.balanceOf(user0.address)).to.eq(initialWNTAmount.mul(8).div(10));

    // I receive 0 short tokens
    expect((await usdc.balanceOf(user0.address)).sub(user0UsdcBalBefore)).to.eq(0);

    // My position is closed
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("Realize profits from a short position with a LimitDecrease order", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWNTAmount = expandDecimals(1, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(1000),
        acceptablePrice: expandDecimals(19999, 22),
        orderType: OrderType.MarketIncrease,
        isLong: false,
      },
      execute: {
        tokens: [wnt.address, wbtc.address],
        minPrices: [expandDecimals(1000, 4), expandDecimals(20000, 2)],
        maxPrices: [expandDecimals(1000, 4), expandDecimals(20000, 2)],
        precisions: [8, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        priceFeedTokens: [usdc.address],
      },
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);
    const user0UsdcBalBefore = await usdc.balanceOf(user0.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(1000), // Close out my position
        acceptablePrice: expandDecimals(16000, 22),
        orderType: OrderType.LimitDecrease,
        isLong: false,
        triggerPrice: expandDecimals(16000, 22),
      },
      execute: {
        tokens: [wnt.address, wbtc.address],
        minPrices: [
          expandDecimals(1000, 4),
          expandDecimals(16010, 2),
          expandDecimals(1000, 4),
          expandDecimals(15990, 2),
        ],
        maxPrices: [
          expandDecimals(1000, 4),
          expandDecimals(16010, 2),
          expandDecimals(1000, 4),
          expandDecimals(15990, 2),
        ],
        precisions: [8, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        priceFeedTokens: [usdc.address],
      },
    });

    // I receive back my original collateral
    expect(await wnt.balanceOf(user0.address)).to.eq(initialWNTAmount);

    // My 20% gain is paid out in the short token
    expect((await usdc.balanceOf(user0.address)).sub(user0UsdcBalBefore)).to.eq(expandDecimals(200, 6));

    // My position is closed
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("Realize losses from a short position with a LimitDecrease order", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWNTAmount = expandDecimals(1, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(1000),
        acceptablePrice: expandDecimals(19999, 22),
        orderType: OrderType.MarketIncrease,
        isLong: false,
      },
      execute: {
        tokens: [wnt.address, wbtc.address],
        minPrices: [expandDecimals(1000, 4), expandDecimals(20000, 2)],
        maxPrices: [expandDecimals(1000, 4), expandDecimals(20000, 2)],
        precisions: [8, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        priceFeedTokens: [usdc.address],
      },
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);
    const user0UsdcBalBefore = await usdc.balanceOf(user0.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(1000), // Close out my position
        acceptablePrice: expandDecimals(24001, 22),
        orderType: OrderType.LimitDecrease,
        isLong: false,
        triggerPrice: expandDecimals(24000, 22),
      },
      execute: {
        tokens: [wnt.address, wbtc.address],
        minPrices: [
          expandDecimals(1000, 4),
          expandDecimals(24010, 2),
          expandDecimals(1000, 4),
          expandDecimals(23990, 2),
        ],
        maxPrices: [
          expandDecimals(1000, 4),
          expandDecimals(24010, 2),
          expandDecimals(1000, 4),
          expandDecimals(23990, 2),
        ],
        precisions: [8, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        priceFeedTokens: [usdc.address],
      },
    });

    // I receive back my 80% of my original collateral
    expect(await wnt.balanceOf(user0.address)).to.eq(initialWNTAmount.mul(8).div(10));

    // I receive 0 short tokens
    expect((await usdc.balanceOf(user0.address)).sub(user0UsdcBalBefore)).to.eq(0);

    // My position is closed
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("Decrease a position with a swapPath", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWntAmount = expandDecimals(10, 18);
    const initialPositionSizeInUsd = expandFloatDecimals(100 * 1000);
    const initialPositionSizeInTokens = expandDecimals(20, 18);

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

    const userUsdcBefore = await usdc.balanceOf(user0.address);
    const userWntBefore = await wnt.balanceOf(user0.address);
    const userWbtcBefore = await wbtc.balanceOf(user0.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: initialPositionSizeInUsd.div(2), // Decrease my position by half
        acceptablePrice: expandDecimals(4999, 12),
        orderType: OrderType.MarketDecrease,
        swapPath: [ethUsdMarket.marketToken, btcUsdMarket.marketToken],
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(10000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        maxPrices: [expandDecimals(10000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      },
    });

    const userUsdcAfter = await usdc.balanceOf(user0.address);
    const userWntAfter = await wnt.balanceOf(user0.address);
    const userWbtcAfter = await wbtc.balanceOf(user0.address);

    expect(userUsdcAfter.sub(userUsdcBefore)).to.eq(0);
    expect(userWntAfter.sub(userWntBefore)).to.eq(0);
    expect(userWbtcAfter.sub(userWbtcBefore)).to.eq(expandDecimals(25, 7)); // 2.5 WBTC received

    positionInfo = await positionStore.get(positionKey);

    expect(positionInfo.numbers.collateralAmount).to.eq(initialWntAmount);
    expect(positionInfo.numbers.sizeInUsd).to.eq(initialPositionSizeInUsd.div(2));
    expect(positionInfo.numbers.sizeInTokens).to.eq(initialPositionSizeInTokens.div(2));
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("StopLoss decrease works as expected for longs", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialUSDCAmount = expandDecimals(50000, 6);
    const initialPositionSizeInUsd = expandFloatDecimals(100 * 1000);
    const initialPositionSizeInTokens = expandDecimals(20, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: initialUSDCAmount,
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

    expect(positionInfo.numbers.collateralAmount).to.eq(initialUSDCAmount);
    expect(positionInfo.numbers.sizeInUsd).to.eq(initialPositionSizeInUsd);
    expect(positionInfo.numbers.sizeInTokens).to.eq(initialPositionSizeInTokens);
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    const userWntBefore = await wnt.balanceOf(user0.address);
    const userUsdcBefore = await usdc.balanceOf(user0.address);

    const ethUsdMarketUsdcPoolAmountBefore = await reader.getPoolAmount(
      dataStore.address,
      ethUsdMarket.marketToken,
      usdc.address
    );
    const ethUsdMarketWntPoolAmountBefore = await reader.getPoolAmount(
      dataStore.address,
      ethUsdMarket.marketToken,
      wnt.address
    );

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: initialPositionSizeInUsd,
        acceptablePrice: expandDecimals(4000, 12),
        triggerPrice: expandDecimals(4000, 12),
        orderType: OrderType.StopLossDecrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(3990, 4), expandDecimals(1, 6), expandDecimals(4010, 4), expandDecimals(1, 6)], // Notice that the price range must be increasing due to a known bug
        maxPrices: [expandDecimals(3990, 4), expandDecimals(1, 6), expandDecimals(4010, 4), expandDecimals(1, 6)],
      },
    });

    const userWntAfter = await wnt.balanceOf(user0.address);
    const userUsdcAfter = await usdc.balanceOf(user0.address);

    positionInfo = await positionStore.get(positionKey);

    // My position has been closed and I receive all collateral back
    expect(positionInfo.numbers.collateralAmount).to.eq(0);
    expect(positionInfo.numbers.sizeInUsd).to.eq(0);
    expect(positionInfo.numbers.sizeInTokens).to.eq(0);

    expect(userWntAfter.sub(userWntBefore)).to.eq(0);
    expect(userUsdcAfter.sub(userUsdcBefore)).to.eq(initialUSDCAmount.sub(expandDecimals(20 * 1000, 6))); // Realize Losses

    const ethUsdMarketUsdcPoolAmountAfter = await reader.getPoolAmount(
      dataStore.address,
      ethUsdMarket.marketToken,
      usdc.address
    );
    const ethUsdMarketWntPoolAmountAfter = await reader.getPoolAmount(
      dataStore.address,
      ethUsdMarket.marketToken,
      wnt.address
    );

    // Pool realizes gains
    expect(ethUsdMarketUsdcPoolAmountAfter).to.eq(ethUsdMarketUsdcPoolAmountBefore.add(expandDecimals(20 * 1000, 6)));
    expect(ethUsdMarketWntPoolAmountAfter).to.eq(ethUsdMarketWntPoolAmountBefore);

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("StopLoss decrease works as expected for shorts", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialUSDCAmount = expandDecimals(50000, 6);
    const initialPositionSizeInUsd = expandFloatDecimals(100 * 1000);
    const initialPositionSizeInTokens = expandDecimals(20, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: initialUSDCAmount,
        sizeDeltaUsd: initialPositionSizeInUsd, // 2x position
        acceptablePrice: expandDecimals(4999, 12),
        orderType: OrderType.MarketIncrease,
        isLong: false,
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    const positionKey = (await positionStore.getPositionKeys(0, 1))[0];
    let positionInfo = await positionStore.get(positionKey);

    expect(positionInfo.numbers.collateralAmount).to.eq(initialUSDCAmount);
    expect(positionInfo.numbers.sizeInUsd).to.eq(initialPositionSizeInUsd);
    expect(positionInfo.numbers.sizeInTokens).to.eq(initialPositionSizeInTokens);
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    const userWntBefore = await wnt.balanceOf(user0.address);
    const userUsdcBefore = await usdc.balanceOf(user0.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: initialPositionSizeInUsd,
        acceptablePrice: expandDecimals(6000, 12),
        triggerPrice: expandDecimals(6000, 12),
        orderType: OrderType.StopLossDecrease,
        isLong: false,
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(6010, 4), expandDecimals(1, 6), expandDecimals(5990, 4), expandDecimals(1, 6)], // Notice that the price range must be decreasing due to a known bug
        maxPrices: [expandDecimals(6010, 4), expandDecimals(1, 6), expandDecimals(5990, 4), expandDecimals(1, 6)],
      },
    });

    const userWntAfter = await wnt.balanceOf(user0.address);
    const userUsdcAfter = await usdc.balanceOf(user0.address);

    positionInfo = await positionStore.get(positionKey);

    // My position has been closed and I receive all collateral back
    expect(positionInfo.numbers.collateralAmount).to.eq(0);
    expect(positionInfo.numbers.sizeInUsd).to.eq(0);
    expect(positionInfo.numbers.sizeInTokens).to.eq(0);

    expect(userWntAfter.sub(userWntBefore)).to.eq(0);
    expect(userUsdcAfter.sub(userUsdcBefore)).to.eq(initialUSDCAmount.sub(expandDecimals(20 * 1000, 6))); // Realize Losses

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
  });
});
