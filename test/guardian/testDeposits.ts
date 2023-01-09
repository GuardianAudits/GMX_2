import { expect } from "chai";
import { deployFixture } from "../../utils/fixture";
import { expandDecimals, expandFloatDecimals } from "../../utils/math";
import { handleDeposit } from "../../utils/deposit";
import * as keys from "../../utils/keys";
import { decimalToFloat } from "../../utils/math";
import "ethers";
import { getBalanceOf } from "../../utils/token";
import { handleWithdrawal } from "../../utils/withdrawal";
import { createOrder, executeOrder, handleOrder, OrderType } from "../../utils/order";

describe("Guardian.Deposit", () => {
  let fixture;
  let wallet, user0, user1;
  let orderStore,
    positionStore,
    exchangeRouter,
    ethUsdMarket,
    wnt,
    usdc,
    wbtc,
    ethUsdIndexBtcMarket,
    dataStore,
    eventEmitter,
    reader;
  let executionFee;
  let user1WntBalance, user1UsdcBalance;

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
      dataStore,
      eventEmitter,
      reader,
    } = fixture.contracts);
    ({ executionFee } = fixture.props);

    user1WntBalance = expandDecimals(100, 18);
    user1UsdcBalance = expandDecimals(500000, 6);

    // Create initially balanced market
    await handleDeposit(fixture, {
      create: {
        account: user1,
        market: ethUsdMarket,
        longTokenAmount: user1WntBalance,
        shortTokenAmount: user1UsdcBalance,
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });
  });

  it("Negatively impacts depositors for imbalanced markets", async () => {
    const user0WntBalance = expandDecimals(10, 18);
    const user0UsdcBalance = expandDecimals(10, 6);
    const user1WntBalance = expandDecimals(800, 18);

    const wntDepositAmt = expandDecimals(5, 18);
    const usdcDepositAmt = expandDecimals(5, 6);

    // Give user0 10 WNT, 10 USDC
    await wnt.connect(user0).deposit({ value: user0WntBalance });
    await usdc.connect(wallet).transfer(user0.address, user0UsdcBalance);

    // Give user1 800 WNT to imbalance the market
    await wnt.connect(user1).deposit({ value: user1WntBalance });

    // Imbalanced the market
    await handleDeposit(fixture, {
      create: {
        account: user1,
        market: ethUsdMarket,
        longTokenAmount: user1WntBalance,
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });

    let impactPoolBalBefore = await dataStore.getUint(
      keys.swapImpactPoolAmountKey(ethUsdMarket.marketToken, wnt.address)
    );

    // User0 deposits 5 WNT to long
    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        longTokenAmount: wntDepositAmt,
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });

    let impactPoolBalAfter = await dataStore.getUint(
      keys.swapImpactPoolAmountKey(ethUsdMarket.marketToken, wnt.address)
    );

    // Impact has not been turned on yet, no impact is experienced
    expect(impactPoolBalAfter.sub(impactPoolBalBefore)).to.eq(0);

    // set price for swap impact to 0.1% for every $50,000 of token imbalance
    // 0.1% => 0.001
    // 0.001 / 50,000 => 2 * (10 ** -8)
    await dataStore.setUint(keys.swapImpactFactorKey(ethUsdMarket.marketToken, true), decimalToFloat(2, 8));
    await dataStore.setUint(keys.swapImpactFactorKey(ethUsdMarket.marketToken, false), decimalToFloat(2, 8));
    await dataStore.setUint(keys.swapImpactExponentFactorKey(ethUsdMarket.marketToken), decimalToFloat(2, 0));

    impactPoolBalBefore = await dataStore.getUint(keys.swapImpactPoolAmountKey(ethUsdMarket.marketToken, wnt.address));

    // User0 deposits 5 WNT to long, expect loss of value now that impact is turned on
    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        longTokenAmount: wntDepositAmt,
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });

    impactPoolBalAfter = await dataStore.getUint(keys.swapImpactPoolAmountKey(ethUsdMarket.marketToken, wnt.address));

    // The user now experiences impact and some of their deposit goes into the impact pool
    // We'll have to make sure this value is what we expect it to be
    expect(impactPoolBalAfter.sub(impactPoolBalBefore)).to.gt(0);

    const collateralAmount = await dataStore.getUint(
      keys.collateralSumKey(ethUsdMarket.marketToken, wnt.address, true)
    );
    // Since no one has created a position in the market yet, collateral amount should be 0
    expect(collateralAmount).to.eq(0);

    const poolAmount = await dataStore.getUint(keys.poolAmountKey(ethUsdMarket.marketToken, wnt.address));

    // Must not violate this formula:
    // getBalance(marketToken) == impactPoolBalance + poolAmount + collateralAmount
    expect(await wnt.balanceOf(ethUsdMarket.marketToken)).to.eq(
      impactPoolBalAfter.add(poolAmount).add(collateralAmount)
    );

    impactPoolBalBefore = await dataStore.getUint(keys.swapImpactPoolAmountKey(ethUsdMarket.marketToken, wnt.address));

    // Withdrawal user0 long liquidity, expect impact pool to decrease
    await handleWithdrawal(fixture, {
      create: {
        market: ethUsdMarket,
        marketTokensLongAmount: expandDecimals(10, 18),
      },
      execute: {
        gasUsageLabel: "executeWithdrawal",
      },
    });

    impactPoolBalAfter = await dataStore.getUint(keys.swapImpactPoolAmountKey(ethUsdMarket.marketToken, wnt.address));
    expect(impactPoolBalAfter.sub(impactPoolBalBefore)).to.lt(0);

    impactPoolBalBefore = await dataStore.getUint(keys.swapImpactPoolAmountKey(ethUsdMarket.marketToken, wnt.address));

    // Deposit 5 USDC to short, expect impact pool to decrease
    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        shortTokenAmount: usdcDepositAmt,
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });

    impactPoolBalAfter = await dataStore.getUint(keys.swapImpactPoolAmountKey(ethUsdMarket.marketToken, wnt.address));

    expect(impactPoolBalAfter.sub(impactPoolBalBefore)).to.lt(0);
  });

  it("Does not issue market tokens for an incorrect token", async () => {
    const user0WbtcBalance = expandDecimals(10, 8);

    const usdcDepositAmt = expandDecimals(10, await usdc.decimals());

    // Give user0 10 WBTC
    await wbtc.connect(wallet).transfer(user0.address, user0WbtcBalance);

    const wbtcBalBefore = await wbtc.balanceOf(user0.address);

    await handleDeposit(fixture, {
      create: {
        account: user0,
        market: ethUsdMarket,
        longTokenAmount: usdcDepositAmt,
        longToken: wbtc,
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });

    const wbtcBalAfter = await wbtc.balanceOf(user0.address);

    // user0 doesn't lose any wbtc
    expect(wbtcBalAfter.sub(wbtcBalBefore)).to.be.eq(0);
    // user0 doesn't gain any market tokens
    expect(await getBalanceOf(ethUsdMarket.marketToken, user0.address)).to.eq(0);
  });

  it("Causes depositor to lose value when trader realizes profit", async () => {
    const initialWntCollateral = expandDecimals(4, 18); // 20k @ $5,000/ETH

    expect(await orderStore.getOrderCount()).to.eq(0);
    expect(await positionStore.getPositionCount()).eq(0);

    const params = {
      account: user0,
      market: ethUsdMarket,
      initialCollateralToken: wnt,
      initialCollateralDeltaAmount: initialWntCollateral,
      sizeDeltaUsd: expandFloatDecimals(20 * 1000), // 1x position
      acceptablePrice: expandDecimals(5001, 12),
      orderType: OrderType.MarketIncrease,
      isLong: true,
    };

    const wntBalBefore = await wnt.balanceOf(user0.address);

    await createOrder(fixture, params);

    expect(await orderStore.getOrderCount()).eq(1);
    expect(await positionStore.getPositionCount()).eq(0);

    // user0 invests long 20k WNT
    await executeOrder(fixture, {
      tokens: [wnt.address, usdc.address],
      minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      gasUsageLabel: "orderHandler.executeOrder",
    });

    expect(await orderStore.getOrderCount()).eq(0);
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await reader.getOpenInterestInTokens(dataStore.address, ethUsdMarket.marketToken, wnt.address, true)).to.eq(
      initialWntCollateral
    );

    params.orderType = OrderType.MarketDecrease;
    params.acceptablePrice = 0;

    // user0 sells at 40k wnt
    await handleOrder(fixture, {
      create: params,
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(10000, 4), expandDecimals(1, 6)], // Sell at 2x original position
        maxPrices: [expandDecimals(10000, 4), expandDecimals(1, 6)], // Sell at 2x original position
      },
    });

    const wntBalAfter = await wnt.balanceOf(user0.address);

    expect(await orderStore.getOrderCount()).eq(0);
    expect(await getBalanceOf(ethUsdMarket.marketToken, user0.address)).to.eq(0);
    expect(await positionStore.getPositionCount()).eq(0);
    expect(wntBalAfter.sub(wntBalBefore)).to.gt(initialWntCollateral); // user0 made a profit

    const user1MarketTokensBalance = await getBalanceOf(ethUsdMarket.marketToken, user1.address);

    const user1UsdcBalBefore = await usdc.balanceOf(user1.address);

    const poolBalUsdc = await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address);

    const marketTokenPrice = await reader.getMarketTokenPrice(
      dataStore.address,
      ethUsdMarket,
      {
        min: expandDecimals(10000, 4 + 8),
        max: expandDecimals(10000, 4 + 8),
      },
      {
        min: expandDecimals(1, 6 + 18),
        max: expandDecimals(1, 6 + 18),
      },
      {
        min: expandDecimals(10000, 4 + 8),
        max: expandDecimals(10000, 4 + 8),
      },
      true
    );

    const marketTokensShortToWithdraw = expandDecimals(poolBalUsdc, 42).div(marketTokenPrice);

    // Notice that the user is unable to withdraw their long tokens because
    // The open interest is incremented rather than decremented when decreasing a position
    // See "CRITICAL - DecreasePosition increases openInterestInTokens" in the PoCs.ts file for a Proof-of-Concept

    await handleWithdrawal(fixture, {
      create: {
        account: user1,
        market: ethUsdMarket,
        marketTokensShortAmount: marketTokensShortToWithdraw,
      },
      execute: {
        minPrices: [expandDecimals(10000, 4), expandDecimals(1, 6)], // Sell at 2x original position
        maxPrices: [expandDecimals(10000, 4), expandDecimals(1, 6)],
      },
    });
    expect(await getBalanceOf(ethUsdMarket.marketToken, user1.address)).to.lt(
      user1MarketTokensBalance.mul(200).div(300)
    ); // Confirm that user1 withdrew roughly 2/3 their deposit
    expect(await getBalanceOf(ethUsdMarket.marketToken, user1.address)).to.gt(
      user1MarketTokensBalance.mul(195).div(300)
    );
    expect((await usdc.balanceOf(user1.address)).sub(user1UsdcBalBefore)).to.lt(user1UsdcBalance); // user is able to withdraw their usdc that was deposited in the pool
    expect((await usdc.balanceOf(user1.address)).sub(user1UsdcBalBefore)).to.gt(user1UsdcBalance.mul(999).div(1000));
  });
});
