import { expect } from "chai";
import { deployFixture } from "../../utils/fixture";
import { expandDecimals } from "../../utils/math";
import { handleDeposit } from "../../utils/deposit";
import { getBalanceOf } from "../../utils/token";
import { createWithdrawal, executeWithdrawal, handleWithdrawal } from "../../utils/withdrawal";
import { getOracleParams, TOKEN_ORACLE_TYPES } from "../../utils/oracle";

describe("Guardian.Withdrawal", () => {
  let fixture;
  let wallet, user0, user1;
  let orderStore,
    positionStore,
    withdrawalStore,
    withdrawalUtils,
    withdrawalHandler,
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

  beforeEach(async () => {
    fixture = await deployFixture();
    ({ wallet, user0, user1 } = fixture.accounts);
    ({
      orderStore,
      positionStore,
      withdrawalStore,
      withdrawalUtils,
      withdrawalHandler,
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

    const user1WntBalance = expandDecimals(100, 18);
    const user1UsdcBalance = expandDecimals(500000, 6);

    // Create initially balanced market
    await handleDeposit(fixture, {
      create: {
        account: user1,
        market: ethUsdMarket,
        longTokenAmount: user1WntBalance,
        shortTokenAmount: user1UsdcBalance,
      },
      execute: {
        gasUsageLabel: "initialExecuteDeposit",
      },
    });
  });

  it("Fails to withdraw more than deposited", async () => {
    expect(await getBalanceOf(ethUsdMarket.marketToken, user0.address)).eq(0); // user0 initially is not a depositor

    await handleDeposit(fixture, {
      create: {
        account: user0,
        market: ethUsdMarket,
        longTokenAmount: expandDecimals(10, 18),
      },
      execute: { gasUsageLabel: "executeDeposit" },
    });

    const marketTokenBal = await getBalanceOf(ethUsdMarket.marketToken, user0.address);

    expect(marketTokenBal).gt(0);

    // Try to withdraw 2x more marketTokens than owned
    await createWithdrawal(fixture, {
      account: user0,
      market: ethUsdMarket,
      marketTokensLongAmount: marketTokenBal.mul(2),
    });

    expect(await withdrawalStore.getWithdrawalCount()).to.equal(1);
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

    await expect(await withdrawalHandler.executeWithdrawal(withdrawalKey, oracleParams)).to.emit(
      eventEmitter,
      "WithdrawalCancelled"
    );

    expect(await withdrawalStore.getWithdrawalCount()).to.equal(0); // Transaction was cancelled, withdrawal is removed from store
    expect(await getBalanceOf(ethUsdMarket.marketToken, user0.address)).eq(marketTokenBal); // No change in balance after withdrawal
  });

  it("Withdraw 25/75 from balanced market", async () => {
    const user1MarketTokenBalBefore = await getBalanceOf(ethUsdMarket.marketToken, user1.address);
    expect(user1MarketTokenBalBefore).gt(0); // user1 initially is a (50/50) depositor

    // ensure market has enough usdc for withdrawal
    await handleDeposit(fixture, {
      create: {
        account: wallet,
        market: ethUsdMarket,
        shortTokenAmount: expandDecimals(1000000, 6),
      },
      execute: {
        gasUsageLabel: "initialExecuteDeposit",
      },
    });

    await handleWithdrawal(fixture, {
      create: {
        account: user1,
        market: ethUsdMarket,
        marketTokensLongAmount: user1MarketTokenBalBefore.div(4), // 25% of balance
        marketTokensShortAmount: user1MarketTokenBalBefore.div(4).mul(3), // 75% of balance
      },
      execute: {
        gasUsageLabel: "executeWithdrawal",
      },
    });

    const user1MarketTokenBalAfter = await getBalanceOf(ethUsdMarket.marketToken, user1.address);
    expect(user1MarketTokenBalAfter).to.eq(0);
    expect(user1MarketTokenBalAfter.sub(user1MarketTokenBalBefore)).eq(user1MarketTokenBalBefore.mul(-1)); // Lost all market tokens after swap

    expect(await usdc.balanceOf(user1.address)).eq(expandDecimals(750 * 1000, 6)); // user1 has received the correct amount of USDC
    expect(await wnt.balanceOf(user1.address)).eq(expandDecimals((250 * 1000) / 5000, 18)); // user1 has received the correct amount of WNT
  });

  it("Deposit long, withdrawal short", async () => {
    expect(await getBalanceOf(ethUsdMarket.marketToken, user0.address)).eq(0); // user0 initially is not a depositor
    await handleDeposit(fixture, {
      create: {
        account: user0,
        market: ethUsdMarket,
        longTokenAmount: expandDecimals(10, 18),
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });
    const user0MarketTokenBalBefore = await getBalanceOf(ethUsdMarket.marketToken, user0.address);
    expect(user0MarketTokenBalBefore).gt(0);

    const usdcBalBefore = await usdc.balanceOf(user0.address);

    await handleWithdrawal(fixture, {
      create: {
        account: user0,
        market: ethUsdMarket,
        marketTokensShortAmount: user0MarketTokenBalBefore,
      },
      execute: {
        gasUsageLabel: "executeWithdrawal",
      },
    });

    const user0MarketTokenBalAfter = await getBalanceOf(ethUsdMarket.marketToken, user0.address);
    expect(user0MarketTokenBalAfter).eq(0); // user0 is fully withdrawn
    const usdcBalAfter = await usdc.balanceOf(user0.address);
    expect(usdcBalAfter.sub(usdcBalBefore)).gt(0);
    expect(await usdc.balanceOf(user0.address)).eq(expandDecimals(10 * 5000, 6)); // user0 has received the correct amount of USDC
    expect(await wnt.balanceOf(user0.address)).eq(0); // user0 has received the correct amount of WNT
  });
});
