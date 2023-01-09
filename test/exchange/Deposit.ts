import { expect } from "chai";

import { deployFixture } from "../../utils/fixture";
import { expandDecimals, decimalToFloat } from "../../utils/math";
import { getBalanceOf } from "../../utils/token";
import { getMarketTokenPrice } from "../../utils/market";
import { createDeposit, executeDeposit, handleDeposit } from "../../utils/deposit";
import * as keys from "../../utils/keys";

describe("Exchange.Deposit", () => {
  const { provider } = ethers;

  let fixture;
  let user0, user1, user2;
  let feeReceiver, reader, dataStore, depositStore, ethUsdMarket, wnt, usdc;

  beforeEach(async () => {
    fixture = await deployFixture();

    ({ user0, user1, user2 } = fixture.accounts);
    ({ feeReceiver, reader, dataStore, depositStore, ethUsdMarket, wnt, usdc } = fixture.contracts);
  });

  it("createDeposit", async () => {
    await createDeposit(fixture, {
      receiver: user1,
      callbackContract: user2,
      market: ethUsdMarket,
      longTokenAmount: expandDecimals(10, 18),
      shortTokenAmount: expandDecimals(10 * 5000, 6),
      minMarketTokens: 100,
      shouldUnwrapNativeToken: true,
      executionFee: "500",
      callbackGasLimit: "200000",
      gasUsageLabel: "createDeposit",
    });

    const block = await provider.getBlock();
    const depositKeys = await depositStore.getDepositKeys(0, 1);
    const deposit = await depositStore.get(depositKeys[0]);

    expect(deposit.addresses.account).eq(user0.address);
    expect(deposit.addresses.receiver).eq(user1.address);
    expect(deposit.addresses.callbackContract).eq(user2.address);
    expect(deposit.addresses.market).eq(ethUsdMarket.marketToken);
    expect(deposit.numbers.longTokenAmount).eq(expandDecimals(10, 18));
    expect(deposit.numbers.shortTokenAmount).eq(expandDecimals(10 * 5000, 6));
    expect(deposit.numbers.minMarketTokens).eq(100);
    expect(deposit.numbers.updatedAtBlock).eq(block.number);
    expect(deposit.numbers.executionFee).eq("500");
    expect(deposit.numbers.callbackGasLimit).eq("200000");
    expect(deposit.flags.shouldUnwrapNativeToken).eq(true);
  });

  it("executeDeposit", async () => {
    await createDeposit(fixture, {
      receiver: user1,
      market: ethUsdMarket,
      longTokenAmount: expandDecimals(10, 18),
      shortTokenAmount: expandDecimals(9 * 5000, 6),
      minMarketTokens: 100,
      gasUsageLabel: "createDeposit",
    });

    const depositKeys = await depositStore.getDepositKeys(0, 1);
    let deposit = await depositStore.get(depositKeys[0]);

    expect(deposit.addresses.account).eq(user0.address);
    expect(await depositStore.getDepositCount()).eq(1);

    await executeDeposit(fixture, { gasUsageLabel: "executeDeposit" });

    deposit = await depositStore.get(depositKeys[0]);

    expect(deposit.addresses.account).eq(ethers.constants.AddressZero);
    expect(await getBalanceOf(ethUsdMarket.marketToken, user1.address)).eq(expandDecimals(95000, 18));
    expect(await depositStore.getDepositCount()).eq(0);
  });

  it("price impact", async () => {
    // set price impact to 0.1% for every $50,000 of token imbalance
    // 0.1% => 0.001
    // 0.001 / 50,000 => 2 * (10 ** -8)
    await dataStore.setUint(keys.swapImpactFactorKey(ethUsdMarket.marketToken, true), decimalToFloat(2, 8));
    await dataStore.setUint(keys.swapImpactFactorKey(ethUsdMarket.marketToken, false), decimalToFloat(2, 8));
    await dataStore.setUint(keys.swapImpactExponentFactorKey(ethUsdMarket.marketToken), decimalToFloat(2, 0));

    expect(await getBalanceOf(ethUsdMarket.marketToken, user0.address)).eq(0);
    expect(await wnt.balanceOf(depositStore.address)).eq(0);
    expect(await usdc.balanceOf(depositStore.address)).eq(0);

    expect(await wnt.balanceOf(ethUsdMarket.marketToken)).eq(0);
    expect(await usdc.balanceOf(ethUsdMarket.marketToken)).eq(0);
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(0);
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address)).eq(0);

    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        longTokenAmount: expandDecimals(10, 18),
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });

    expect(await depositStore.getDepositCount()).eq(0);
    expect(await getMarketTokenPrice(fixture)).eq(expandDecimals(1, 30));

    expect(await getBalanceOf(ethUsdMarket.marketToken, user0.address)).eq("49975000000000000000000");
    expect(await wnt.balanceOf(depositStore.address)).eq(0);
    expect(await usdc.balanceOf(depositStore.address)).eq(0);

    expect(await wnt.balanceOf(ethUsdMarket.marketToken)).eq(expandDecimals(10, 18));
    expect(await usdc.balanceOf(ethUsdMarket.marketToken)).eq(0);
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "9995000000000000000"
    );
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address)).eq(0);
    expect(await reader.getSwapImpactPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "5000000000000000" // 0.005 ETH, 25 USD
    );

    expect(await getBalanceOf(ethUsdMarket.marketToken, user1.address)).eq(0);

    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        shortTokenAmount: expandDecimals(49975, 6),
        receiver: user1,
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });

    expect(await getMarketTokenPrice(fixture)).eq(expandDecimals(1, 30));

    expect(await getBalanceOf(ethUsdMarket.marketToken, user1.address)).eq("49999975006249999995000"); // 49999.975006249999995
  });

  it("positive and negative price impact", async () => {
    // set negative price impact to 0.1% for every $50,000 of token imbalance
    // 0.1% => 0.001
    // 0.001 / 50,000 => 2 * (10 ** -8)
    // set positive price impact to 0.05% for every $50,000 of token imbalance
    // 0.05% => 0.0005
    // 0.0005 / 50,000 => 1 * (10 ** -8)
    await dataStore.setUint(keys.swapImpactFactorKey(ethUsdMarket.marketToken, false), decimalToFloat(2, 8));
    await dataStore.setUint(keys.swapImpactFactorKey(ethUsdMarket.marketToken, true), decimalToFloat(1, 8));
    await dataStore.setUint(keys.swapImpactExponentFactorKey(ethUsdMarket.marketToken), decimalToFloat(2, 0));

    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        longTokenAmount: expandDecimals(10, 18),
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });

    expect(await getMarketTokenPrice(fixture)).eq(expandDecimals(1, 30));

    expect(await getBalanceOf(ethUsdMarket.marketToken, user0.address)).eq("49975000000000000000000");
    expect(await wnt.balanceOf(depositStore.address)).eq(0);
    expect(await usdc.balanceOf(depositStore.address)).eq(0);

    expect(await wnt.balanceOf(ethUsdMarket.marketToken)).eq(expandDecimals(10, 18));
    expect(await usdc.balanceOf(ethUsdMarket.marketToken)).eq(0);
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "9995000000000000000"
    );
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address)).eq(0);
    expect(await reader.getSwapImpactPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "5000000000000000" // 0.005 ETH, 25 USD
    );

    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        shortTokenAmount: expandDecimals(49975, 6),
        receiver: user1,
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });

    expect(await getMarketTokenPrice(fixture)).eq(expandDecimals(1, 30));

    expect(await getBalanceOf(ethUsdMarket.marketToken, user1.address)).eq("49987487503124999995000"); // 49987.487503124999995
  });

  it("price impact split over multiple orders", async () => {
    // set negative price impact to 0.1% for every $50,000 of token imbalance
    // 0.1% => 0.001
    // 0.001 / 50,000 => 2 * (10 ** -8)
    // set positive price impact to 0.05% for every $50,000 of token imbalance
    // 0.05% => 0.0005
    // 0.0005 / 50,000 => 1 * (10 ** -8)
    await dataStore.setUint(keys.swapImpactFactorKey(ethUsdMarket.marketToken, false), decimalToFloat(2, 8));
    await dataStore.setUint(keys.swapImpactFactorKey(ethUsdMarket.marketToken, true), decimalToFloat(1, 8));
    await dataStore.setUint(keys.swapImpactExponentFactorKey(ethUsdMarket.marketToken), decimalToFloat(2, 0));

    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        longTokenAmount: expandDecimals(5, 18),
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });

    expect(await getMarketTokenPrice(fixture)).eq(expandDecimals(1, 30));

    expect(await getBalanceOf(ethUsdMarket.marketToken, user0.address)).eq("24993750000000000000000");
    expect(await wnt.balanceOf(depositStore.address)).eq(0);
    expect(await usdc.balanceOf(depositStore.address)).eq(0);

    expect(await wnt.balanceOf(ethUsdMarket.marketToken)).eq(expandDecimals(5, 18));
    expect(await usdc.balanceOf(ethUsdMarket.marketToken)).eq(0);
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "4998750000000000000" // 4.99875
    );
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address)).eq(0);
    expect(await reader.getSwapImpactPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "1250000000000000" // 0.00125 ETH, 6.25 USD
    );

    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        longTokenAmount: expandDecimals(5, 18),
        receiver: user1,
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });

    expect(await getMarketTokenPrice(fixture)).eq(expandDecimals(1, 30));

    expect(await getBalanceOf(ethUsdMarket.marketToken, user1.address)).eq("24981253125000000000000"); // 24981.253125

    expect(await wnt.balanceOf(ethUsdMarket.marketToken)).eq(expandDecimals(10, 18));
    expect(await usdc.balanceOf(ethUsdMarket.marketToken)).eq(0);
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "9995000625000000000" // 9.995000625
    );
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address)).eq(0);
    expect(await reader.getSwapImpactPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "4999375000000000" // 0.004999375 ETH, 24.996875 USD
    );

    // increase positive price impact to 0.2% for every $50,000 of token imbalance
    // 0.2% => 0.002
    // 0.002 / 50,000 => 4 * (10 ** -8)
    await dataStore.setUint(keys.swapImpactFactorKey(ethUsdMarket.marketToken, true), decimalToFloat(4, 8));
    await dataStore.setUint(keys.swapImpactExponentFactorKey(ethUsdMarket.marketToken), decimalToFloat(2, 0));

    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        shortTokenAmount: expandDecimals(50000, 6),
        receiver: user2,
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });

    expect(await getMarketTokenPrice(fixture)).eq(expandDecimals(1, 30));

    expect(await getBalanceOf(ethUsdMarket.marketToken, user2.address)).eq("50024996875000000000000"); // 50024.996875

    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      expandDecimals(10, 18)
    );
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address)).eq(
      expandDecimals(50 * 1000, 6)
    );
    expect(await reader.getSwapImpactPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(0);
  });

  it("!isSameSideRebalance, net negative price impact", async () => {
    // set negative price impact to 0.1% for every $50,000 of token imbalance
    // 0.1% => 0.001
    // 0.001 / 50,000 => 2 * (10 ** -8)
    // set positive price impact to 0.05% for every $50,000 of token imbalance
    // 0.05% => 0.0005
    // 0.0005 / 50,000 => 1 * (10 ** -8)
    await dataStore.setUint(keys.swapImpactFactorKey(ethUsdMarket.marketToken, false), decimalToFloat(2, 8));
    await dataStore.setUint(keys.swapImpactFactorKey(ethUsdMarket.marketToken, true), decimalToFloat(1, 8));
    await dataStore.setUint(keys.swapImpactExponentFactorKey(ethUsdMarket.marketToken), decimalToFloat(2, 0));

    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        longTokenAmount: expandDecimals(10, 18),
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });

    expect(await getMarketTokenPrice(fixture)).eq(expandDecimals(1, 30));

    expect(await getBalanceOf(ethUsdMarket.marketToken, user0.address)).eq("49975000000000000000000");
    expect(await wnt.balanceOf(depositStore.address)).eq(0);
    expect(await usdc.balanceOf(depositStore.address)).eq(0);

    expect(await wnt.balanceOf(ethUsdMarket.marketToken)).eq(expandDecimals(10, 18));
    expect(await usdc.balanceOf(ethUsdMarket.marketToken)).eq(0);
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "9995000000000000000"
    );
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address)).eq(0);
    expect(await reader.getSwapImpactPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "5000000000000000" // 0.005 ETH, 25 USD
    );

    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        shortTokenAmount: expandDecimals(100 * 1000, 6),
        receiver: user1,
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });

    expect(await getMarketTokenPrice(fixture)).eq(expandDecimals(1, 30));
    expect(await getBalanceOf(ethUsdMarket.marketToken, user1.address)).eq("99987462496000000000000"); // 99987.462496

    expect(await wnt.balanceOf(ethUsdMarket.marketToken)).eq(expandDecimals(10, 18));
    expect(await usdc.balanceOf(ethUsdMarket.marketToken)).eq(expandDecimals(100 * 1000, 6));
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "9995000000000000000"
    );
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address)).eq("99987462496"); // 99987.462496
    expect(await reader.getSwapImpactPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "5000000000000000" // 0.005 ETH, 25 USD
    );
    // 12.5 USD positive price impact, 25 USD negative price impact
    // net ~12.5 USD negative price impact
    expect(await reader.getSwapImpactPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address)).eq(
      "12537504" // 12.537504
    );
  });

  it("!isSameSideRebalance, net positive price impact", async () => {
    // set negative price impact to 0.1% for every $50,000 of token imbalance
    // 0.1% => 0.001
    // 0.001 / 50,000 => 2 * (10 ** -8)
    // set positive price impact to 0.05% for every $50,000 of token imbalance
    // 0.05% => 0.0005
    // 0.0005 / 50,000 => 1 * (10 ** -8)
    await dataStore.setUint(keys.swapImpactFactorKey(ethUsdMarket.marketToken, false), decimalToFloat(2, 8));
    await dataStore.setUint(keys.swapImpactFactorKey(ethUsdMarket.marketToken, true), decimalToFloat(1, 8));
    await dataStore.setUint(keys.swapImpactExponentFactorKey(ethUsdMarket.marketToken), decimalToFloat(2, 0));

    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        longTokenAmount: expandDecimals(10, 18),
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });

    expect(await getMarketTokenPrice(fixture)).eq(expandDecimals(1, 30));

    expect(await getBalanceOf(ethUsdMarket.marketToken, user0.address)).eq("49975000000000000000000");
    expect(await wnt.balanceOf(depositStore.address)).eq(0);
    expect(await usdc.balanceOf(depositStore.address)).eq(0);

    expect(await wnt.balanceOf(ethUsdMarket.marketToken)).eq(expandDecimals(10, 18));
    expect(await usdc.balanceOf(ethUsdMarket.marketToken)).eq(0);
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "9995000000000000000"
    );
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address)).eq(0);
    expect(await reader.getSwapImpactPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "5000000000000000" // 0.005 ETH, 25 USD
    );

    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        shortTokenAmount: expandDecimals(60 * 1000, 6),
        receiver: user1,
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });

    expect(await getMarketTokenPrice(fixture)).eq(expandDecimals(1, 30));
    expect(await getBalanceOf(ethUsdMarket.marketToken, user1.address)).eq("60011482496874999995000"); // 60011.482496875

    expect(await wnt.balanceOf(ethUsdMarket.marketToken)).eq(expandDecimals(10, 18));
    expect(await usdc.balanceOf(ethUsdMarket.marketToken)).eq(expandDecimals(60 * 1000, 6));
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "9997296499374999999" // 9.997296499375
    );
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address)).eq("60000000000"); // 60,000
    expect(await reader.getSwapImpactPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "2703500625000001" // 0.002703500625 ETH, ~13.51 USD
    );
    expect(await reader.getSwapImpactPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address)).eq(0);
  });

  it("price impact, fees", async () => {
    // 0.05%: 0.0005
    await dataStore.setUint(keys.swapFeeFactorKey(ethUsdMarket.marketToken), decimalToFloat(5, 4));
    // 30%
    await dataStore.setUint(keys.FEE_RECEIVER_DEPOSIT_FACTOR, decimalToFloat(3, 1));

    // set negative price impact to 0.1% for every $50,000 of token imbalance
    // 0.1% => 0.001
    // 0.001 / 50,000 => 2 * (10 ** -8)
    // set positive price impact to 0.05% for every $50,000 of token imbalance
    // 0.05% => 0.0005
    // 0.0005 / 50,000 => 1 * (10 ** -8)
    await dataStore.setUint(keys.swapImpactFactorKey(ethUsdMarket.marketToken, false), decimalToFloat(2, 8));
    await dataStore.setUint(keys.swapImpactFactorKey(ethUsdMarket.marketToken, true), decimalToFloat(1, 8));
    await dataStore.setUint(keys.swapImpactExponentFactorKey(ethUsdMarket.marketToken), decimalToFloat(2, 0));

    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        longTokenAmount: expandDecimals(10, 18),
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });

    expect(await getMarketTokenPrice(fixture)).eq("1000350350350350350350350350350"); // 1.00035035035

    expect(await getBalanceOf(ethUsdMarket.marketToken, user0.address)).eq("49950000000000000000000"); // 49950
    expect(await wnt.balanceOf(depositStore.address)).eq(0);
    expect(await usdc.balanceOf(depositStore.address)).eq(0);
    expect(await wnt.balanceOf(feeReceiver.address)).eq("1500000000000000"); // 0.0015 ETH, 7.5 USD
    expect(await usdc.balanceOf(feeReceiver.address)).eq(0);

    expect(await wnt.balanceOf(ethUsdMarket.marketToken)).eq("9998500000000000000"); // 9.9985 ETH
    expect(await usdc.balanceOf(ethUsdMarket.marketToken)).eq(0);
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "9993500000000000000" // 9.9935 ETH
    );
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address)).eq(0);
    expect(await reader.getSwapImpactPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "5000000000000000" // 0.005 ETH, 25 USD
    );

    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        shortTokenAmount: expandDecimals(49975, 6),
        receiver: user1,
      },
      execute: {
        gasUsageLabel: "executeDeposit",
      },
    });

    expect(await getMarketTokenPrice(fixture)).eq("1000525446705012120185491696460"); // ~1.00052

    expect(await getBalanceOf(ethUsdMarket.marketToken, user1.address)).eq("49944998007168690894085"); // 49944.998
    expect(await wnt.balanceOf(ethUsdMarket.marketToken)).eq("9998500000000000000"); // 9.9985 ETH
    expect(await usdc.balanceOf(ethUsdMarket.marketToken)).eq("49967503750"); // 49967.50375 USDC
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "9995996750943749999" // 9.996 ETH
    );
    expect(await reader.getPoolAmount(dataStore.address, ethUsdMarket.marketToken, usdc.address)).eq("49967503750"); // 49967.50375 USDC
    expect(await reader.getSwapImpactPoolAmount(dataStore.address, ethUsdMarket.marketToken, wnt.address)).eq(
      "2503249056250001" // 0.0025, 12.5 USD
    );
  });
});
