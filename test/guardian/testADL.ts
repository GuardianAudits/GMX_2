import { expect } from "chai";

import { deployFixture } from "../../utils/fixture";
import { decimalToFloat, expandDecimals, expandFloatDecimals } from "../../utils/math";
import { handleDeposit } from "../../utils/deposit";
import { OrderType, handleOrder } from "../../utils/order";
import { getOracleParams, TOKEN_ORACLE_TYPES } from "../../utils/oracle";
import { isAdlEnabledKey, maxPnlFactorKey } from "../../utils/keys";
import { grantRole } from "../../utils/role";

describe("Guardian.ADL", () => {
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
    marketUtils,
    eventEmitter,
    orderHandler,
    wbtcPriceFeed,
    btcUsdMarket,
    dataStore,
    marketStore,
    oracle,
    reader;
  let executionFee, isADLEnabledLongKey, isADLEnabledShortKey, maxPnlFactorLongKey, maxPnlFactorShortKey, roleStore;

  const maxPnlFactor = decimalToFloat(5, 1); // 50% of pool value

  beforeEach(async () => {
    fixture = await deployFixture();
    ({ user0, user1 } = fixture.accounts);
    ({
      orderStore,
      positionStore,
      ethUsdMarket,
      oracle,
      wnt,
      usdc,
      marketStore,
      roleStore,
      exchangeRouter,
      ethUsdIndexBtcMarket,
      wbtc,
      eventEmitter,
      orderHandler,
      wbtcPriceFeed,
      btcUsdMarket,
      dataStore,
      marketUtils,
      reader,
    } = fixture.contracts);
    ({ executionFee } = fixture.props);

    await handleDeposit(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        longTokenAmount: expandDecimals(100, 18),
        shortTokenAmount: expandDecimals(500000, 6),
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        maxPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      },
    });

    isADLEnabledLongKey = isAdlEnabledKey(ethUsdIndexBtcMarket.marketToken, true);
    isADLEnabledShortKey = isAdlEnabledKey(ethUsdIndexBtcMarket.marketToken, false);
    maxPnlFactorLongKey = maxPnlFactorKey(ethUsdIndexBtcMarket.marketToken, true);
    maxPnlFactorShortKey = maxPnlFactorKey(ethUsdIndexBtcMarket.marketToken, false);

    await dataStore.setUint(maxPnlFactorLongKey, maxPnlFactor);
    await dataStore.setUint(maxPnlFactorShortKey, maxPnlFactor);
  });

  it("May turn on ADL when the pnlToPoolFactor exceeds the maxPnlFactor and off when that is no longer the case -- ADL pnlToPoolRatio > 1", async () => {
    await dataStore.setUint(maxPnlFactorLongKey, expandFloatDecimals(2));
    await dataStore.setUint(maxPnlFactorShortKey, expandFloatDecimals(2));

    expect(await positionStore.getPositionCount()).to.eq(0);
    expect(await dataStore.getBool(isADLEnabledLongKey)).to.eq(false);
    expect(await dataStore.getBool(isADLEnabledShortKey)).to.eq(false);

    const { signers, wallet } = fixture.accounts;
    const { oracleSalt, signerIndexes } = fixture.props;

    await grantRole(roleStore, wallet.address, "ADL_KEEPER");

    let block = await provider.getBlock();
    const tokens = [wnt.address, usdc.address, wbtc.address];

    let oracleParams = await getOracleParams({
      oracleSalt,
      oracleBlockNumbers: Array(tokens.length).fill(block.number, 0, tokens.length),
      oracleTimestamps: Array(tokens.length).fill(block.timestamp, 0, tokens.length),
      blockHashes: Array(tokens.length).fill(block.hash, 0, tokens.length),
      signerIndexes,
      tokens: tokens,
      tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      precisions: [8, 18, 20],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
      signers,
      priceFeedTokens: [],
    });

    await orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, true, oracleParams);
    await orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, false, oracleParams);

    // ADL is not turned on since the PnL is not twice the pool value
    expect(await dataStore.getBool(isADLEnabledLongKey)).to.eq(false);
    expect(await dataStore.getBool(isADLEnabledShortKey)).to.eq(false);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(25, 18),
        sizeDeltaUsd: expandFloatDecimals(120 * 1000),
        acceptablePrice: expandDecimals(20001, 22),
        orderType: OrderType.MarketIncrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      },
    });

    expect(await positionStore.getPositionCount()).to.eq(1);

    block = await provider.getBlock();

    oracleParams = await getOracleParams({
      oracleSalt,
      oracleBlockNumbers: Array(tokens.length).fill(block.number, 0, tokens.length),
      oracleTimestamps: Array(tokens.length).fill(block.timestamp, 0, tokens.length),
      blockHashes: Array(tokens.length).fill(block.hash, 0, tokens.length),
      signerIndexes,
      tokens: tokens,
      tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      precisions: [8, 18, 20],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
      signers,
      priceFeedTokens: [],
    });

    await orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, true, oracleParams);
    await orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, false, oracleParams);

    // ADL is still not turned on since the PnL is not twice the pool value
    expect(await dataStore.getBool(isADLEnabledLongKey)).to.eq(false);
    expect(await dataStore.getBool(isADLEnabledShortKey)).to.eq(false);

    // Price of BTC 10x's
    // Pool Long USD = 500k
    // Pool Short USD = 500k
    // PnL Long = 1.2M - 120k = 1.08M
    // PnL Short = 0
    block = await provider.getBlock();

    oracleParams = await getOracleParams({
      oracleSalt,
      oracleBlockNumbers: Array(tokens.length).fill(block.number, 0, tokens.length),
      oracleTimestamps: Array(tokens.length).fill(block.timestamp, 0, tokens.length),
      blockHashes: Array(tokens.length).fill(block.hash, 0, tokens.length),
      signerIndexes,
      tokens: tokens,
      tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      precisions: [8, 18, 20],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(200000, 2)],
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(200000, 2)],
      signers,
      priceFeedTokens: [],
    });

    await orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, true, oracleParams);
    await orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, false, oracleParams);

    // ADL is now activated for the long side
    expect(await dataStore.getBool(isADLEnabledLongKey)).to.eq(true);

    // ADL is still not activated for the short side as there is not any short side PnL
    expect(await dataStore.getBool(isADLEnabledShortKey)).to.eq(false);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(10, 18),
        sizeDeltaUsd: expandFloatDecimals(200 * 1000),
        acceptablePrice: expandDecimals(20001, 22),
        orderType: OrderType.MarketIncrease,
        isLong: false,
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(200000, 2)], // Opens a short @ 200k
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(200000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      },
    });

    expect(await positionStore.getPositionCount()).to.eq(2);

    // Price of BTC 1/10th's
    // Pool Long USD = 500k
    // Pool Short USD = 500k
    // PnL Long = 0
    // PnL Short = 180k
    block = await provider.getBlock();

    oracleParams = await getOracleParams({
      oracleSalt,
      oracleBlockNumbers: Array(tokens.length).fill(block.number, 0, tokens.length),
      oracleTimestamps: Array(tokens.length).fill(block.timestamp, 0, tokens.length),
      blockHashes: Array(tokens.length).fill(block.hash, 0, tokens.length),
      signerIndexes,
      tokens: tokens,
      tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      precisions: [8, 18, 20],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
      signers,
      priceFeedTokens: [],
    });

    await orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, true, oracleParams);
    await orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, false, oracleParams);

    // ADL is no longer activated for the long side, as there is no longer PnL on the long side
    expect(await dataStore.getBool(isADLEnabledLongKey)).to.eq(false);

    // Notice that ADL for the short side should never be necessary as validateReserves
    // will not allow short positions to be opened with sizes greater than the pool could pay out if
    // the shorted token goes to 0.
    expect(await dataStore.getBool(isADLEnabledShortKey)).to.eq(false);
  });

  it("May turn on ADL when the pnlToPoolFactor exceeds the maxPnlFactor and off when that is no longer the case -- ADL pnlToPoolRatio < 1", async () => {
    expect(await positionStore.getPositionCount()).to.eq(0);
    expect(await dataStore.getBool(isADLEnabledLongKey)).to.eq(false);
    expect(await dataStore.getBool(isADLEnabledShortKey)).to.eq(false);

    const { signers, wallet } = fixture.accounts;
    const { oracleSalt, signerIndexes } = fixture.props;

    await grantRole(roleStore, wallet.address, "ADL_KEEPER");

    let block = await provider.getBlock();
    const tokens = [wnt.address, usdc.address, wbtc.address];

    let oracleParams = await getOracleParams({
      oracleSalt,
      oracleBlockNumbers: Array(tokens.length).fill(block.number, 0, tokens.length),
      oracleTimestamps: Array(tokens.length).fill(block.timestamp, 0, tokens.length),
      blockHashes: Array(tokens.length).fill(block.hash, 0, tokens.length),
      signerIndexes,
      tokens: tokens,
      tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      precisions: [8, 18, 20],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
      signers,
      priceFeedTokens: [],
    });

    await orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, true, oracleParams);
    await orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, false, oracleParams);

    // ADL is not turned on since the PnL is not twice the pool value
    expect(await dataStore.getBool(isADLEnabledLongKey)).to.eq(false);

    expect(await dataStore.getBool(isADLEnabledShortKey)).to.eq(false);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(25, 18),
        sizeDeltaUsd: expandFloatDecimals(150 * 1000),
        acceptablePrice: expandDecimals(20001, 22),
        orderType: OrderType.MarketIncrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      },
    });

    expect(await positionStore.getPositionCount()).to.eq(1);

    block = await provider.getBlock();

    oracleParams = await getOracleParams({
      oracleSalt,
      oracleBlockNumbers: Array(tokens.length).fill(block.number, 0, tokens.length),
      oracleTimestamps: Array(tokens.length).fill(block.timestamp, 0, tokens.length),
      blockHashes: Array(tokens.length).fill(block.hash, 0, tokens.length),
      signerIndexes,
      tokens: tokens,
      tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      precisions: [8, 18, 20],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
      signers,
      priceFeedTokens: [],
    });

    await orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, true, oracleParams);
    await orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, false, oracleParams);

    // ADL is still not turned on since the PnL is not half the pool value
    expect(await dataStore.getBool(isADLEnabledLongKey)).to.eq(false);
    expect(await dataStore.getBool(isADLEnabledShortKey)).to.eq(false);

    // Price of BTC 3x's
    // Pool Long USD = 500k
    // Pool Short USD = 500k
    // PnL Long = 450k - 150k = 300k
    // PnL Short = 0
    block = await provider.getBlock();

    oracleParams = await getOracleParams({
      oracleSalt,
      oracleBlockNumbers: Array(tokens.length).fill(block.number, 0, tokens.length),
      oracleTimestamps: Array(tokens.length).fill(block.timestamp, 0, tokens.length),
      blockHashes: Array(tokens.length).fill(block.hash, 0, tokens.length),
      signerIndexes,
      tokens: tokens,
      tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      precisions: [8, 18, 20],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(60000, 2)],
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(60000, 2)],
      signers,
      priceFeedTokens: [],
    });

    await orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, true, oracleParams);
    await orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, false, oracleParams);

    // ADL is now activated for the long side
    expect(await dataStore.getBool(isADLEnabledLongKey)).to.eq(true);

    // ADL is still not activated for the short side as there is not any short side PnL
    expect(await dataStore.getBool(isADLEnabledShortKey)).to.eq(false);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(10, 18),
        sizeDeltaUsd: expandFloatDecimals(200 * 1000),
        acceptablePrice: expandDecimals(20001, 22),
        orderType: OrderType.MarketIncrease,
        isLong: false,
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(60000, 2)], // Opens a short @ 60k
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(60000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      },
    });

    expect(await positionStore.getPositionCount()).to.eq(2);

    // Price of BTC 1/5ths
    // Pool Long USD = 500k
    // Pool Short USD = 500k
    // PnL Long = -60k
    // PnL Short = 160k
    block = await provider.getBlock();

    oracleParams = await getOracleParams({
      oracleSalt,
      oracleBlockNumbers: Array(tokens.length).fill(block.number, 0, tokens.length),
      oracleTimestamps: Array(tokens.length).fill(block.timestamp, 0, tokens.length),
      blockHashes: Array(tokens.length).fill(block.hash, 0, tokens.length),
      signerIndexes,
      tokens: tokens,
      tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      precisions: [8, 18, 20],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(12000, 2)],
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(12000, 2)],
      signers,
      priceFeedTokens: [],
    });

    await orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, true, oracleParams);
    await orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, false, oracleParams);

    // ADL is no longer activated for the long side, as there is no longer PnL on the long side
    expect(await dataStore.getBool(isADLEnabledLongKey)).to.eq(false);

    // Notice that ADL for the short side should never be necessary as validateReserves
    // will not allow short positions to be opened with sizes greater than the pool could pay out if
    // the shorted token goes to 0.
    expect(await dataStore.getBool(isADLEnabledShortKey)).to.eq(false);
  });

  it("Only adl keeper may upateAdlState", async () => {
    const { signers, wallet } = fixture.accounts;
    const { oracleSalt, signerIndexes } = fixture.props;

    const block = await provider.getBlock();
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
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
      signers,
      priceFeedTokens: [],
    });

    await expect(orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, true, oracleParams))
      .to.be.revertedWithCustomError(roleStore, "Unauthorized")
      .withArgs(wallet.address, "ADL_KEEPER");
    await expect(orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, false, oracleParams))
      .to.be.revertedWithCustomError(roleStore, "Unauthorized")
      .withArgs(wallet.address, "ADL_KEEPER");
  });

  it("Cannot execute ADL when it is not enabled", async () => {
    expect(await positionStore.getPositionCount()).to.eq(0);
    expect(await dataStore.getBool(isADLEnabledLongKey)).to.eq(false);
    expect(await dataStore.getBool(isADLEnabledShortKey)).to.eq(false);

    const { signers, wallet } = fixture.accounts;
    const { oracleSalt, signerIndexes } = fixture.props;

    const tokens = [wnt.address, usdc.address, wbtc.address];

    await grantRole(roleStore, wallet.address, "ADL_KEEPER");

    const originalPositionSize = expandFloatDecimals(100 * 1000);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(25, 18),
        sizeDeltaUsd: originalPositionSize,
        acceptablePrice: expandDecimals(20001, 22),
        orderType: OrderType.MarketIncrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      },
    });

    expect(await positionStore.getPositionCount()).to.eq(1);

    const block = await provider.getBlock();

    const oracleParams = await getOracleParams({
      oracleSalt,
      oracleBlockNumbers: Array(tokens.length).fill(block.number, 0, tokens.length),
      oracleTimestamps: Array(tokens.length).fill(block.timestamp, 0, tokens.length),
      blockHashes: Array(tokens.length).fill(block.hash, 0, tokens.length),
      signerIndexes,
      tokens: tokens,
      tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      precisions: [8, 18, 20],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
      signers,
      priceFeedTokens: [],
    });

    await expect(
      orderHandler.executeAdl(
        user0.address,
        ethUsdIndexBtcMarket.marketToken,
        wnt.address,
        true,
        originalPositionSize.div(2),
        oracleParams
      )
    ).to.be.revertedWith("Adl is not enabled");
  });

  it("Can decrease a position by half using ADL - ADL pnlToPoolRatio > 1", async () => {
    expect(await positionStore.getPositionCount()).to.eq(0);
    expect(await dataStore.getBool(isADLEnabledLongKey)).to.eq(false);
    expect(await dataStore.getBool(isADLEnabledShortKey)).to.eq(false);

    const { signers, wallet } = fixture.accounts;
    const { oracleSalt, signerIndexes } = fixture.props;

    const tokens = [wnt.address, usdc.address, wbtc.address];

    await grantRole(roleStore, wallet.address, "ADL_KEEPER");

    const originalPositionSize = expandFloatDecimals(150 * 1000);

    await handleOrder(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(25, 18),
        sizeDeltaUsd: originalPositionSize,
        acceptablePrice: expandDecimals(20001, 22),
        orderType: OrderType.MarketIncrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      },
    });

    expect(await positionStore.getPositionCount()).to.eq(1);

    let block = await provider.getBlock();

    let oracleParams = await getOracleParams({
      oracleSalt,
      oracleBlockNumbers: Array(tokens.length).fill(block.number, 0, tokens.length),
      oracleTimestamps: Array(tokens.length).fill(block.timestamp, 0, tokens.length),
      blockHashes: Array(tokens.length).fill(block.hash, 0, tokens.length),
      signerIndexes,
      tokens: tokens,
      tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      precisions: [8, 18, 20],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(60000, 2)], // BTC 3x's
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(60000, 2)],
      signers,
      priceFeedTokens: [],
    });

    await orderHandler.updateAdlState(ethUsdIndexBtcMarket.marketToken, true, oracleParams);

    expect(await dataStore.getBool(isADLEnabledLongKey)).to.eq(true);
    expect(await dataStore.getBool(isADLEnabledShortKey)).to.eq(false);

    block = await provider.getBlock();

    oracleParams = await getOracleParams({
      oracleSalt,
      oracleBlockNumbers: Array(tokens.length).fill(block.number, 0, tokens.length),
      oracleTimestamps: Array(tokens.length).fill(block.timestamp, 0, tokens.length),
      blockHashes: Array(tokens.length).fill(block.hash, 0, tokens.length),
      signerIndexes,
      tokens: tokens,
      tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      precisions: [8, 18, 20],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(60000, 2)],
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(60000, 2)],
      signers,
      priceFeedTokens: [],
    });

    // Notice that ADL does not currently work due to a bug where the OI in tokens
    // is incremented rather than decremented when decreasing the size of a position.
    // See PoCs.ts "DecreasePosition increases openInterestInTokens" for a PoC on this particular bug.
    await expect(
      orderHandler.executeAdl(
        user0.address,
        ethUsdIndexBtcMarket.marketToken,
        wnt.address,
        true,
        originalPositionSize.div(2),
        oracleParams
      )
    ).to.be.revertedWith("Invalid adl");
  });
});
