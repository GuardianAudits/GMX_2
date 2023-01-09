import { expect } from "chai";

import { deployFixture } from "../../utils/fixture";
import { expandDecimals, expandFloatDecimals, bigNumberify } from "../../utils/math";
import { handleDeposit } from "../../utils/deposit";
import { OrderType, handleOrder, executeLiquidation } from "../../utils/order";
import { TOKEN_ORACLE_TYPES } from "../../utils/oracle";
import { mine } from "@nomicfoundation/hardhat-network-helpers";

describe("Guardian.Liquidation", () => {
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
    reader,
    dataStore;
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
      reader,
      dataStore,
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

  it("Long position long collateral gets liquidated", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialWNTAmount = expandDecimals(10, 18);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
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

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await mine();

    const poolBalBefore = await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address);

    await executeLiquidation(fixture, {
      account: user0.address,
      market: ethUsdMarket,
      collateralToken: wnt,
      isLong: true,
      minPrices: [expandDecimals(2550, 4), expandDecimals(1, 6)],
      maxPrices: [expandDecimals(2550, 4), expandDecimals(1, 6)],
      gasUsageLabel: "orderHandler.executeLiquidation",
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);

    expect(await wnt.balanceOf(user0.address)).to.eq(0);
    expect(await usdc.balanceOf(user0.address)).to.eq(0);

    // Pool profits
    expect(
      (await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).sub(poolBalBefore)
    ).to.eq(initialWNTAmount);
  });

  it("Long position short collateral gets liquidated", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialUSDCAmount = expandDecimals(50000, 6);

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

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await mine();

    const poolBalBefore = await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address);
    const marketTokenBalBefore = await usdc.balanceOf(ethUsdMarket.marketToken);

    await executeLiquidation(fixture, {
      account: user0.address,
      market: ethUsdMarket,
      collateralToken: usdc,
      isLong: true,
      minPrices: [expandDecimals(2450, 4), expandDecimals(1, 6)],
      maxPrices: [expandDecimals(2450, 4), expandDecimals(1, 6)],
      gasUsageLabel: "orderHandler.executeLiquidation",
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);

    expect(await wnt.balanceOf(user0.address)).to.eq(0);
    expect(await usdc.balanceOf(user0.address)).to.eq(0);

    expect((await usdc.balanceOf(ethUsdMarket.marketToken)).sub(marketTokenBalBefore)).to.eq(0);

    // Pool profits
    expect(
      (await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address)).sub(poolBalBefore)
    ).to.eq(initialUSDCAmount);
  });

  it("Short position short collateral gets liquidated", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialUSDCAmount = expandDecimals(50000, 6);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: initialUSDCAmount,
        sizeDeltaUsd: expandFloatDecimals(100 * 1000), // 2x position
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

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await mine();

    const poolBalBefore = await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address);

    await executeLiquidation(fixture, {
      account: user0.address,
      market: ethUsdMarket,
      collateralToken: usdc,
      isLong: false,
      minPrices: [expandDecimals(7500, 4), expandDecimals(1, 6)],
      maxPrices: [expandDecimals(7500, 4), expandDecimals(1, 6)],
      gasUsageLabel: "orderHandler.executeLiquidation",
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);

    expect(await wnt.balanceOf(user0.address)).to.eq(0);
    expect(await usdc.balanceOf(user0.address)).to.eq(0);

    // Pool profits
    expect(
      (await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address)).sub(poolBalBefore)
    ).to.eq(initialUSDCAmount);
  });

  it("Cannot liquidate a position that should not be liquidated", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);

    const initialUSDCAmount = expandDecimals(50000, 6);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: initialUSDCAmount,
        sizeDeltaUsd: expandFloatDecimals(100 * 1000), // 2x position
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

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    await mine();

    await expect(
      executeLiquidation(fixture, {
        account: user0.address,
        market: ethUsdMarket,
        collateralToken: usdc,
        isLong: false,
        minPrices: [expandDecimals(4900, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(4900, 4), expandDecimals(1, 6)],
        gasUsageLabel: "orderHandler.executeLiquidation",
      })
    ).to.be.revertedWith("DecreasePositionUtils: Invalid Liquidation");
  });

  it("Open a position, realize some profits, increase it's collateral, realize some losses, decrease it's collateral, increase the size, get liquidated", async () => {
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

    let userWntBefore = await wnt.balanceOf(user0.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(25 * 1000), // Decrease my position by 25%
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

    // Net profit $20,000, decrease by 1/4th, realize $5,000 profit, $5,000/$6,000 = .8333 repeating ETH
    expect((await wnt.balanceOf(user0.address)).sub(userWntBefore)).to.lt(expandDecimals(83334, 13));
    expect((await wnt.balanceOf(user0.address)).sub(userWntBefore)).to.gt(expandDecimals(83333, 13));
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    let positionSizeInTokens = expandDecimals(15, 18);

    expect(positionInfo.numbers.collateralAmount).to.eq(initialUSDCAmount);
    expect(positionInfo.numbers.sizeInUsd).to.eq(expandFloatDecimals(75 * 1000));
    expect(positionInfo.numbers.sizeInTokens).to.eq(positionSizeInTokens);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: initialUSDCAmount, // Position collateral is now 100,000 USDC
        sizeDeltaUsd: expandFloatDecimals(25 * 1000), // I must increase my position size if I want to increase my collateral
        acceptablePrice: expandDecimals(6001, 12),
        orderType: OrderType.MarketIncrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(6000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(6000, 4), expandDecimals(1, 6)],
      },
    });

    positionInfo = await positionStore.get(positionKey);
    positionSizeInTokens = positionSizeInTokens.add(expandDecimals(41666, 14));

    expect(positionInfo.numbers.collateralAmount).to.eq(expandDecimals(100000, 6));
    expect(positionInfo.numbers.sizeInUsd).to.eq(expandFloatDecimals(100 * 1000));
    expect(positionInfo.numbers.sizeInTokens).to.lt(positionSizeInTokens.add(expandDecimals(1, 14)));
    expect(positionInfo.numbers.sizeInTokens).to.gt(positionSizeInTokens);
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    userWntBefore = await wnt.balanceOf(user0.address);
    const userUsdcBefore = await usdc.balanceOf(user0.address);

    // Decrease my position collateral and realize some losses
    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: initialUSDCAmount, // Position collateral should now be 50,000 USDC, but it isn't applied due to a bug
        sizeDeltaUsd: expandFloatDecimals(50 * 1000),
        acceptablePrice: expandDecimals(3999, 12),
        orderType: OrderType.MarketDecrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(4000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(4000, 4), expandDecimals(1, 6)],
      },
    });

    // (Money spent for tokens sold) - (Money received for tokens sold)
    const userTokensSold = positionSizeInTokens.div(2);
    const userLosses = positionInfo.numbers.sizeInUsd.div(2) - expandDecimals(userTokensSold.mul(4000), 12); // Get to float decimals

    positionInfo = await positionStore.get(positionKey);

    expect((await wnt.balanceOf(user0.address)).sub(userWntBefore)).to.eq(0);
    expect((await usdc.balanceOf(user0.address)).sub(userUsdcBefore)).to.eq(0);

    expect(positionInfo.numbers.sizeInUsd).to.eq(expandFloatDecimals(50 * 1000));
    expect(positionInfo.numbers.sizeInTokens).to.lt(positionSizeInTokens.sub(userTokensSold).mul(1001).div(1000));
    expect(positionInfo.numbers.sizeInTokens).to.gt(positionSizeInTokens.sub(userTokensSold).mul(999).div(1000));

    const originalSize = expandDecimals(100 * 1000, 6);
    const lossesAdjusted = bigNumberify(Math.round(userLosses / 1e24));

    // My collateral decrease fails to be applied and my negative PnL is applied
    expect(positionInfo.numbers.collateralAmount).to.gt(originalSize.sub(lossesAdjusted).mul(999).div(1000));
    expect(positionInfo.numbers.collateralAmount).to.lt(originalSize.sub(lossesAdjusted).mul(1001).div(1000));

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(100 * 1000), // Increase position by 100k
        acceptablePrice: expandDecimals(6001, 12),
        orderType: OrderType.MarketIncrease,
        isLong: true,
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(4000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(4000, 4), expandDecimals(1, 6)],
      },
    });

    const poolBalBefore = await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address);
    positionInfo = await positionStore.get(positionKey);

    await mine();

    await executeLiquidation(fixture, {
      account: user0.address,
      market: ethUsdMarket,
      collateralToken: usdc,
      isLong: true,
      minPrices: [expandDecimals(1000, 4), expandDecimals(1, 6)],
      maxPrices: [expandDecimals(1000, 4), expandDecimals(1, 6)],
      gasUsageLabel: "orderHandler.executeLiquidation",
    });

    expect(await positionStore.getAccountPositionCount(user1.address)).eq(0);
    expect(await positionStore.getPositionCount()).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);

    expect(await wnt.balanceOf(user1.address)).to.eq(0);
    expect(await usdc.balanceOf(user1.address)).to.eq(0);

    // Pool profits
    expect(
      (await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address)).sub(poolBalBefore)
    ).to.eq(positionInfo.numbers.collateralAmount);
  });
});
