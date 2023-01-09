import { expect } from "chai";

import { deployFixture } from "../../utils/fixture";
import { expandDecimals } from "../../utils/math";
import { handleDeposit } from "../../utils/deposit";
import { OrderType, handleOrder } from "../../utils/order";
import { TOKEN_ORACLE_TYPES } from "../../utils/oracle";

describe("Guardian.SwapOrder", () => {
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
    btcUsdMarket;
  let executionFee;
  let reader, dataStore;

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

  it("Market swap with consecutive duplicate markets in swap path fails", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);

    await handleOrder(fixture, {
      create: {
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(10, 18),
        acceptablePrice: 0,
        orderType: OrderType.MarketSwap,
        swapPath: [ethUsdMarket.marketToken, ethUsdMarket.marketToken], // wnt -> usdc, usdc -> wnt
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        prices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    // Invalid receiver error so market order gets cancelled
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(0);
    expect(await wnt.balanceOf(user0.address)).eq(expandDecimals(10, 18));
    expect(await usdc.balanceOf(user0.address)).eq(0);
  });

  it("Limit swap with consecutive duplicate markets in swap path fails", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);

    await handleOrder(fixture, {
      create: {
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(10, 18),
        orderType: OrderType.LimitSwap,
        swapPath: [ethUsdMarket.marketToken, ethUsdMarket.marketToken], // wnt -> usdc, usdc -> wnt
        minOutputAmount: 0,
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(4999, 4), expandDecimals(1, 6), expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(4999, 4), expandDecimals(1, 6), expandDecimals(5000, 4), expandDecimals(1, 6)],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    // Invalid receiver error so limit order gets frozen
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(1);
    const orderKeys = await orderStore.getOrderKeys(0, 1);
    const order = await orderStore.get(orderKeys[0]);
    expect(order.flags.isFrozen).to.be.true;
    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
  });

  it("Market swap with multiple markets", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(0);

    let beforeBTCMarketBTCBalance = await reader.getPoolAmount(
      dataStore.address,
      btcUsdMarket.marketToken,
      wbtc.address
    );
    let beforeBTCMarketUSDCBalance = await reader.getPoolAmount(
      dataStore.address,
      btcUsdMarket.marketToken,
      usdc.address
    );
    let beforeETHMarketETHBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdMarket.marketToken,
      wnt.address
    );
    let beforeETHMarketUSDCBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdMarket.marketToken,
      usdc.address
    );

    await handleOrder(fixture, {
      create: {
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(10, 18),
        acceptablePrice: 0,
        orderType: OrderType.MarketSwap,
        swapPath: [ethUsdMarket.marketToken, btcUsdMarket.marketToken], // wnt -> usdc, usdc -> btc
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(25000, 2)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(25000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    let afterBTCMarketBTCBalance = await reader.getPoolAmount(
      dataStore.address,
      btcUsdMarket.marketToken,
      wbtc.address
    );
    let afterBTCMarketUSDCBalance = await reader.getPoolAmount(
      dataStore.address,
      btcUsdMarket.marketToken,
      usdc.address
    );
    let afterETHMarketETHBalance = await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address);
    let afterETHMarketUSDCBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdMarket.marketToken,
      usdc.address
    );

    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    // $50,000 / $25,000
    expect(await wbtc.balanceOf(user0.address)).eq(expandDecimals(2, 8));

    // 2 BTC out
    expect(beforeBTCMarketBTCBalance.sub(afterBTCMarketBTCBalance)).to.eq(expandDecimals(2, 8));
    // 50,000 USDC in
    expect(afterBTCMarketUSDCBalance.sub(beforeBTCMarketUSDCBalance)).to.eq(expandDecimals(50000, 6));
    // 10 ETH in
    expect(afterETHMarketETHBalance.sub(beforeETHMarketETHBalance)).to.eq(expandDecimals(10, 18));
    // 50,000 USDC out
    expect(beforeETHMarketUSDCBalance.sub(afterETHMarketUSDCBalance)).to.eq(expandDecimals(50000, 6));
  });

  it("Limit swap with multiple markets", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(0);

    let beforeBTCMarketBTCBalance = await reader.getPoolAmount(
      dataStore.address,
      btcUsdMarket.marketToken,
      wbtc.address
    );
    let beforeBTCMarketUSDCBalance = await reader.getPoolAmount(
      dataStore.address,
      btcUsdMarket.marketToken,
      usdc.address
    );
    let beforeETHMarketETHBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdMarket.marketToken,
      wnt.address
    );
    let beforeETHMarketUSDCBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdMarket.marketToken,
      usdc.address
    );

    await handleOrder(fixture, {
      create: {
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(10, 18),
        acceptablePrice: 0,
        orderType: OrderType.LimitSwap,
        swapPath: [ethUsdMarket.marketToken, btcUsdMarket.marketToken], // wnt -> usdc, usdc -> btc
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
        ],
        maxPrices: [
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
        ],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    let afterBTCMarketBTCBalance = await reader.getPoolAmount(
      dataStore.address,
      btcUsdMarket.marketToken,
      wbtc.address
    );
    let afterBTCMarketUSDCBalance = await reader.getPoolAmount(
      dataStore.address,
      btcUsdMarket.marketToken,
      usdc.address
    );
    let afterETHMarketETHBalance = await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address);
    let afterETHMarketUSDCBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdMarket.marketToken,
      usdc.address
    );

    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    // $50,000 / $25,000
    expect(await wbtc.balanceOf(user0.address)).eq(expandDecimals(2, 8));

    // 2 BTC out
    expect(beforeBTCMarketBTCBalance.sub(afterBTCMarketBTCBalance)).to.eq(expandDecimals(2, 8));
    // 50,000 USDC in
    expect(afterBTCMarketUSDCBalance.sub(beforeBTCMarketUSDCBalance)).to.eq(expandDecimals(50000, 6));
    // 10 ETH in
    expect(afterETHMarketETHBalance.sub(beforeETHMarketETHBalance)).to.eq(expandDecimals(10, 18));
    // 50,000 USDC out
    expect(beforeETHMarketUSDCBalance.sub(afterETHMarketUSDCBalance)).to.eq(expandDecimals(50000, 6));
  });

  it("Market swap with circular markets", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(0);

    let beforeBTCMarketETHBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdIndexBtcMarket.marketToken,
      wnt.address
    );
    let beforeBTCMarketUSDCBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdIndexBtcMarket.marketToken,
      usdc.address
    );
    let beforeETHMarketETHBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdMarket.marketToken,
      wnt.address
    );
    let beforeETHMarketUSDCBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdMarket.marketToken,
      usdc.address
    );

    await handleOrder(fixture, {
      create: {
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(10, 18),
        acceptablePrice: 0,
        orderType: OrderType.MarketSwap,
        swapPath: [ethUsdMarket.marketToken, ethUsdIndexBtcMarket.marketToken, ethUsdMarket.marketToken], // wnt -> usdc, usdc -> wnt, wnt -> usdc
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(25000, 2)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(25000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    let afterBTCMarketETHBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdIndexBtcMarket.marketToken,
      wnt.address
    );
    let afterBTCMarketUSDCBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdIndexBtcMarket.marketToken,
      usdc.address
    );
    let afterETHMarketETHBalance = await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address);
    let afterETHMarketUSDCBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdMarket.marketToken,
      usdc.address
    );

    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(expandDecimals(50000, 6));
    expect(await wbtc.balanceOf(user0.address)).eq(0);

    // 10 ETH out
    expect(beforeBTCMarketETHBalance.sub(afterBTCMarketETHBalance)).to.eq(expandDecimals(10, 18));
    // 50,000 USDC in
    expect(afterBTCMarketUSDCBalance.sub(beforeBTCMarketUSDCBalance)).to.eq(expandDecimals(50000, 6));
    // 10 + 10 ETH in
    expect(afterETHMarketETHBalance.sub(beforeETHMarketETHBalance)).to.eq(expandDecimals(20, 18));
    // 50,000 + 50,000 USDC out
    expect(beforeETHMarketUSDCBalance.sub(afterETHMarketUSDCBalance)).to.eq(expandDecimals(100000, 6));
  });

  it("Limit swap with circular markets", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(0);

    let beforeBTCMarketETHBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdIndexBtcMarket.marketToken,
      wnt.address
    );
    let beforeBTCMarketUSDCBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdIndexBtcMarket.marketToken,
      usdc.address
    );
    let beforeETHMarketETHBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdMarket.marketToken,
      wnt.address
    );
    let beforeETHMarketUSDCBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdMarket.marketToken,
      usdc.address
    );

    await handleOrder(fixture, {
      create: {
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(10, 18),
        acceptablePrice: 0,
        orderType: OrderType.LimitSwap,
        swapPath: [ethUsdMarket.marketToken, ethUsdIndexBtcMarket.marketToken, ethUsdMarket.marketToken], // wnt -> usdc, usdc -> wnt, wnt -> usdc
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
        ],
        maxPrices: [
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
        ],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    let afterBTCMarketETHBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdIndexBtcMarket.marketToken,
      wnt.address
    );
    let afterBTCMarketUSDCBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdIndexBtcMarket.marketToken,
      usdc.address
    );
    let afterETHMarketETHBalance = await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address);
    let afterETHMarketUSDCBalance = await reader.getPoolAmount(
      dataStore.address,
      ethUsdMarket.marketToken,
      usdc.address
    );

    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(expandDecimals(50000, 6));
    expect(await wbtc.balanceOf(user0.address)).eq(0);

    // 10 ETH out
    expect(beforeBTCMarketETHBalance.sub(afterBTCMarketETHBalance)).to.eq(expandDecimals(10, 18));
    // 50,000 USDC in
    expect(afterBTCMarketUSDCBalance.sub(beforeBTCMarketUSDCBalance)).to.eq(expandDecimals(50000, 6));
    // 10 + 10 ETH in
    expect(afterETHMarketETHBalance.sub(beforeETHMarketETHBalance)).to.eq(expandDecimals(20, 18));
    // 50,000 + 50,000 USDC out
    expect(beforeETHMarketUSDCBalance.sub(afterETHMarketUSDCBalance)).to.eq(expandDecimals(100000, 6));
  });

  it("Swap with non-market address in swap path reverts", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(0);

    await expect(
      handleOrder(fixture, {
        create: {
          initialCollateralToken: wnt,
          initialCollateralDeltaAmount: expandDecimals(10, 18),
          acceptablePrice: 0,
          orderType: OrderType.MarketSwap,
          swapPath: [
            ethUsdMarket.marketToken,
            ethUsdIndexBtcMarket.marketToken,
            ethUsdMarket.marketToken,
            user0.address,
          ], // wnt -> usdc, usdc -> wnt, wnt -> usdc, usdc -> NA
        },
        execute: {
          tokens: [wnt.address, usdc.address, wbtc.address],
          minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(25000, 2)],
          maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(25000, 2)],
          precisions: [8, 18, 20],
          tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
          gasUsageLabel: "orderHandler.executeOrder",
        },
      })
    ).to.be.revertedWithCustomError(orderHandler, "EmptyMarket");

    await expect(
      handleOrder(fixture, {
        create: {
          initialCollateralToken: wnt,
          initialCollateralDeltaAmount: expandDecimals(10, 18),
          acceptablePrice: 0,
          orderType: OrderType.LimitSwap,
          swapPath: [
            ethUsdMarket.marketToken,
            ethUsdIndexBtcMarket.marketToken,
            ethUsdMarket.marketToken,
            user0.address,
          ], // wnt -> usdc, usdc -> wnt, wnt -> usdc, usdc -> NA
        },
        execute: {
          tokens: [wnt.address, usdc.address, wbtc.address],
          minPrices: [
            expandDecimals(5000, 4),
            expandDecimals(1, 6),
            expandDecimals(25000, 2),
            expandDecimals(5000, 4),
            expandDecimals(1, 6),
            expandDecimals(25000, 2),
          ],
          maxPrices: [
            expandDecimals(5000, 4),
            expandDecimals(1, 6),
            expandDecimals(25000, 2),
            expandDecimals(5000, 4),
            expandDecimals(1, 6),
            expandDecimals(25000, 2),
          ],
          precisions: [8, 18, 20],
          tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
          gasUsageLabel: "orderHandler.executeOrder",
        },
      })
    ).to.be.revertedWithCustomError(orderHandler, "EmptyMarket");

    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(0);
  });

  it("Market swap with min output amount", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(0);

    // minOutputAmount = expected output amount based on prices
    await handleOrder(fixture, {
      create: {
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(10, 18),
        acceptablePrice: 0,
        orderType: OrderType.MarketSwap,
        swapPath: [ethUsdMarket.marketToken, btcUsdMarket.marketToken], // wnt -> usdc, usdc -> btc
        minOutputAmount: expandDecimals(2, 8),
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(25000, 2)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(25000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(expandDecimals(2, 8));

    // minOutputAmount > expected output amount based on prices
    await handleOrder(fixture, {
      create: {
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(10, 18),
        acceptablePrice: 0,
        orderType: OrderType.MarketSwap,
        swapPath: [ethUsdMarket.marketToken, btcUsdMarket.marketToken], // wnt -> usdc, usdc -> btc
        minOutputAmount: expandDecimals(1000, 8),
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(25000, 2)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(25000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(0); // Order was cancelled
    expect(await wnt.balanceOf(user0.address)).eq(expandDecimals(10, 18)); // get back our initial collateral
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(expandDecimals(2, 8)); // wbtc balance stays the same
  });

  it("Limit swap with min output amount", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(0);

    // minOutputAmount = expected output amount based on prices
    await handleOrder(fixture, {
      create: {
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(10, 18),
        acceptablePrice: 0,
        orderType: OrderType.LimitSwap,
        swapPath: [ethUsdMarket.marketToken, btcUsdMarket.marketToken], // wnt -> usdc, usdc -> btc
        minOutputAmount: expandDecimals(2, 8),
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
        ],
        maxPrices: [
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
        ],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(expandDecimals(2, 8));

    // minOutputAmount > expected output amount based on prices
    await handleOrder(fixture, {
      create: {
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(10, 18),
        acceptablePrice: 0,
        orderType: OrderType.LimitSwap,
        swapPath: [ethUsdMarket.marketToken, btcUsdMarket.marketToken], // wnt -> usdc, usdc -> btc
        minOutputAmount: expandDecimals(1000, 8),
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
        ],
        maxPrices: [
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
        ],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await orderStore.getOrderCount()).eq(1); // Order was frozen
    const orderKeys = await orderStore.getOrderKeys(0, 1);
    const order = await orderStore.get(orderKeys[0]);
    expect(order.flags.isFrozen).to.be.true;
    expect(await wnt.balanceOf(user0.address)).eq(0); // order is frozen so collateral is not returned
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(expandDecimals(2, 8)); // wbtc balance stays the same
  });

  it("Swap with short token as collateral", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(0);

    await handleOrder(fixture, {
      create: {
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: expandDecimals(50000, 6),
        acceptablePrice: 0,
        orderType: OrderType.MarketSwap,
        swapPath: [
          ethUsdMarket.marketToken,
          ethUsdIndexBtcMarket.marketToken,
          ethUsdMarket.marketToken,
          ethUsdIndexBtcMarket.marketToken,
          btcUsdMarket.marketToken,
        ],
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(25000, 2)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(25000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(expandDecimals(2, 8));

    await handleOrder(fixture, {
      create: {
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: expandDecimals(50000, 6),
        acceptablePrice: 0,
        orderType: OrderType.LimitSwap,
        swapPath: [
          ethUsdMarket.marketToken,
          ethUsdIndexBtcMarket.marketToken,
          ethUsdMarket.marketToken,
          ethUsdIndexBtcMarket.marketToken,
          btcUsdMarket.marketToken,
        ],
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
        ],
        maxPrices: [
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
        ],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(expandDecimals(4, 8));
  });

  it("Market swap unwraps native token", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(0);

    let beforeBalanceETH = await provider.getBalance(user0.address);

    // shouldUnwrapNativeToken with usdc as starting collateral
    await handleOrder(fixture, {
      create: {
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: expandDecimals(50000, 6),
        acceptablePrice: 0,
        orderType: OrderType.MarketSwap,
        shouldUnwrapNativeToken: true,
        swapPath: [ethUsdMarket.marketToken],
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(25000, 2)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(25000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    let afterBalanceETH = await provider.getBalance(user0.address);

    expect(beforeBalanceETH.add(expandDecimals(10, 18)).add(executionFee)).to.eq(afterBalanceETH);
    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(0);

    beforeBalanceETH = await provider.getBalance(user0.address);

    // shouldUnwrapNativeToken with wnt as starting collateral
    await handleOrder(fixture, {
      create: {
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(10, 18),
        acceptablePrice: 0,
        orderType: OrderType.MarketSwap,
        shouldUnwrapNativeToken: true,
        swapPath: [ethUsdMarket.marketToken, ethUsdIndexBtcMarket.marketToken], // wnt -> usdc, usdc -> want
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(25000, 2)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6), expandDecimals(25000, 2)],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    afterBalanceETH = await provider.getBalance(user0.address);

    expect(beforeBalanceETH.add(expandDecimals(10, 18).add(executionFee))).to.eq(afterBalanceETH);
    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(0);
  });

  it("Limit swap unwraps native token", async () => {
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(0);
    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(0);

    let beforeBalanceETH = await provider.getBalance(user0.address);

    // shouldUnwrapNativeToken with usdc as starting collateral
    await handleOrder(fixture, {
      create: {
        initialCollateralToken: usdc,
        initialCollateralDeltaAmount: expandDecimals(50000, 6),
        acceptablePrice: 0,
        orderType: OrderType.LimitSwap,
        shouldUnwrapNativeToken: true,
        swapPath: [ethUsdMarket.marketToken],
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
        ],
        maxPrices: [
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
        ],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    let afterBalanceETH = await provider.getBalance(user0.address);

    expect(beforeBalanceETH.add(expandDecimals(10, 18)).add(executionFee)).to.eq(afterBalanceETH);
    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(0);

    beforeBalanceETH = await provider.getBalance(user0.address);

    // shouldUnwrapNativeToken with wnt as starting collateral
    await handleOrder(fixture, {
      create: {
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: expandDecimals(10, 18),
        acceptablePrice: 0,
        orderType: OrderType.LimitSwap,
        shouldUnwrapNativeToken: true,
        swapPath: [ethUsdMarket.marketToken, ethUsdIndexBtcMarket.marketToken], // wnt -> usdc, usdc -> want
      },
      execute: {
        tokens: [wnt.address, usdc.address, wbtc.address],
        minPrices: [
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
        ],
        maxPrices: [
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
          expandDecimals(5000, 4),
          expandDecimals(1, 6),
          expandDecimals(25000, 2),
        ],
        precisions: [8, 18, 20],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
        gasUsageLabel: "orderHandler.executeOrder",
      },
    });

    afterBalanceETH = await provider.getBalance(user0.address);

    expect(beforeBalanceETH.add(expandDecimals(10, 18).add(executionFee))).to.eq(afterBalanceETH);
    expect(await wnt.balanceOf(user0.address)).eq(0);
    expect(await usdc.balanceOf(user0.address)).eq(0);
    expect(await wbtc.balanceOf(user0.address)).eq(0);
  });
});
