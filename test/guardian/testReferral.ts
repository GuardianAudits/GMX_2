import { expect } from "chai";

import { deployFixture } from "../../utils/fixture";
import { expandDecimals, expandFloatDecimals, decimalToFloat } from "../../utils/math";
import { handleDeposit } from "../../utils/deposit";
import { OrderType, handleOrder } from "../../utils/order";
import { TOKEN_ORACLE_TYPES } from "../../utils/oracle";
import * as keys from "../../utils/keys";

describe("Guardian.Referral", () => {
  const { provider } = ethers;

  let fixture;
  let user0, user1;
  let orderStore, positionStore, exchangeRouter, ethUsdMarket, wnt, usdc, wbtc, ethUsdIndexBtcMarket, referralStorage;
  let dataStore;
  let executionFee;
  const user0ReferralCode = "0xd283f3979d00cb5493f2da07819695bc299fba34aa6e0bacb484fe07a2fc0ae0";

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
      referralStorage,
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
        precisions: [8, 18, 22],
        tokenOracleTypes: [TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT, TOKEN_ORACLE_TYPES.DEFAULT],
      },
    });
  });

  it("Claim referral awards with self as affiliate", async () => {
    // 0.1% every $50,000
    const FEE_FACTOR = decimalToFloat(2, 8);
    await dataStore.setUint(keys.positionFeeFactorKey(ethUsdMarket.marketToken), FEE_FACTOR);
    await referralStorage.setTier(0, 10000, 0); // total rebate goes to affiliate

    await expect(referralStorage.connect(user0).registerCode(user0ReferralCode))
      .to.emit(referralStorage, "RegisterCode")
      .withArgs(user0.address, user0ReferralCode);

    let initialBalanceUSDC = await usdc.balanceOf(user0.address);
    let initialBalanceWNT = await wnt.balanceOf(user0.address);

    await exchangeRouter
      .connect(user0)
      .claimAffiliateRewards(
        [ethUsdMarket.marketToken, ethUsdMarket.marketToken],
        [wnt.address, usdc.address],
        user0.address
      );

    let afterClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    let afterClaimBalanceWNT = await wnt.balanceOf(user0.address);
    expect(afterClaimBalanceUSDC).to.eq(initialBalanceUSDC);
    expect(afterClaimBalanceWNT).to.eq(initialBalanceWNT);

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
        referral: user0ReferralCode,
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    // Referral code is set
    let [code, referrer] = await referralStorage.getTraderReferralInfo(user0.address);
    expect(code).to.eq(user0ReferralCode);
    expect(referrer).to.eq(user0.address);
    expect(await positionStore.getAccountPositionCount(user0.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    // Referral Awards should have been incremented after executing the order
    initialBalanceUSDC = await usdc.balanceOf(user0.address);
    initialBalanceWNT = await wnt.balanceOf(user0.address);

    await exchangeRouter
      .connect(user0)
      .claimAffiliateRewards(
        [ethUsdMarket.marketToken, ethUsdMarket.marketToken],
        [wnt.address, usdc.address],
        user0.address
      );

    afterClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    afterClaimBalanceWNT = await wnt.balanceOf(user0.address);
    expect(afterClaimBalanceUSDC).to.eq(initialBalanceUSDC);
    expect(afterClaimBalanceWNT).to.be.gt(initialBalanceWNT);
  });

  it("Claim referral awards with other user as affiliate", async () => {
    // 0.1% every $50,000
    const FEE_FACTOR = decimalToFloat(2, 8);
    await dataStore.setUint(keys.positionFeeFactorKey(ethUsdMarket.marketToken), FEE_FACTOR);
    await referralStorage.setTier(0, 10000, 0); // total rebate goes to affiliate

    await expect(referralStorage.connect(user0).registerCode(user0ReferralCode))
      .to.emit(referralStorage, "RegisterCode")
      .withArgs(user0.address, user0ReferralCode);

    let initialBalanceUSDC = await usdc.balanceOf(user0.address);
    let initialBalanceWNT = await wnt.balanceOf(user0.address);

    await exchangeRouter
      .connect(user0)
      .claimAffiliateRewards(
        [ethUsdMarket.marketToken, ethUsdMarket.marketToken],
        [wnt.address, usdc.address],
        user0.address
      );

    let afterClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    let afterClaimBalanceWNT = await wnt.balanceOf(user0.address);
    expect(afterClaimBalanceUSDC).to.eq(initialBalanceUSDC);
    expect(afterClaimBalanceWNT).to.eq(initialBalanceWNT);

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
        referral: user0ReferralCode,
        account: user1, // user1 creates the order with user0's referral code
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    // Referral code is set
    let [code, referrer] = await referralStorage.getTraderReferralInfo(user1.address);
    expect(code).to.eq(user0ReferralCode);
    // user1 is using user0's code
    expect(referrer).to.eq(user0.address);
    expect(await positionStore.getAccountPositionCount(user1.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    // Referral Awards should have been incremented after executing the order
    initialBalanceUSDC = await usdc.balanceOf(user0.address);
    initialBalanceWNT = await wnt.balanceOf(user0.address);

    await exchangeRouter
      .connect(user0)
      .claimAffiliateRewards(
        [ethUsdMarket.marketToken, ethUsdMarket.marketToken],
        [wnt.address, usdc.address],
        user0.address
      );

    afterClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    afterClaimBalanceWNT = await wnt.balanceOf(user0.address);
    expect(afterClaimBalanceUSDC).to.eq(initialBalanceUSDC);
    expect(afterClaimBalanceWNT).to.be.gt(initialBalanceWNT);
  });

  it("Rebate is 100% and Discount share is 100%", async () => {
    // User0 is affiliate, User1 is making trades
    // Ensure that affiliate gets 0 rebate, and User1 saves entire position fee so balance stays the same

    // 0.1% every $50,000
    const FEE_FACTOR = decimalToFloat(2, 8);
    await dataStore.setUint(keys.positionFeeFactorKey(ethUsdMarket.marketToken), FEE_FACTOR);
    await referralStorage.setTier(0, 10000, 10000); // total rebate goes to trader's discount

    await expect(referralStorage.connect(user0).registerCode(user0ReferralCode))
      .to.emit(referralStorage, "RegisterCode")
      .withArgs(user0.address, user0ReferralCode);

    let preClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    let preClaimBalanceWNT = await wnt.balanceOf(user0.address);

    await exchangeRouter
      .connect(user0)
      .claimAffiliateRewards(
        [ethUsdMarket.marketToken, ethUsdMarket.marketToken],
        [wnt.address, usdc.address],
        user0.address
      );

    let afterClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    let afterClaimBalanceWNT = await wnt.balanceOf(user0.address);
    expect(afterClaimBalanceUSDC).to.eq(preClaimBalanceUSDC);
    expect(afterClaimBalanceWNT).to.eq(preClaimBalanceWNT);

    const initialWNTAmount = expandDecimals(10, 18);
    let initTraderBalanceUSDC = await usdc.balanceOf(user1.address);
    let initTraderBalanceWNT = await wnt.balanceOf(user1.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(50 * 1000),
        acceptablePrice: expandDecimals(5001, 12),
        orderType: OrderType.MarketIncrease,
        isLong: true,
        referral: user0ReferralCode,
        account: user1, // user1 creates the order with user0's referral code
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    // Referral code is set
    let [code, referrer] = await referralStorage.getTraderReferralInfo(user1.address);
    expect(code).to.eq(user0ReferralCode);
    // user1 is using user0's code
    expect(referrer).to.eq(user0.address);
    expect(await positionStore.getAccountPositionCount(user1.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    // Referral Awards should not have been changed as entire rebate went to trader's discount
    preClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    preClaimBalanceWNT = await wnt.balanceOf(user0.address);

    await exchangeRouter
      .connect(user0)
      .claimAffiliateRewards(
        [ethUsdMarket.marketToken, ethUsdMarket.marketToken],
        [wnt.address, usdc.address],
        user0.address
      );

    afterClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    afterClaimBalanceWNT = await wnt.balanceOf(user0.address);
    // Balances did not change after claiming
    expect(afterClaimBalanceUSDC).to.eq(preClaimBalanceUSDC);
    expect(afterClaimBalanceWNT).to.eq(preClaimBalanceWNT);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(50 * 1000),
        acceptablePrice: expandDecimals(5001, 12),
        orderType: OrderType.MarketDecrease,
        isLong: true,
        referral: user0ReferralCode,
        account: user1, // user1 creates the order with user0's referral code
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)], // Price stays the same
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    // Ensure balance of user1 stays the same
    let afterTraderBalanceUSDC = await usdc.balanceOf(user1.address);
    let afterTraderBalanceWNT = await wnt.balanceOf(user1.address);

    expect(initTraderBalanceUSDC).to.eq(afterTraderBalanceUSDC);
    expect(initTraderBalanceWNT).to.eq(afterTraderBalanceWNT);
  });

  it("Rebate is 100% and Discount share is <100%", async () => {
    // User0 is affiliate, User1 is making trades
    // Ensure that affiliate gets 50% of rebate, and User1 maintains balances

    // 0.1% every $50,000
    const FEE_FACTOR = decimalToFloat(2, 8);
    await dataStore.setUint(keys.positionFeeFactorKey(ethUsdMarket.marketToken), FEE_FACTOR);
    await referralStorage.setTier(0, 10000, 5000); // half of total rebate goes to trader's discount

    await expect(referralStorage.connect(user0).registerCode(user0ReferralCode))
      .to.emit(referralStorage, "RegisterCode")
      .withArgs(user0.address, user0ReferralCode);

    let preClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    let preClaimBalanceWNT = await wnt.balanceOf(user0.address);

    await exchangeRouter
      .connect(user0)
      .claimAffiliateRewards(
        [ethUsdMarket.marketToken, ethUsdMarket.marketToken],
        [wnt.address, usdc.address],
        user0.address
      );

    let afterClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    let afterClaimBalanceWNT = await wnt.balanceOf(user0.address);
    expect(afterClaimBalanceUSDC).to.eq(preClaimBalanceUSDC);
    expect(afterClaimBalanceWNT).to.eq(preClaimBalanceWNT);

    const initialWNTAmount = expandDecimals(10, 18);
    let initTraderBalanceUSDC = await usdc.balanceOf(user1.address);
    let initTraderBalanceWNT = await wnt.balanceOf(user1.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(50 * 1000),
        acceptablePrice: expandDecimals(5001, 12),
        orderType: OrderType.MarketIncrease,
        isLong: true,
        referral: user0ReferralCode,
        account: user1, // user1 creates the order with user0's referral code
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    // Referral code is set
    let [code, referrer] = await referralStorage.getTraderReferralInfo(user1.address);
    expect(code).to.eq(user0ReferralCode);
    // user1 is using user0's code
    expect(referrer).to.eq(user0.address);
    expect(await positionStore.getAccountPositionCount(user1.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    // Referral Awards should not have been changed as entire rebate went to trader's discount
    preClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    preClaimBalanceWNT = await wnt.balanceOf(user0.address);

    await exchangeRouter
      .connect(user0)
      .claimAffiliateRewards(
        [ethUsdMarket.marketToken, ethUsdMarket.marketToken],
        [wnt.address, usdc.address],
        user0.address
      );

    afterClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    afterClaimBalanceWNT = await wnt.balanceOf(user0.address);
    // WNT balance increases after claiming
    expect(afterClaimBalanceUSDC).to.eq(preClaimBalanceUSDC);
    expect(afterClaimBalanceWNT).to.be.gt(preClaimBalanceWNT);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(50 * 1000),
        acceptablePrice: 0,
        orderType: OrderType.MarketDecrease,
        isLong: true,
        referral: user0ReferralCode,
        account: user1, // user1 creates the order with user0's referral code
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)], // Price stays the same
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    expect(await orderStore.getOrderCount()).eq(0);
    expect(await positionStore.getAccountPositionCount(user1.address)).eq(0);

    // Ensure balance of user1 stays the same
    let afterTraderBalanceUSDC = await usdc.balanceOf(user1.address);
    let afterTraderBalanceWNT = await wnt.balanceOf(user1.address);

    expect(initTraderBalanceUSDC).to.eq(afterTraderBalanceUSDC);
    // 100000000000 affiliate reward on increase and decrease
    expect(initTraderBalanceWNT.add(initialWNTAmount).sub(100000000000 * 2)).to.eq(afterTraderBalanceWNT);
  });

  it("Rebate is <100% and Discount share is 100%", async () => {
    // User0 is affiliate, User1 is making trades
    // Ensure that affiliate gets 50% of rebate, and User1 loses portion of collateral

    // 0.1% every $50,000
    const FEE_FACTOR = decimalToFloat(2, 8);
    await dataStore.setUint(keys.positionFeeFactorKey(ethUsdMarket.marketToken), FEE_FACTOR);
    await referralStorage.setTier(0, 5000, 10000); // all of total rebate goes to trader's discount

    await expect(referralStorage.connect(user0).registerCode(user0ReferralCode))
      .to.emit(referralStorage, "RegisterCode")
      .withArgs(user0.address, user0ReferralCode);

    let preClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    let preClaimBalanceWNT = await wnt.balanceOf(user0.address);

    await exchangeRouter
      .connect(user0)
      .claimAffiliateRewards(
        [ethUsdMarket.marketToken, ethUsdMarket.marketToken],
        [wnt.address, usdc.address],
        user0.address
      );

    let afterClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    let afterClaimBalanceWNT = await wnt.balanceOf(user0.address);
    expect(afterClaimBalanceUSDC).to.eq(preClaimBalanceUSDC);
    expect(afterClaimBalanceWNT).to.eq(preClaimBalanceWNT);

    const initialWNTAmount = expandDecimals(10, 18);
    let initTraderBalanceUSDC = await usdc.balanceOf(user1.address);
    let initTraderBalanceWNT = await wnt.balanceOf(user1.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(50 * 1000),
        acceptablePrice: expandDecimals(5001, 12),
        orderType: OrderType.MarketIncrease,
        isLong: true,
        referral: user0ReferralCode,
        account: user1, // user1 creates the order with user0's referral code
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    // Referral code is set
    let [code, referrer] = await referralStorage.getTraderReferralInfo(user1.address);
    expect(code).to.eq(user0ReferralCode);
    // user1 is using user0's code
    expect(referrer).to.eq(user0.address);
    expect(await positionStore.getAccountPositionCount(user1.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    // Referral Awards should not have been changed as entire rebate went to trader's discount
    preClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    preClaimBalanceWNT = await wnt.balanceOf(user0.address);

    await exchangeRouter
      .connect(user0)
      .claimAffiliateRewards(
        [ethUsdMarket.marketToken, ethUsdMarket.marketToken],
        [wnt.address, usdc.address],
        user0.address
      );

    afterClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    afterClaimBalanceWNT = await wnt.balanceOf(user0.address);
    // WNT balance stays the same after claiming
    expect(afterClaimBalanceUSDC).to.eq(preClaimBalanceUSDC);
    expect(afterClaimBalanceWNT).to.eq(preClaimBalanceWNT);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(50 * 1000),
        acceptablePrice: 0,
        orderType: OrderType.MarketDecrease,
        isLong: true,
        referral: user0ReferralCode,
        account: user1, // user1 creates the order with user0's referral code
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)], // Price stays the same
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    expect(await orderStore.getOrderCount()).eq(0);
    expect(await positionStore.getAccountPositionCount(user1.address)).eq(0);

    // Ensure balance of user1 stays the same
    let afterTraderBalanceUSDC = await usdc.balanceOf(user1.address);
    let afterTraderBalanceWNT = await wnt.balanceOf(user1.address);

    expect(initTraderBalanceUSDC).to.eq(afterTraderBalanceUSDC);
    // 100000000000 position fee on increase and decrease
    // All of the rebate goes to trader
    expect(initTraderBalanceWNT.add(initialWNTAmount).sub(100000000000 * 2)).to.eq(afterTraderBalanceWNT);
  });

  it("Rebate is <100% and Discount share is <100%", async () => {
    // User0 is affiliate, User1 is making trades
    // Ensure that affiliate gets 50% of rebate, and User1 loses portion of collateral

    // 0.1% every $50,000
    const FEE_FACTOR = decimalToFloat(2, 8);
    await dataStore.setUint(keys.positionFeeFactorKey(ethUsdMarket.marketToken), FEE_FACTOR);
    await referralStorage.setTier(0, 5000, 5000); // half of total rebate goes to trader's discount

    await expect(referralStorage.connect(user0).registerCode(user0ReferralCode))
      .to.emit(referralStorage, "RegisterCode")
      .withArgs(user0.address, user0ReferralCode);

    let preClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    let preClaimBalanceWNT = await wnt.balanceOf(user0.address);

    await exchangeRouter
      .connect(user0)
      .claimAffiliateRewards(
        [ethUsdMarket.marketToken, ethUsdMarket.marketToken],
        [wnt.address, usdc.address],
        user0.address
      );

    let afterClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    let afterClaimBalanceWNT = await wnt.balanceOf(user0.address);
    expect(afterClaimBalanceUSDC).to.eq(preClaimBalanceUSDC);
    expect(afterClaimBalanceWNT).to.eq(preClaimBalanceWNT);

    const initialWNTAmount = expandDecimals(10, 18);
    let initTraderBalanceUSDC = await usdc.balanceOf(user1.address);
    let initTraderBalanceWNT = await wnt.balanceOf(user1.address);

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: initialWNTAmount,
        sizeDeltaUsd: expandFloatDecimals(50 * 1000),
        acceptablePrice: expandDecimals(5001, 12),
        orderType: OrderType.MarketIncrease,
        isLong: true,
        referral: user0ReferralCode,
        account: user1, // user1 creates the order with user0's referral code
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    // Referral code is set
    let [code, referrer] = await referralStorage.getTraderReferralInfo(user1.address);
    expect(code).to.eq(user0ReferralCode);
    // user1 is using user0's code
    expect(referrer).to.eq(user0.address);
    expect(await positionStore.getAccountPositionCount(user1.address)).eq(1);
    expect(await orderStore.getOrderCount()).eq(0);

    // Referral Awards should not have been changed as entire rebate went to trader's discount
    preClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    preClaimBalanceWNT = await wnt.balanceOf(user0.address);

    await exchangeRouter
      .connect(user0)
      .claimAffiliateRewards(
        [ethUsdMarket.marketToken, ethUsdMarket.marketToken],
        [wnt.address, usdc.address],
        user0.address
      );

    afterClaimBalanceUSDC = await usdc.balanceOf(user0.address);
    afterClaimBalanceWNT = await wnt.balanceOf(user0.address);
    // WNT balance increases after claiming
    expect(afterClaimBalanceUSDC).to.eq(preClaimBalanceUSDC);
    // 200000000000 (position fee) - 100000000000 (rebate pre-discount) - 50000000000 (trader discount)
    expect(afterClaimBalanceWNT).to.eq(preClaimBalanceWNT.add(50000000000));

    await handleOrder(fixture, {
      create: {
        market: ethUsdMarket,
        initialCollateralToken: wnt,
        initialCollateralDeltaAmount: 0,
        sizeDeltaUsd: expandFloatDecimals(50 * 1000),
        acceptablePrice: 0,
        orderType: OrderType.MarketDecrease,
        isLong: true,
        referral: user0ReferralCode,
        account: user1, // user1 creates the order with user0's referral code
      },
      execute: {
        tokens: [wnt.address, usdc.address],
        minPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)], // Price stays the same
        maxPrices: [expandDecimals(5000, 4), expandDecimals(1, 6)],
      },
    });

    expect(await orderStore.getOrderCount()).eq(0);
    expect(await positionStore.getAccountPositionCount(user1.address)).eq(0);

    // Ensure balance of user1 stays the same
    let afterTraderBalanceUSDC = await usdc.balanceOf(user1.address);
    let afterTraderBalanceWNT = await wnt.balanceOf(user1.address);

    expect(initTraderBalanceUSDC).to.eq(afterTraderBalanceUSDC);
    // 100000000000 position fee on increase and decrease
    // 50000000000 affiliate reward on increase and decrease
    expect(
      initTraderBalanceWNT
        .add(initialWNTAmount)
        .sub(100000000000 * 2)
        .sub(50000000000 * 2)
    ).to.eq(afterTraderBalanceWNT);
  });
});
