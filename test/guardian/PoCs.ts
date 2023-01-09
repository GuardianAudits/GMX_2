import { expect } from "chai";

import { deployFixture } from "../../utils/fixture";
import { decimalToFloat, expandDecimals, expandFloatDecimals } from "../../utils/math";
import { handleDeposit } from "../../utils/deposit";
import { OrderType, createOrder, executeOrder, executeLiquidation, handleOrder } from "../../utils/order";
import { getOracleParams, TOKEN_ORACLE_TYPES } from "../../utils/oracle";
import { getBalanceOf } from "../../utils/token";
import { createWithdrawal } from "../../utils/withdrawal";
import * as keys from "../../utils/keys";
import { mine } from "@nomicfoundation/hardhat-network-helpers";
import { cumulativeBorrowingFactorKey, executeOrderFeatureKey } from "../../utils/keys";
import { network } from "hardhat";

describe("Guardian.PoCs", () => {
  let fixture;
  let user0, user1, user2, user3;
  let orderStore,
    positionStore,
    ethUsdMarket,
    btcUsdMarket,
    ethUsdIndexBtcMarket,
    wnt,
    wbtc,
    usdc,
    attackCallbackContract,
    reader,
    dataStore,
    toggleAcceptContract,
    tokenUtils,
    withdrawalStore,
    ethUsdMarketUsdcAmount,
    ethUsdMarketWntAmount,
    ethUsdIndexBtcMarketUsdcAmount,
    ethUsdIndexBtcMarketWntAmount,
    eventEmitter,
    withdrawalHandler,
    orderHandler,
    exchangeRouter;
  let executionFee;

  const { provider } = ethers;

  beforeEach(async function () {
    fixture = await deployFixture();
    ({ user0, user1, user2, user3 } = fixture.accounts);
    ({
      orderStore,
      positionStore,
      ethUsdMarket,
      btcUsdMarket,
      wnt,
      wbtc,
      usdc,
      attackCallbackContract,
      reader,
      dataStore,
      toggleAcceptContract,
      tokenUtils,
      withdrawalStore,
      eventEmitter,
      withdrawalHandler,
      ethUsdIndexBtcMarket,
      orderHandler,
      exchangeRouter,
    } = fixture.contracts);
    ({ executionFee } = fixture.props);

    ethUsdMarketUsdcAmount = expandDecimals(1000000, 6);
    ethUsdMarketWntAmount = expandDecimals(2000, 18);

    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        longTokenAmount: ethUsdMarketWntAmount,
        shortTokenAmount: ethUsdMarketUsdcAmount,
      },
    });

    ethUsdIndexBtcMarketWntAmount = expandDecimals(1000, 18);
    ethUsdIndexBtcMarketUsdcAmount = expandDecimals(1000000000000, 6);

    await handleDeposit(fixture, {
      create: {
        market: ethUsdIndexBtcMarket,
        longTokenAmount: ethUsdIndexBtcMarketWntAmount,
        shortTokenAmount: ethUsdIndexBtcMarketUsdcAmount,
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
        precisions: [20, 18],
        tokens: [wbtc.address, usdc.address],
      },
    });
  });

  /* --------------------------------- CRITICAL --------------------------------- */

  it("CRITICAL - ORDH-1: Phantom Decrease orders can be gamed for risk-free profit", async () => {
    const initialWNTAmount = expandDecimals(10, 18);
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    await createOrder(fixture, {
      market: ethUsdMarket,
      initialCollateralToken: wnt,
      initialCollateralDeltaAmount: 0,
      sizeDeltaUsd: expandFloatDecimals(50 * 1000),
      acceptablePrice: 0,
      orderType: OrderType.MarketDecrease,
      isLong: true,
      gasUsageLabel: "orderHandler.createOrder",
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(1);

    const decreasePosition = async () =>
      await executeOrder(fixture, {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(10000, 4), expandDecimals(1, 6)], // price of ether in the block of the decrease order is 10k
        maxPrices: [expandDecimals(10000, 4), expandDecimals(1, 6)],
        gasUsageLabel: "orderHandler.executeOrder",
      });

    await expect(decreasePosition()).to.be.revertedWith("EMPTY_POSITION_ERROR");

    // The price of ether then halves

    await createOrder(fixture, {
      market: ethUsdMarket,
      initialCollateralToken: wnt,
      initialCollateralDeltaAmount: expandDecimals(10, 18),
      sizeDeltaUsd: expandFloatDecimals(50 * 1000),
      acceptablePrice: expandDecimals(5001, 12),
      orderType: OrderType.MarketIncrease,
      isLong: true,
      gasUsageLabel: "orderHandler.createOrder",
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(2);
    const orderKeys = await orderStore.getOrderKeys(1, 2);

    await executeOrder(fixture, {
      tokens: [wnt.address, usdc.address],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)], // price of ether in the block of the increase order is 5k
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      key: orderKeys[0],
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(1);

    const wntBalBefore = await wnt.balanceOf(user0.address);

    await decreasePosition();

    const wntBalAfter = await wnt.balanceOf(user0.address);

    expect(wntBalAfter.sub(wntBalBefore)).to.gt(initialWNTAmount); // Risk free profit

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("CRITICAL - ORDU-1: Cancel With Callback Double Counts", async () => {
    const contractBalanceBefore = await wnt.balanceOf(attackCallbackContract.address);
    expect(contractBalanceBefore).to.eq(0);

    expect(await orderStore.getOrderCount()).eq(0);
    const callbackParams = {
      market: ethUsdMarket,
      initialCollateralToken: wnt,
      initialCollateralDeltaAmount: expandDecimals(10, 18),
      swapPath: [],
      sizeDeltaUsd: expandFloatDecimals(200 * 1000),
      triggerPrice: expandDecimals(5000, 12),
      acceptablePrice: expandDecimals(5000, 12),
      executionFee,
      minOutputAmount: expandDecimals(0, 6),
      orderType: OrderType.LimitIncrease,
      isLong: true,
      shouldUnwrapNativeToken: false,
      gasUsageLabel: "createOrder",
      account: attackCallbackContract,
      callbackContract: attackCallbackContract,
      callbackGasLimit: ethers.utils.parseEther("1"),
    };

    await createOrder(fixture, callbackParams);

    const params = {
      market: ethUsdMarket,
      initialCollateralToken: wnt,
      initialCollateralDeltaAmount: expandDecimals(1000, 18),
      swapPath: [],
      sizeDeltaUsd: expandFloatDecimals(100 * 100000),
      triggerPrice: expandDecimals(5000, 12),
      acceptablePrice: expandDecimals(5000, 12),
      executionFee,
      minOutputAmount: expandDecimals(0, 6),
      orderType: OrderType.LimitIncrease,
      isLong: true,
      shouldUnwrapNativeToken: false,
      gasUsageLabel: "createOrder",
    };
    await createOrder(fixture, params);

    expect(await orderStore.getOrderCount()).eq(2);
    expect(await positionStore.getAccountPositionCount(attackCallbackContract.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);

    const orderKey = (await orderStore.getOrderKeys(0, 1))[0];
    const order = await orderStore.get(orderKey);

    const prices = [
      expandDecimals(10000, 2),
      expandDecimals(5000, 4),
      expandDecimals(1, 6),
      expandDecimals(10000, 2),
      expandDecimals(5000, 4),
      expandDecimals(1, 6),
    ];

    // *************** BEGIN ORDER EXECUTION ***************
    await executeOrder(fixture, {
      gasUsageLabel: "executeOrder",
      tokenOracleTypes: [
        TOKEN_ORACLE_TYPES.DEFAULT,
        TOKEN_ORACLE_TYPES.DEFAULT,
        TOKEN_ORACLE_TYPES.DEFAULT,
        TOKEN_ORACLE_TYPES.DEFAULT,
        TOKEN_ORACLE_TYPES.DEFAULT,
        TOKEN_ORACLE_TYPES.DEFAULT,
      ],
      precisions: [20, 8, 18, 20, 8, 18],
      minPrices: prices,
      maxPrices: prices,
      tokens: [wbtc.address, wnt.address, usdc.address],
      oracleBlockNumber: order.numbers.updatedAtBlock.add(1),
    });

    expect(await orderStore.getOrderCount()).eq(1);
    expect(await positionStore.getAccountPositionCount(attackCallbackContract.address)).eq(1);
    expect(await positionStore.getPositionCount()).eq(1);
    const keys = await positionStore.getPositionKeys(0, 1);
    const position = await positionStore.get(keys[0]);
    // Callback contract has a position
    expect(position.numbers.sizeInTokens).to.be.eq(ethers.utils.parseEther("40")); // $200,000 size / $5,000 token price

    const contractBalanceAfter = await wnt.balanceOf(attackCallbackContract.address);
    // AND the callback contract has the initial collateral delta returned due to the cancellation
    expect(contractBalanceBefore).to.lt(contractBalanceAfter);
    expect(contractBalanceAfter).to.gte(ethers.utils.parseEther("10"));
  });

  it("CRITICAL - GLOBAL-1: Can make unliquidateable positions", async () => {
    expect(await orderStore.getOrderCount()).eq(0);
    const createOrderParams = {
      market: ethUsdMarket,
      initialCollateralToken: wnt,
      swapPath: [],
      initialCollateralDeltaAmount: expandDecimals(10, 18), // Ether is 5k, collateral valued at $50,000
      sizeDeltaUsd: expandFloatDecimals(500 * 1000), // Position size of $500,000, 10x leverage
      acceptablePrice: expandDecimals(5001, 12),
      executionFee,
      orderType: OrderType.MarketIncrease,
      isLong: true,
      shouldUnwrapNativeToken: false,
      gasUsageLabel: "createOrder",
      account: toggleAcceptContract,
    };

    await createOrder(fixture, createOrderParams);

    expect(await orderStore.getOrderCount()).eq(1);

    await executeOrder(fixture, {
      tokens: [wnt.address, usdc.address],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)], // price of ether in the block of the increase order is 5k
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
    });

    expect(await positionStore.getAccountPositionCount(toggleAcceptContract.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await toggleAcceptContract.setCanAccept(false);

    // Liquidation is reverted with "NativeTokenTransferError" as the contract cannot accept ether
    await expect(
      executeLiquidation(fixture, {
        account: toggleAcceptContract.address,
        market: ethUsdMarket,
        collateralToken: wnt,
        isLong: true,
        minPrices: [expandDecimals(4550, 4), expandDecimals(1, 6)], // Ether dips to $4550
        maxPrices: [expandDecimals(4550, 4), expandDecimals(1, 6)], // Ether dips to $4550
        gasUsageLabel: "orderHandler.executeLiquidation",
      })
    ).to.be.revertedWithCustomError(tokenUtils, "NativeTokenTransferError");

    // When the liquidation contract can accept ether, it's position can now be liquidated
    await toggleAcceptContract.setCanAccept(true);

    await executeLiquidation(fixture, {
      account: toggleAcceptContract.address,
      market: ethUsdMarket,
      collateralToken: wnt,
      isLong: true,
      minPrices: [expandDecimals(4550, 4), expandDecimals(1, 6)], // Ether dips to $4550
      maxPrices: [expandDecimals(4550, 4), expandDecimals(1, 6)], // Ether dips to $4550
      gasUsageLabel: "orderHandler.executeLiquidation",
    });

    expect(await positionStore.getAccountPositionCount(toggleAcceptContract.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("CRITICAL - ORDU-2: Malicious contract can control when orders are executed via the fee refund", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWntAmount = expandDecimals(10, 18);
    const initialPositionSizeInUsd = expandFloatDecimals(100 * 1000);
    const initialPositionSizeInTokens = expandDecimals(20, 18);

    await toggleAcceptContract.setCanAccept(false);

    await createOrder(fixture, {
      account: toggleAcceptContract,
      market: ethUsdMarket,
      initialCollateralToken: wnt,
      initialCollateralDeltaAmount: initialWntAmount,
      sizeDeltaUsd: initialPositionSizeInUsd, // 2x position
      acceptablePrice: expandDecimals(5001, 12),
      orderType: OrderType.MarketIncrease,
      isLong: true,
      shouldUnwrapNativeToken: true,
    });

    // The order execution reverts when attempting to pay the execution fee refund after cancellation
    await expect(
      executeOrder(fixture, {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      })
    ).to.be.revertedWithCustomError(tokenUtils, "NativeTokenTransferError");

    expect(await positionStore.getAccountPositionCount(toggleAcceptContract.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0); // My position has still not been opened
    expect(await orderStore.getOrderCount()).eq(1); // My order still exists in the orderStore, waiting to be executed

    // Now the price of Ether doubles to $10,000, and I decide I want my order executed so I can get Ether half off market price
    await toggleAcceptContract.setCanAccept(true);

    // My order is a market order so it must be executed with the prices of the block it was last updated in
    await executeOrder(fixture, {
      tokens: [wnt.address, usdc.address],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
    });

    const positionKey = (await positionStore.getPositionKeys(0, 1))[0];
    const positionInfo = await positionStore.get(positionKey);

    // Now my position is opened and I've received twice as much ether as if I had purchased it at the current market rate of $10,000
    expect(await positionStore.getAccountPositionCount(toggleAcceptContract.address)).eq(1);
    expect(await positionStore.getPositionCount()).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    expect(positionInfo.numbers.sizeInTokens).to.eq(initialPositionSizeInTokens);
    expect(positionInfo.numbers.sizeInUsd).to.eq(initialPositionSizeInUsd);

    const toggleContractWntBalanceBefore = await wnt.balanceOf(toggleAcceptContract.address);
    const toggleContractUsdcBalanceBefore = await usdc.balanceOf(toggleAcceptContract.address);

    // I immediately decrease my position and realize a risk-free 2x
    await handleOrder(fixture, {
      create: {
        account: toggleAcceptContract,
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: initialPositionSizeInUsd, // Close out my position and realize all profits
        acceptablePrice: expandDecimals(9999, 12),
        orderType: OrderType.MarketDecrease,
        isLong: true,
        swapPath: [ethUsdMarket.marketToken],
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(10000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(10000, 4), expandDecimals(1, 6)],
      },
    });

    expect(await positionStore.getAccountPositionCount(toggleAcceptContract.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);

    const toggleContractWntBalanceAfter = await wnt.balanceOf(toggleAcceptContract.address);
    const toggleContractUsdcBalanceAfter = await usdc.balanceOf(toggleAcceptContract.address);

    expect(toggleContractWntBalanceBefore).to.eq(toggleContractWntBalanceAfter);

    // I received my risk-free profit
    // 20 ETH position size -> $100,000 profit + I receive my collateral back (10 ETH, now valued at $100,000)
    expect(toggleContractUsdcBalanceAfter.sub(toggleContractUsdcBalanceBefore)).to.eq(expandDecimals(200 * 1000, 6));
  });

  it("CRITICAL - DPU-1: DecreasePosition increases openInterestInTokens", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    expect(await reader.getOpenInterestInTokens(dataStore.address, ethUsdMarket.marketToken, wnt.address, true)).to.eq(
      0
    );

    const initialWNTAmount = expandDecimals(800, 18); // 4M @ $5,000/ETH

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(4000 * 1000), // 1x position
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
    expect(await reader.getOpenInterestInTokens(dataStore.address, ethUsdMarket.marketToken, wnt.address, true)).to.eq(
      initialWNTAmount
    );

    const wntBalBefore = await wnt.balanceOf(user0.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(4000 * 1000), // Close my position
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

    const wntBalAfter = await wnt.balanceOf(user0.address);

    expect(wntBalAfter.sub(wntBalBefore)).to.eq(initialWNTAmount);

    // My position is closed, there is no more open interest.
    // Yet the openInterestInTokens disagrees, saying that there is in fact twice
    // as much open interest as when I initially opened my position.
    // This leads to all sorts of accounting issues when computing PnL, validating reserves among other things.

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0); // Now my position is closed
    expect(await orderStore.getOrderCount()).eq(0);
    expect(
      await reader.getOpenInterestInTokens(dataStore.address, ethUsdMarket.marketToken, wnt.address, true)
    ).to.be.eq(initialWNTAmount.mul(2));
    expect(await reader.getOpenInterest(dataStore.address, ethUsdMarket.marketToken, wnt.address, true)).to.be.eq(0);

    // I can't withdraw from the pool now, even though there are no open positions
    const withdrawAmount = expandDecimals(5000, 18);

    expect(await getBalanceOf(ethUsdMarket.marketToken, user0.address)).gt(withdrawAmount);

    await createWithdrawal(fixture, {
      market: ethUsdMarket,
      marketTokensLongAmount: withdrawAmount,
      minLongTokenAmount: 0,
    });

    expect(await withdrawalStore.getWithdrawalCount()).to.eq(1);
    const withdrawalKey = (await withdrawalStore.getWithdrawalKeys(0, 1))[0];
    const withdrawal = await withdrawalStore.get(withdrawalKey);

    const oracleBlockNumber = withdrawal.numbers.updatedAtBlock;

    const { provider } = ethers;
    const { signers } = fixture.accounts;
    const { oracleSalt, signerIndexes } = fixture.props;

    const block = await provider.getBlock(oracleBlockNumber.toNumber());
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

    await expect(withdrawalHandler.executeWithdrawal(withdrawalKey, oracleParams)).to.emit(
      eventEmitter,
      "WithdrawalCancelled"
    ); // My withdrawal is cancelled due to insufficient reserves
    expect(await withdrawalStore.getWithdrawalCount()).to.eq(0); // Withdrawal was cancelled
  });

  it("CRITICAL - DPU-2: impact pool accounting perturbed with a large limit decrease", async () => {
    const initialWNTAmount = expandDecimals(100, 18); // 500k @ $5,000/ETH

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(500 * 1000), // 1x position
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

    const impactPoolAmountInitial = await dataStore.getUint(keys.positionImpactPoolAmountKey(ethUsdMarket.marketToken));
    expect(impactPoolAmountInitial).to.eq(0);

    // Make sure there are some funds in the impact pool
    await wnt.mint(ethUsdMarket.marketToken, expandDecimals(50, 18));
    await dataStore.setUint(keys.positionImpactPoolAmountKey(ethUsdMarket.marketToken), expandDecimals(50, 18));

    // set price impact for OI to 0.1% for every $50,000 of token imbalance
    // 0.1% => 0.001
    // 0.001 / 50,000 => 2 * (10 ** -8)
    await dataStore.setUint(keys.positionImpactFactorKey(ethUsdMarket.marketToken, true), decimalToFloat(2, 8));
    await dataStore.setUint(keys.positionImpactFactorKey(ethUsdMarket.marketToken, false), decimalToFloat(2, 8));
    await dataStore.setUint(keys.positionImpactExponentFactorKey(ethUsdMarket.marketToken), decimalToFloat(2, 0));

    const openInterestLong = await reader.getOpenInterestInTokens(
      dataStore.address,
      ethUsdMarket.marketToken,
      wnt.address,
      true
    );
    const openInterestShort = await reader.getOpenInterestInTokens(
      dataStore.address,
      ethUsdMarket.marketToken,
      wnt.address,
      false
    );

    // Notice that even though I'll be balancing the pool by closing this position,
    // I will experience negative impact since the latest price is significantly more
    // than my execution price.
    expect(openInterestLong).to.eq(expandDecimals(100, 18));
    expect(openInterestShort).to.eq(0);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(5000 * 1000), // Attempt to decrease by significantly more than my position
        acceptablePrice: 0,
        orderType: OrderType.LimitDecrease,
        isLong: true,
        triggerPrice: expandDecimals(5000, 12),
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(4900, 4), expandDecimals(1, 6), expandDecimals(5100, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(4900, 4), expandDecimals(1, 6), expandDecimals(5100, 4), expandDecimals(1, 6)],
      },
    });

    const impactPoolAmount = await dataStore.getUint(keys.positionImpactPoolAmountKey(ethUsdMarket.marketToken));
    const poolAmount = await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address);
    const marketBalance = await wnt.balanceOf(ethUsdMarket.marketToken);
    const marketCollateralLong = await reader.getMarketCollateralSum(
      dataStore.address,
      ethUsdMarket.marketToken,
      wnt.address,
      true
    );
    const marketCollateralShort = await reader.getMarketCollateralSum(
      dataStore.address,
      ethUsdMarket.marketToken,
      wnt.address,
      true
    );

    expect(marketCollateralLong).to.eq(0);
    expect(marketCollateralShort).to.eq(0);

    // Now the accounting for the market is significantly off.
    // (over 10 ether is double counted in both the impact pool and the poolAmount)
    // The impact pool has now double counted some funds due to the discrepancy
    // between using the *sizeDeltaUsd* to compute impact amount to be applied to the impact pool
    // and the *actual* impact amount that the user experiences which is derived from the *adjustedSizeDeltaUsd*
    expect(marketBalance.add(expandDecimals(10, 18))).to.be.lt(impactPoolAmount.add(poolAmount));

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(1); // Notice the order sticks around
  });

  it("CRITICAL - DPU-3: Incorrect fee logic leads to loss of funds", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    // Open a large short position to make price impact negative when we decrease our long position
    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(1000, 18),
        sizeDeltaUsd: expandFloatDecimals(10000 * 1000), // 2x position
        acceptablePrice: expandDecimals(5001, 12),
        orderType: OrderType.MarketIncrease,
        isLong: false,
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    const initialWntAmount = expandDecimals(100, 18);
    const initialPositionSizeInUsd = expandFloatDecimals(500 * 1000);
    const initialPositionSizeInTokens = expandDecimals(100, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWntAmount,
        sizeDeltaUsd: initialPositionSizeInUsd, // 1x position
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

    // Set the borrowing fees to $10,000
    const BORROWING_FACTOR = decimalToFloat(1, 6);
    const cumulativeBorrowingFactor = BORROWING_FACTOR.mul(10000);
    const borrowingFeeKey = cumulativeBorrowingFactorKey(ethUsdMarket.marketToken, true);
    await dataStore.setUint(borrowingFeeKey, cumulativeBorrowingFactor);

    const positionBorrowingFactor = positionInfo.numbers.borrowingFactor;
    const diffFactor = cumulativeBorrowingFactor.sub(positionBorrowingFactor);

    const borrowingFees = positionInfo.numbers.sizeInUsd.mul(diffFactor).div(1e10).div(1e10).div(1e10);
    const borrowingFeesInCollateralTokens = borrowingFees.div(expandDecimals(5100, 12));

    const userWntBalBefore = await wnt.balanceOf(user0.address);
    const userUsdcBalBefore = await usdc.balanceOf(user0.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: initialPositionSizeInUsd.div(2),
        acceptablePrice: expandDecimals(4999, 12),
        orderType: OrderType.MarketDecrease,
        isLong: true,
        swapPath: [ethUsdMarket.marketToken],
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5100, 4), expandDecimals(1, 6)], // Experience small profits
        maxPrices: [expandDecimals(5100, 4), expandDecimals(1, 6)],
      },
    });

    positionInfo = await positionStore.get(positionKey);

    const userWntBalAfter = await wnt.balanceOf(user0.address);
    const userUsdcBalAfter = await usdc.balanceOf(user0.address);

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await positionStore.getPositionCount()).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    // Borrowing fees are equivalent to the profit I would have realized
    // $100 profit per ETH on a 10 ETH position => profit = $1,000
    // I close half my position, so I realize $500 of profit
    // $500 / $5100 = # ETH I should have received

    // 500/5100 ~= 0.0980392156862745098 ETH
    expect(borrowingFeesInCollateralTokens).to.eq("980392156862745098");

    // But I received no output and the fees were still taken from my collateral
    expect(userWntBalBefore).to.eq(userWntBalAfter);
    expect(userUsdcBalBefore).to.eq(userUsdcBalAfter);

    // The fees should have negated my outputAmount
    // I should have received no output and had no effect on my collateral
    // Therefore I've lost all the profit I just realized.
    expect(positionInfo.numbers.collateralAmount).to.eq(initialWntAmount.sub(borrowingFeesInCollateralTokens));
  });

  it("CRITICAL - DPU-4: When a position using a collateralToken != backingToken profits, the pool accounting is perturbed", async () => {
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

    // Decrease my position collateral and realize some gains
    await createOrder(fixture, {
      market: ethUsdMarket,
      initialCollateralToken: usdc,
      initialCollateralDeltaAmount: 0,
      sizeDeltaUsd: initialPositionSizeInUsd.div(2),
      acceptablePrice: expandDecimals(5999, 12),
      orderType: OrderType.MarketDecrease,
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
      minPrices: [expandDecimals(6000, 4), expandDecimals(1, 6)],
      maxPrices: [expandDecimals(6000, 4), expandDecimals(1, 6)],
      signers,
      priceFeedTokens: [],
    });

    // My decreaseOrder reverts with a panic code 0x11 because the pnlAmountForPool attempts to subtract
    // a number of wrapped ether from the poolAmount of the collateralToken. But the collateralToken for my position is usdc.
    await expect(orderHandler.executeOrder(orderKey, oracleParams)).to.emit(eventEmitter, "OrderCancelled");

    positionInfo = await positionStore.get(positionKey);
    expect(positionInfo.numbers.collateralAmount).to.eq(initialUSDCAmount);
    expect(positionInfo.numbers.sizeInUsd).to.eq(initialPositionSizeInUsd);
    expect(positionInfo.numbers.sizeInTokens).to.eq(initialPositionSizeInTokens);
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);
  });

  it("CRITICAL - OBU-1: Stop loss is cancelled when it should be executed", async () => {
    // I open a long position for ether @ $5,000
    const initialWNTAmount = expandDecimals(1, 18); // 5k @ $5,000/ETH

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(5 * 1000), // 1x position
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

    // I set my stop loss @ $1,000
    await createOrder(fixture, {
      market: ethUsdMarket,
      initialCollateralToken: wnt,
      initialCollateralDeltaAmount: 0,
      sizeDeltaUsd: expandFloatDecimals(5 * 1000), // Close my position
      acceptablePrice: 0,
      orderType: OrderType.StopLossDecrease,
      isLong: true,
      triggerPrice: expandDecimals(1000, 12),
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(1);

    // The price decreases to $990, but my stop loss is cancelled instead of executed
    await executeOrder(fixture, {
      tokens: [wnt.address, usdc.address],
      minPrices: [expandDecimals(1010, 4), expandDecimals(1, 6), expandDecimals(990, 4), expandDecimals(1, 6)],
      maxPrices: [expandDecimals(1010, 4), expandDecimals(1, 6), expandDecimals(990, 4), expandDecimals(1, 6)],
    });

    // My position is not closed/decreased and my stop loss order has now been frozen
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(1);

    const orderKeys = await orderStore.getOrderKeys(0, 1);
    const order = await orderStore.get(orderKeys[0]);

    expect(order.flags.isFrozen).to.be.true;

    const keys = await positionStore.getPositionKeys(0, 1);
    const position = await positionStore.get(keys[0]);

    expect(position.numbers.sizeInTokens).to.eq(initialWNTAmount);
  });

  it("CRITICAL - SWPU-1: Swap amount to next market excludes price impact", async () => {
    await dataStore.setUint(keys.swapImpactFactorKey(ethUsdMarket.marketToken, true), decimalToFloat(2, 8));
    await dataStore.setUint(keys.swapImpactFactorKey(ethUsdMarket.marketToken, false), decimalToFloat(2, 8));
    await dataStore.setUint(keys.swapImpactExponentFactorKey(ethUsdMarket.marketToken), decimalToFloat(2, 0));

    await wnt.mint(ethUsdMarket.marketToken, expandDecimals(50, 18));
    await dataStore.setUint(
      keys.swapImpactPoolAmountKey(ethUsdMarket.marketToken, wnt.address),
      expandDecimals(50, 18)
    );
    await usdc.mint(ethUsdMarket.marketToken, expandDecimals(10000, 6));
    await dataStore.setUint(
      keys.swapImpactPoolAmountKey(ethUsdMarket.marketToken, usdc.address),
      expandDecimals(10000, 6)
    );

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    let ethUsdBtcMarketPoolWNTBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdIndexBtcMarket.marketToken,
      wnt.address
    );
    let impactPoolWNTBalance = await reader.getSwapImpactPoolAmount(
      dataStore.address,
      ethUsdIndexBtcMarket.marketToken,
      wnt.address
    );
    let ethUsdBtcMarketWNTBalance = await wnt.balanceOf(ethUsdIndexBtcMarket.marketToken);

    // Pool WNT balance is consistent
    expect(ethUsdBtcMarketPoolWNTBalance.add(impactPoolWNTBalance)).to.eq(ethUsdBtcMarketWNTBalance);

    const usdcBalBefore = await usdc.balanceOf(user0.address);
    await handleOrder(fixture, {
      create: {
        account: user0,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: expandDecimals(10000, 6),
        acceptablePrice: 0,
        orderType: OrderType.MarketSwap,
        swapPath: [ethUsdMarket.marketToken, ethUsdIndexBtcMarket.marketToken], // usdc -> wnt, wnt-> usdc
        receiver: user0,
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        maxPrices: [expandDecimals(1000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      },
    });
    const usdcBalAfter = await usdc.balanceOf(user0.address);

    ethUsdBtcMarketPoolWNTBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdIndexBtcMarket.marketToken,
      wnt.address
    );
    impactPoolWNTBalance = await reader.getSwapImpactPoolAmount(
      dataStore.address,
      ethUsdIndexBtcMarket.marketToken,
      wnt.address
    );
    ethUsdBtcMarketWNTBalance = await wnt.balanceOf(ethUsdIndexBtcMarket.marketToken);

    // Pool is no longer consistent
    expect(ethUsdBtcMarketPoolWNTBalance.add(impactPoolWNTBalance)).to.be.not.equal(ethUsdBtcMarketWNTBalance);
    // User receives 10,000 USDC + price impact
    expect(usdcBalAfter.sub(usdcBalBefore)).to.be.gt(expandDecimals(10000, 6));
  });

  it("CRITICAL - DOU-1: Can transfer from an arbitrary market with a swapPath on a decreaseOrder", async () => {
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

    const ethUsdMarketWntBefore = await wnt.balanceOf(ethUsdMarket.marketToken);
    const ethUsdMarketUsdcBefore = await usdc.balanceOf(ethUsdMarket.marketToken);
    const ethUsdIndexWbtcMarketWntBefore = await wnt.balanceOf(ethUsdIndexBtcMarket.marketToken);
    const ethUsdIndexWbtcMarketUsdcBefore = await usdc.balanceOf(ethUsdIndexBtcMarket.marketToken);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: initialPositionSizeInUsd.div(2), // Decrease my position by half
        acceptablePrice: expandDecimals(4999, 12),
        orderType: OrderType.MarketDecrease,
        swapPath: [ethUsdIndexBtcMarket.marketToken, btcUsdMarket.marketToken],
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

    const ethUsdMarketWntAfter = await wnt.balanceOf(ethUsdMarket.marketToken);
    const ethUsdMarketUsdcAfter = await usdc.balanceOf(ethUsdMarket.marketToken);
    const ethUsdIndexWbtcMarketWntAfter = await wnt.balanceOf(ethUsdIndexBtcMarket.marketToken);
    const ethUsdIndexWbtcMarketUsdcAfter = await usdc.balanceOf(ethUsdIndexBtcMarket.marketToken);

    expect(userUsdcAfter.sub(userUsdcBefore)).to.eq(0);
    expect(userWntAfter.sub(userWntBefore)).to.eq(0);
    expect(userWbtcAfter.sub(userWbtcBefore)).to.eq(expandDecimals(25, 7)); // 2.5 WBTC received

    // The tokens for the profit the user just realized are still in the ethUsdMarket
    // Funds have been errantly taken from the ethUsdIndexWbtcMarket perturbing its accounting system

    expect(ethUsdMarketUsdcAfter).to.eq(ethUsdMarketUsdcBefore); // My profits never move from the ethUsdMarket
    expect(ethUsdMarketWntAfter).to.eq(ethUsdMarketWntBefore);
    expect(ethUsdIndexWbtcMarketWntAfter).to.eq(ethUsdIndexWbtcMarketWntBefore);
    expect(ethUsdIndexWbtcMarketUsdcBefore.sub(ethUsdIndexWbtcMarketUsdcAfter)).to.eq(expandDecimals(50 * 1000, 6)); // ethUsdIndexWbtcMarket funds my profits

    positionInfo = await positionStore.get(positionKey);

    expect(positionInfo.numbers.collateralAmount).to.eq(initialWntAmount);
    expect(positionInfo.numbers.sizeInUsd).to.eq(initialPositionSizeInUsd.div(2));
    expect(positionInfo.numbers.sizeInTokens).to.eq(initialPositionSizeInTokens.div(2));
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    const ethUsdMarketPoolAmountUsdc = await reader.getPoolAmount(
      dataStore.address,
      ethUsdMarket.marketToken,
      usdc.address
    );
    const ethUsdIndexBtcMarketPoolAmountUsdc = await reader.getPoolAmount(
      dataStore.address,
      ethUsdIndexBtcMarket.marketToken,
      usdc.address
    );

    // The ethUsdIndexBtcMarket loses backing even though I profited from the ethUsdMarket
    expect(ethUsdMarketPoolAmountUsdc).to.eq(ethUsdMarketUsdcAmount);
    expect(ethUsdIndexBtcMarketPoolAmountUsdc).to.eq(ethUsdIndexBtcMarketUsdcAmount.sub(expandDecimals(50 * 1000, 6)));
  });

  it.skip("CRITICAL - GLOBAL-2: Funding fees are never incremented when the side should be paid", async () => {
    // Note that this test was performed on the funding fees per size
    // being calculated accurately.

    //  cache.fps.longCollateralFundingPerSizeForShorts +(-)= cache.fps.fundingAmountPerSizeForLongCollateralForShorts.toInt256();

    const FUNDING_FACTOR = decimalToFloat(2, 8);
    await dataStore.setUint(keys.fundingFactorKey(ethUsdMarket.marketToken), FUNDING_FACTOR);
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWNTAmount = expandDecimals(10, 18);
    const initialUSDCAmount = expandDecimals(50000, 6);
    const wntBalBefore = await wnt.balanceOf(user2.address);

    // Get long OI on the board
    await handleOrder(fixture, {
      create: {
        account: user0,
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(50 * 1000), // 1x long position
        orderType: OrderType.MarketIncrease,
        acceptablePrice: expandDecimals(5000, 12),
        isLong: true,
        swapPath: [],
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    // Much larger short position
    await handleOrder(fixture, {
      create: {
        account: user1,
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(500 * 1000), // 10x short position
        orderType: OrderType.MarketIncrease,
        acceptablePrice: expandDecimals(5000, 12),
        isLong: false,
        swapPath: [],
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    expect(await positionStore.getAccountPositionCount(user1.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await network.provider.send("evm_increaseTime", [28800 * 3]); // 8 hours pass
    await network.provider.send("evm_mine");

    // After this order executes, there will be $150,000 OI for longs and $500,000 for shorts
    await handleOrder(fixture, {
      create: {
        account: user2,
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(100 * 1000), // 2x long position
        orderType: OrderType.MarketIncrease,
        acceptablePrice: expandDecimals(5000, 12),
        isLong: true,
        swapPath: [],
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    expect(await positionStore.getAccountPositionCount(user2.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await network.provider.send("evm_increaseTime", [28800 * 3]); // 8 hours pass
    await network.provider.send("evm_mine");

    // Proving that short open interest > long open interest
    const longWntOI = await reader.getOpenInterest(dataStore.address, ethUsdMarket.marketToken, wnt.address, true);
    const longUsdcOI = await reader.getOpenInterest(dataStore.address, ethUsdMarket.marketToken, usdc.address, true);
    const shortWntOI = await reader.getOpenInterest(dataStore.address, ethUsdMarket.marketToken, wnt.address, false);
    expect(longWntOI.add(longUsdcOI)).to.be.lessThan(shortWntOI);
    expect(longUsdcOI.add(longWntOI)).to.eq(expandFloatDecimals(150000));
    expect(shortWntOI).to.eq(expandFloatDecimals(500000));

    // User2 should have his funding fees incremented because shorts are paying longs
    await handleOrder(fixture, {
      create: {
        account: user2,
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(100 * 1000), // Close user2's long position
        orderType: OrderType.MarketDecrease,
        acceptablePrice: expandDecimals(5000, 12),
        isLong: true,
        swapPath: [],
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });
    let wntBalAfter = await wnt.balanceOf(user2.address);

    expect(await positionStore.getAccountPositionCount(user2.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
    expect(wntBalAfter.sub(wntBalBefore)).to.eq(initialWNTAmount);

    // Only WNT collateral trades were performed
    const wntClaimableFundingFee = await dataStore.getUint(
      keys.claimableFundingAmountKey(ethUsdMarket.marketToken, wnt.address, user2.address)
    );
    expect(wntClaimableFundingFee).to.eq(0);

    await exchangeRouter.connect(user2).claimFundingFees([ethUsdMarket.marketToken], [wnt.address], user2.address);
    wntBalAfter = await wnt.balanceOf(user2.address);

    // No ETH was claimed because the funding fee for longs is negative (-124065846153 exactly)
    // and funding fees are only incremented when positive which is against the fee standard
    // of positive when you pay, negative when you get paid
    expect(wntBalAfter).to.eq(initialWNTAmount);
  });

  it("CRITICAL - MKTU-1: Short position long collateral cannot be liquidated", async () => {
    expect(await positionStore.getAccountPositionCount(user1.address)).eq(0);

    const initialWNTAmount = expandDecimals(10, 18);

    await handleOrder(fixture, {
      create: {
        account: user1,
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(80 * 1000),
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

    expect(await positionStore.getAccountPositionCount(user1.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await mine();

    // Notice that the liquidation is invalid until the pnl causes the openInterestWithPnL calculation to underflow
    await expect(
      executeLiquidation(fixture, {
        account: user1.address,
        market: ethUsdMarket,
        collateralToken: wnt,
        isLong: false,
        minPrices: [expandDecimals(7500, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(7500, 4), expandDecimals(1, 6)],
        gasUsageLabel: "orderHandler.executeLiquidation",
      })
    ).to.be.revertedWith("DecreasePositionUtils: Invalid Liquidation");

    await expect(
      executeLiquidation(fixture, {
        account: user1.address,
        market: ethUsdMarket,
        collateralToken: wnt,
        isLong: false,
        minPrices: [expandDecimals(9000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(9000, 4), expandDecimals(1, 6)],
        gasUsageLabel: "orderHandler.executeLiquidation",
      })
    ).to.be.revertedWith("DecreasePositionUtils: Invalid Liquidation");

    await expect(
      executeLiquidation(fixture, {
        account: user1.address,
        market: ethUsdMarket,
        collateralToken: wnt,
        isLong: false,
        minPrices: [expandDecimals(12000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(12000, 4), expandDecimals(1, 6)],
        gasUsageLabel: "orderHandler.executeLiquidation",
      })
    ).to.be.revertedWith("DecreasePositionUtils: Invalid Liquidation");

    await expect(
      executeLiquidation(fixture, {
        account: user1.address,
        market: ethUsdMarket,
        collateralToken: wnt,
        isLong: false,
        minPrices: [expandDecimals(13000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(13000, 4), expandDecimals(1, 6)],
        gasUsageLabel: "orderHandler.executeLiquidation",
      })
    ).to.be.revertedWith("DecreasePositionUtils: Invalid Liquidation");

    // Once the PnL becomes greater in magnitude than the Open Interest,
    // The liquidation cannot be executed.
    // E.g. this position can never be liquidated.

    await expect(
      executeLiquidation(fixture, {
        account: user1.address,
        market: ethUsdMarket,
        collateralToken: wnt,
        isLong: false,
        minPrices: [expandDecimals(13201, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(13201, 4), expandDecimals(1, 6)],
        gasUsageLabel: "orderHandler.executeLiquidation",
      })
    ).to.be.revertedWithPanic();

    await expect(
      executeLiquidation(fixture, {
        account: user1.address,
        market: ethUsdMarket,
        collateralToken: wnt,
        isLong: false,
        minPrices: [expandDecimals(14000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(14000, 4), expandDecimals(1, 6)],
        gasUsageLabel: "orderHandler.executeLiquidation",
      })
    ).to.be.revertedWithPanic();

    await expect(
      executeLiquidation(fixture, {
        account: user1.address,
        market: ethUsdMarket,
        collateralToken: wnt,
        isLong: false,
        minPrices: [expandDecimals(16000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(16000, 4), expandDecimals(1, 6)],
        gasUsageLabel: "orderHandler.executeLiquidation",
      })
    ).to.be.revertedWithPanic();
  });

  it("CRITICAL - IOU-1: Transfers wrong token to market -- market becomes unbacked", async () => {
    expect(await orderStore.getOrderCount()).eq(0);

    const params = {
      market: ethUsdMarket,
      initialCollateralToken: wbtc,
      initialCollateralDeltaAmount: expandDecimals(10, 8),
      swapPath: [btcUsdMarket.marketToken, ethUsdMarket.marketToken],
      sizeDeltaUsd: expandFloatDecimals(200 * 1000),
      executionFee: expandDecimals(1, 15),
      minOutputAmount: expandDecimals(0, 6),
      orderType: OrderType.MarketIncrease,
      isLong: true,
      shouldUnwrapNativeToken: false,
      triggerPrice: expandDecimals(5000, 12),
      acceptablePrice: expandDecimals(5000, 12),
    };

    await createOrder(fixture, params);

    expect(await orderStore.getOrderCount()).eq(1);
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);

    expect(await wbtc.balanceOf(ethUsdMarket.marketToken)).to.be.eq(0);
    expect(await wbtc.balanceOf(btcUsdMarket.marketToken)).to.eq(
      await reader.getPoolAmount(dataStore.address, btcUsdMarket.marketToken, wbtc.address)
    );

    const prices = [expandDecimals(10000, 2), expandDecimals(5000, 4), expandDecimals(1, 6)];

    await executeOrder(fixture, {
      gasUsageLabel: "executeOrder",
      tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      precisions: [20, 8, 18],
      minPrices: prices,
      maxPrices: prices,
      tokens: [wbtc.address, wnt.address, usdc.address],
    });

    expect(await orderStore.getOrderCount()).eq(0);
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await positionStore.getPositionCount()).eq(1);
    const keys = await positionStore.getPositionKeys(0, 1);
    const position = await positionStore.get(keys[0]);

    const wbtcBalanceInEthMarket = await wbtc.balanceOf(ethUsdMarket.marketToken);
    const wbtcBalanceInBtcMarket = await wbtc.balanceOf(btcUsdMarket.marketToken);

    // There is WBTC in the ETH market
    expect(wbtcBalanceInEthMarket).to.be.gt(0);
    expect(position.addresses.collateralToken).to.be.eq(wnt.address);

    // The BTC balance in the BTCUSD market is less than how much BTC the market thinks there is
    expect(await wbtc.balanceOf(btcUsdMarket.marketToken)).to.be.lt(
      await reader.getPoolAmount(dataStore.address, btcUsdMarket.marketToken, wbtc.address)
    );
    expect(wbtcBalanceInBtcMarket.add(wbtcBalanceInEthMarket)).to.be.eq(
      await reader.getPoolAmount(dataStore.address, btcUsdMarket.marketToken, wbtc.address)
    );
    expect(position.addresses.collateralToken).to.be.eq(wnt.address);
  });

  it.skip("CRITICAL - DPU-5: Swapping collateral token to PnL token results in incorrect token amount received", async () => {
    // Post-swap different tokens are added together.

    // Note that because the current swap command logic is broken, this PoC showcases
    // a critical vulnerability that results if that logic is assumed correct
    // aka you are actually able to swap collateral token to pnl token

    // To get it to run, you can simply replace swapPath[0] = params.swapPathMarkets[0];
    // with swapPath[0] = params.swapPathMarkets[index of initialized market in swap path];

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialUSDCAmount = expandDecimals(50 * 1000, 6);
    const SWAP_COLLATERAL_TOKEN_TO_PNL_TOKEN = "0x0000000000000000000000000000000000000003";

    const usdcBalanceBefore = await usdc.balanceOf(user0.address);

    await handleOrder(fixture, {
      create: {
        account: user0,
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: initialUSDCAmount,
        sizeDeltaUsd: expandFloatDecimals(100 * 1000),
        orderType: OrderType.MarketIncrease,
        acceptablePrice: expandDecimals(5000, 12),
        isLong: true,
        swapPath: [],
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    // PoC showcases a lot of USDC being taken out, so ensure there is enough liquidity.
    // Note that this scenario is more likely with tokens that are closer in precision.
    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        longTokenAmount: ethUsdMarketWntAmount,
        shortTokenAmount: expandDecimals(20000000000000, 6),
      },
    });

    await handleOrder(fixture, {
      create: {
        account: user0,
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: initialUSDCAmount,
        sizeDeltaUsd: expandFloatDecimals(100 * 1000),
        orderType: OrderType.MarketDecrease,
        acceptablePrice: expandDecimals(200000, 2),
        isLong: true,
        // using swapPath[0] = params.swapPathMarkets[1];
        // Note that I am supplying a different market than the one the order pertains to perform the swap
        // as a market can't transfer tokens to itself
        swapPath: [SWAP_COLLATERAL_TOKEN_TO_PNL_TOKEN, ethUsdIndexBtcMarket.marketToken],
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)], // no profit
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(20000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      },
    });

    const usdcBalanceAfter = await usdc.balanceOf(user0.address);

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
    // You end up getting your initial collateral in addition to the ETH equivalent amount ($50,000 / $5,000) but represented as USDC
    expect(usdcBalanceAfter.sub(usdcBalanceBefore)).to.eq(initialUSDCAmount.add(expandDecimals(10, 18)));
  });

  it.skip("CRITICAL - MKTU-3: First traders are immune to funding fees", async () => {
    // Note that this test was performed on the funding fees per size
    // being calculated accurately and the fees are being incremented on the correct side.

    // fees.funding.longTokenFundingFeeAmount < 0 and fees.funding.shortTokenFundingFeeAmount < 0
    // cache.fps.longCollateralFundingPerSizeForShorts +(-)= cache.fps.fundingAmountPerSizeForLongCollateralForShorts.toInt256();

    // User0 long, User1 short, User2 long
    // Shorts should pay longs
    // Test shows that User0 does not receive any funding fees
    const FUNDING_FACTOR = decimalToFloat(2, 8);
    await dataStore.setUint(keys.fundingFactorKey(ethUsdMarket.marketToken), FUNDING_FACTOR);
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWNTAmount = expandDecimals(10, 18);
    const initialUSDCAmount = expandDecimals(50000, 6);
    const wntBalBefore = await wnt.balanceOf(user0.address);

    // Get long OI on the board
    await handleOrder(fixture, {
      create: {
        account: user0,
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(50 * 1000), // 1x long position
        orderType: OrderType.MarketIncrease,
        acceptablePrice: expandDecimals(5000, 12),
        isLong: true,
        swapPath: [],
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    // Much larger short position
    await handleOrder(fixture, {
      create: {
        account: user1,
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(500 * 1000), // 10x short position
        orderType: OrderType.MarketIncrease,
        acceptablePrice: expandDecimals(5000, 12),
        isLong: false,
        swapPath: [],
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    expect(await positionStore.getAccountPositionCount(user1.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await network.provider.send("evm_increaseTime", [28800 * 3]); // 8 hours pass
    await network.provider.send("evm_mine");

    // After this order executes, there will be $150,000 OI for longs and $500,000 for shorts
    // so shorts should be paying longs
    await handleOrder(fixture, {
      create: {
        account: user2,
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(100 * 1000), // 2x long position
        orderType: OrderType.MarketIncrease,
        acceptablePrice: expandDecimals(5000, 12),
        isLong: true,
        swapPath: [],
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    expect(await positionStore.getAccountPositionCount(user2.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await network.provider.send("evm_increaseTime", [28800 * 3]); // 8 hours pass
    await network.provider.send("evm_mine");

    // Proving that short open interest > long open interest
    const longWntOI = await reader.getOpenInterest(dataStore.address, ethUsdMarket.marketToken, wnt.address, true);
    const longUsdcOI = await reader.getOpenInterest(dataStore.address, ethUsdMarket.marketToken, usdc.address, true);
    const shortWntOI = await reader.getOpenInterest(dataStore.address, ethUsdMarket.marketToken, wnt.address, false);
    expect(longWntOI.add(longUsdcOI)).to.be.lessThan(shortWntOI);
    expect(longUsdcOI.add(longWntOI)).to.eq(expandFloatDecimals(150000));
    expect(shortWntOI).to.eq(expandFloatDecimals(500000));

    const positionKey = (await positionStore.getPositionKeys(0, 1))[0];
    const positionInfo = await positionStore.get(positionKey);
    expect(positionInfo.numbers.shortTokenFundingAmountPerSize).to.eq(0);
    expect(positionInfo.numbers.longTokenFundingAmountPerSize).to.eq(0);

    // Close first long trader's position
    await handleOrder(fixture, {
      create: {
        account: user0,
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(50 * 1000), // Close user0's long position
        orderType: OrderType.MarketDecrease,
        acceptablePrice: expandDecimals(5000, 12),
        isLong: true,
        swapPath: [],
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });
    let wntBalAfter = await wnt.balanceOf(user0.address);

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);

    expect(wntBalAfter.sub(wntBalBefore)).to.eq(initialWNTAmount);

    // Only WNT collateral trades were performed
    const wntClaimableFundingFee = await dataStore.getUint(
      keys.claimableFundingAmountKey(ethUsdMarket.marketToken, wnt.address, user0.address)
    );
    expect(wntClaimableFundingFee).to.eq(0);
    await exchangeRouter.connect(user0).claimFundingFees([ethUsdMarket.marketToken], [wnt.address], user0.address);
    wntBalAfter = await wnt.balanceOf(user0.address);

    // No ETH was claimed because the funding fee was 0
    expect(wntBalAfter).to.eq(initialWNTAmount);
  });

  it.skip("CRITICAL - MKTU-3 (alternate): Funding fees aren't paid by other side", async () => {
    // Note that this test was performed on the funding fees per size
    // being calculated accurately and the fees are being incremented on the correct side.

    // fees.funding.longTokenFundingFeeAmount < 0 and fees.funding.shortTokenFundingFeeAmount < 0
    // cache.fps.longCollateralFundingPerSizeForShorts +(-)= cache.fps.fundingAmountPerSizeForLongCollateralForShorts.toInt256();

    // User0 long collateral ETH, User1 short collateral ETH, User2 short collateral USDC, User3 long collateral USDC
    // Shorts should pay longs
    // Test shows that User3 received funding fees but they didn't come from the pockets of traders on other side

    const FUNDING_FACTOR = decimalToFloat(2, 0);
    await dataStore.setUint(keys.fundingFactorKey(ethUsdMarket.marketToken), FUNDING_FACTOR);
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWNTAmount = expandDecimals(10, 18);
    const initialUSDCAmount = expandDecimals(50000, 6);
    const wntBalBefore = await wnt.balanceOf(user0.address);

    // **************** CREATE LONG COLLATERAL POSITIONS *********************

    // User0 creates long position with long collateral
    await handleOrder(fixture, {
      create: {
        account: user0,
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(50 * 1000),
        orderType: OrderType.MarketIncrease,
        acceptablePrice: expandDecimals(5000, 12),
        isLong: true,
        swapPath: [],
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    // User1 creates short position with long collateral
    await handleOrder(fixture, {
      create: {
        account: user1,
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(500 * 1000),
        orderType: OrderType.MarketIncrease,
        acceptablePrice: expandDecimals(5000, 12),
        isLong: false,
        swapPath: [],
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    expect(await positionStore.getAccountPositionCount(user1.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    // **************************************************************************

    // **************** CREATE SHORT COLLATERAL POSITIONS *********************

    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        longTokenAmount: ethUsdMarketWntAmount,
        shortTokenAmount: ethUsdMarketUsdcAmount,
      },
    });

    // User2 creates short position with short collateral
    await handleOrder(fixture, {
      create: {
        account: user2,
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: initialUSDCAmount,
        sizeDeltaUsd: expandFloatDecimals(100 * 1000),
        orderType: OrderType.MarketIncrease,
        acceptablePrice: expandDecimals(5000, 12),
        isLong: false,
        swapPath: [],
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    expect(await positionStore.getAccountPositionCount(user2.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    // User3 creates long position with short collateral
    await handleOrder(fixture, {
      create: {
        account: user3,
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: initialUSDCAmount,
        sizeDeltaUsd: expandFloatDecimals(50 * 1000),
        orderType: OrderType.MarketIncrease,
        acceptablePrice: expandDecimals(5000, 12),
        isLong: true,
        swapPath: [],
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    expect(await positionStore.getAccountPositionCount(user3.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    // ***********************************************************************

    const positionKeys = await positionStore.getPositionKeys(0, 4);
    const user0positionInfo = await positionStore.get(positionKeys[0]);
    expect(user0positionInfo.numbers.shortTokenFundingAmountPerSize).to.eq(0);
    expect(user0positionInfo.numbers.longTokenFundingAmountPerSize).to.eq(0);
    const user1positionInfo = await positionStore.get(positionKeys[1]);
    expect(user1positionInfo.numbers.shortTokenFundingAmountPerSize).to.eq(0);
    expect(user1positionInfo.numbers.longTokenFundingAmountPerSize).to.eq(0);
    const user2positionInfo = await positionStore.get(positionKeys[2]);
    expect(user2positionInfo.numbers.shortTokenFundingAmountPerSize).to.eq(0);
    expect(user2positionInfo.numbers.longTokenFundingAmountPerSize).to.not.eq(0);
    const user3positionInfo = await positionStore.get(positionKeys[3]);
    expect(user3positionInfo.numbers.shortTokenFundingAmountPerSize).to.not.eq(0);
    expect(user3positionInfo.numbers.longTokenFundingAmountPerSize).to.not.eq(0);

    // *************************************************************************

    // User3 closes their position
    await handleOrder(fixture, {
      create: {
        account: user3,
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: initialUSDCAmount,
        sizeDeltaUsd: expandFloatDecimals(50 * 1000),
        orderType: OrderType.MarketDecrease,
        acceptablePrice: expandDecimals(5000, 12),
        isLong: true,
        swapPath: [],
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    // Claim funding fees (both long and short token)
    await exchangeRouter.connect(user3).claimFundingFees([ethUsdMarket.marketToken], [wnt.address], user3.address);
    await exchangeRouter.connect(user3).claimFundingFees([ethUsdMarket.marketToken], [usdc.address], user3.address);

    let user3WNTBal = await wnt.balanceOf(user3.address);
    let user3USDCBal = await usdc.balanceOf(user3.address);

    expect(user3WNTBal).to.be.gt(0);
    expect(user3USDCBal).to.be.gt(initialUSDCAmount);

    let usdcFundingFeeGained = user3USDCBal.sub(initialUSDCAmount);
    let wntFundingFeeGained = user3WNTBal;

    // Now User2 (short trader with short token) will close their position
    // Should expect to see that they paid for User3's short token funding fees
    await handleOrder(fixture, {
      create: {
        account: user2,
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: initialUSDCAmount,
        sizeDeltaUsd: expandFloatDecimals(100 * 1000),
        orderType: OrderType.MarketDecrease,
        acceptablePrice: expandDecimals(5000, 12),
        isLong: false,
        swapPath: [],
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    expect(await positionStore.getAccountPositionCount(user2.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);

    let user2WNTBal = await wnt.balanceOf(user2.address);
    let user2USDCBal = await usdc.balanceOf(user2.address);

    expect(user2WNTBal).to.be.eq(0);
    // User2 did not pay any USDC to User3!
    // When User2 created their position, there was no prior short open interest with short collateral.
    // As a result, the short token funding amount per size is 0 on User2's position
    // and the short token funding fee is 0. Then when it is time to pay the funding fee,
    // no collateral is detracted.
    expect(user2USDCBal).to.be.eq(initialUSDCAmount);

    // Close User1's short position with long collateral
    await handleOrder(fixture, {
      create: {
        account: user1,
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(500 * 1000),
        orderType: OrderType.MarketDecrease,
        acceptablePrice: expandDecimals(5000, 12),
        isLong: false,
        swapPath: [],
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    expect(await positionStore.getAccountPositionCount(user1.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);

    let user1WNTBal = await wnt.balanceOf(user1.address);
    let user1USDCBal = await usdc.balanceOf(user1.address);

    // User1 did not pay any WNT to User3!
    expect(user1WNTBal).to.be.eq(initialWNTAmount);
    expect(user1USDCBal).to.be.eq(0);
  });

  /* --------------------------------- HIGH --------------------------------- */

  it("HIGH - DOU-2: Decrease orders that are not fully filled yield an opportunity for a gas attack", async () => {
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
    const positionInfo = await positionStore.get(positionKey);

    expect(positionInfo.numbers.collateralAmount).to.eq(initialUSDCAmount);
    expect(positionInfo.numbers.sizeInUsd).to.eq(initialPositionSizeInUsd);
    expect(positionInfo.numbers.sizeInTokens).to.eq(initialPositionSizeInTokens);
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: initialUSDCAmount,
        sizeDeltaUsd: initialPositionSizeInUsd.add(expandFloatDecimals(1000)), // Decrease my position by $1,000 more than it's size
        acceptablePrice: expandDecimals(5000, 12),
        triggerPrice: expandDecimals(5000, 12),
        orderType: OrderType.LimitDecrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(4990, 4), expandDecimals(1, 6), expandDecimals(5010, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(4990, 4), expandDecimals(1, 6), expandDecimals(5010, 4), expandDecimals(1, 6)],
      },
    });

    // My position has been closed
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);
    expect(await orderStore.getOrderCount()).eq(1);

    let orderKey = (await orderStore.getOrderKeys(0, 1))[0];
    let orderInfo = await orderStore.get(orderKey);

    // The executionFee for my order has been set to 0, therefore I can continue to open small positions and have
    // them decreased by this order in perpetuity while wasting the keepers gas every time it executes my decrease order
    expect(orderInfo.numbers.executionFee).to.eq(0);

    const smallPositionInitialSize = expandFloatDecimals(100);
    const smallPositionInitialUsdcAmount = expandDecimals(50, 6);

    // I do this N times and expend the keepers gas
    for (let i = 0; i < 5; i++) {
      await createOrder(fixture, {
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: smallPositionInitialUsdcAmount,
        sizeDeltaUsd: smallPositionInitialSize,
        acceptablePrice: expandDecimals(5001, 12),
        orderType: OrderType.MarketIncrease,
        isLong: true,
      });

      orderKey = (await orderStore.getOrderKeys(1, 2))[0];
      orderInfo = await orderStore.get(orderKey);

      expect(orderInfo.flags.orderType).to.eq(OrderType.MarketIncrease);

      await executeOrder(fixture, {
        key: orderKey,
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      });

      expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
      expect(await positionStore.getPositionCount()).eq(1);
      expect(await orderStore.getOrderCount()).eq(1); // My decrease order is still present

      orderKey = (await orderStore.getOrderKeys(0, 1))[0];
      orderInfo = await orderStore.get(orderKey);

      expect(orderInfo.flags.orderType).to.eq(OrderType.LimitDecrease);

      // I've not sent any additional execution fee and the execution fee remains at 0,
      // Therefore the keeper expends gas and does not receive any compensation.
      expect(orderInfo.numbers.executionFee).to.eq(0);

      await executeOrder(fixture, {
        key: orderKey,
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(4990, 4), expandDecimals(1, 6), expandDecimals(5010, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(4990, 4), expandDecimals(1, 6), expandDecimals(5010, 4), expandDecimals(1, 6)],
      });
    }
  });

  it("HIGH - DOU-3 Decrease orders that are not fully filled are not handled properly", async () => {
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
    const positionInfo = await positionStore.get(positionKey);

    expect(positionInfo.numbers.collateralAmount).to.eq(initialUSDCAmount);
    expect(positionInfo.numbers.sizeInUsd).to.eq(initialPositionSizeInUsd);
    expect(positionInfo.numbers.sizeInTokens).to.eq(initialPositionSizeInTokens);
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: initialUSDCAmount,
        sizeDeltaUsd: initialPositionSizeInUsd.add(expandFloatDecimals(1000)), // Decrease my position by $1,000 more than it's size
        acceptablePrice: expandDecimals(5000, 12),
        triggerPrice: expandDecimals(5000, 12),
        orderType: OrderType.LimitDecrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(4990, 4), expandDecimals(1, 6), expandDecimals(5010, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(4990, 4), expandDecimals(1, 6), expandDecimals(5010, 4), expandDecimals(1, 6)],
      },
    });

    const orderKey = (await orderStore.getOrderKeys(0, 1))[0];
    const orderInfo = await orderStore.get(orderKey);

    // My order still exists in the store, but it is for the size of my position I just decreased
    expect(orderInfo.numbers.sizeDeltaUsd).to.eq(initialPositionSizeInUsd);

    // My position has been closed
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);
    expect(await orderStore.getOrderCount()).eq(1);
  });

  it("HIGH - ORDH-2: execute order feature is blocked, there is an infinite loop of frozen order executions", async () => {
    const limitIncreaseOrderFeatureKey = executeOrderFeatureKey(orderHandler.address, OrderType.LimitIncrease);

    await dataStore.setBool(limitIncreaseOrderFeatureKey, true);

    const initialUSDCAmount = expandDecimals(50000, 6);
    const initialPositionSizeInUsd = expandFloatDecimals(100 * 1000);

    await createOrder(fixture, {
      market: ethUsdMarket,
      initialCollateralToken: usdc,
      initialCollateralDeltaAmount: initialUSDCAmount,
      sizeDeltaUsd: initialPositionSizeInUsd, // 2x position
      acceptablePrice: expandDecimals(5001, 12),
      orderType: OrderType.LimitIncrease,
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

    await expect(orderHandler.executeOrder(orderKey, oracleParams)).to.emit(eventEmitter, "OrderFrozen");

    // I may keep executing this order as I have frozenOrderKeeper privileges and it will continue to revert
    // and be frozen since the feature is not activated. An automated frozen keeper may get stuck this way
    // and end up burning a significant amount of gas.
    await expect(orderHandler.executeOrder(orderKey, oracleParams)).to.emit(eventEmitter, "OrderFrozen");
    await expect(orderHandler.executeOrder(orderKey, oracleParams)).to.emit(eventEmitter, "OrderFrozen");
    await expect(orderHandler.executeOrder(orderKey, oracleParams)).to.emit(eventEmitter, "OrderFrozen");
  });

  it("HIGH - OBU-2: Cannot increase collateral without increasing the size of my position", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialUSDCAmount = expandDecimals(50000, 6);
    const initialPositionSizeInUsd = expandFloatDecimals(100 * 1000);
    const initialPositionSizeInTokens = expandDecimals(20, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: initialUSDCAmount,
        sizeDeltaUsd: expandFloatDecimals(100 * 1000), // 2x position
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

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await createOrder(fixture, {
      market: ethUsdMarket,
      initialCollateralToken: usdc,
      initialCollateralDeltaAmount: initialUSDCAmount, // Position collateral is now 100,000 USDC
      sizeDeltaUsd: 0, // 0 sizeDeltaUsd will revert
      acceptablePrice: expandDecimals(6001, 12),
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

    positionInfo = await positionStore.get(positionKey);

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    expect(positionInfo.numbers.collateralAmount).to.eq(initialUSDCAmount);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: initialUSDCAmount,
        sizeDeltaUsd: expandFloatDecimals(5 * 1000), // I must increase the size of my posiiton
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

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    expect(positionInfo.numbers.collateralAmount).to.eq(initialUSDCAmount.mul(2));
  });

  it("HIGH - ORDU-3: Cannot decrease collateral without closing the entire position", async () => {
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

    // Decrease my position collateral and realize some gains
    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWntAmount.div(2), // Position collateral should now be 5 ETH, but it isn't applied due to a bug
        sizeDeltaUsd: initialPositionSizeInUsd.div(2),
        acceptablePrice: expandDecimals(5999, 12),
        orderType: OrderType.MarketDecrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(6000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(6000, 4), expandDecimals(1, 6)],
      },
    });

    positionInfo = await positionStore.get(positionKey);
    expect(positionInfo.numbers.collateralAmount).to.eq(initialWntAmount); // Notice the collateral amount has not changed
    expect(positionInfo.numbers.sizeInUsd).to.eq(initialPositionSizeInUsd.div(2));
    expect(positionInfo.numbers.sizeInTokens).to.eq(initialPositionSizeInTokens.div(2));
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);
  });
});
