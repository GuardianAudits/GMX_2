import { expect } from "chai";

import { deployFixture } from "../../utils/fixture";
import { expandDecimals, expandFloatDecimals } from "../../utils/math";
import { printGasUsage } from "../../utils/gas";
import { handleDeposit } from "../../utils/deposit";
import { OrderType, createOrder } from "../../utils/order";

describe("Exchange.UpdateOrder", () => {
  const { provider } = ethers;

  let fixture;
  let user0, user1;
  let orderStore, exchangeRouter, ethUsdMarket, wnt;
  let executionFee;

  beforeEach(async () => {
    fixture = await deployFixture();
    ({ user0, user1 } = fixture.accounts);
    ({ orderStore, exchangeRouter, ethUsdMarket, wnt } = fixture.contracts);
    ({ executionFee } = fixture.props);

    await handleDeposit(fixture, {
      create: {
        market: ethUsdMarket,
        longTokenAmount: expandDecimals(1000, 18),
      },
    });
  });

  it("updateOrder", async () => {
    expect(await orderStore.getOrderCount()).eq(0);
    const params = {
      market: ethUsdMarket,
      initialCollateralToken: wnt,
      initialCollateralDeltaAmount: expandDecimals(10, 18),
      swapPath: [ethUsdMarket.marketToken],
      sizeDeltaUsd: expandFloatDecimals(200 * 1000),
      triggerPrice: expandDecimals(5000, 12),
      acceptablePrice: expandDecimals(5001, 12),
      executionFee,
      minOutputAmount: expandDecimals(50000, 6),
      orderType: OrderType.LimitIncrease,
      isLong: true,
      shouldUnwrapNativeToken: false,
    };

    await createOrder(fixture, params);

    expect(await orderStore.getOrderCount()).eq(1);

    let block = await provider.getBlock();

    const orderKeys = await orderStore.getOrderKeys(0, 1);
    let order = await orderStore.get(orderKeys[0]);

    expect(order.addresses.account).eq(user0.address);
    expect(order.addresses.market).eq(ethUsdMarket.marketToken);
    expect(order.addresses.initialCollateralToken).eq(wnt.address);
    expect(order.addresses.swapPath).eql([ethUsdMarket.marketToken]);
    expect(order.numbers.sizeDeltaUsd).eq(expandFloatDecimals(200 * 1000));
    expect(order.numbers.initialCollateralDeltaAmount).eq(expandDecimals(10, 18));
    expect(order.numbers.acceptablePrice).eq(expandDecimals(5001, 12));
    expect(order.numbers.triggerPrice).eq(expandDecimals(5000, 12));
    expect(order.numbers.executionFee).eq(expandDecimals(1, 15));
    expect(order.numbers.minOutputAmount).eq(expandDecimals(50000, 6));
    expect(order.numbers.updatedAtBlock).eq(block.number);
    expect(order.flags.orderType).eq(OrderType.LimitIncrease);
    expect(order.flags.isLong).eq(true);
    expect(order.flags.shouldUnwrapNativeToken).eq(false);

    await expect(
      exchangeRouter
        .connect(user1)
        .updateOrder(orderKeys[0], expandFloatDecimals(250 * 1000), expandDecimals(4950, 12), expandDecimals(5050, 12))
    ).to.be.revertedWith("ExchangeRouter: forbidden");

    const txn = await exchangeRouter
      .connect(user0)
      .updateOrder(orderKeys[0], expandFloatDecimals(250 * 1000), expandDecimals(4950, 12), expandDecimals(5050, 12));
    block = await provider.getBlock();

    await printGasUsage(provider, txn, "updateOrder");

    order = await orderStore.get(orderKeys[0]);
    expect(order.addresses.account).eq(user0.address);
    expect(order.addresses.market).eq(ethUsdMarket.marketToken);
    expect(order.addresses.initialCollateralToken).eq(wnt.address);
    expect(order.addresses.swapPath).eql([ethUsdMarket.marketToken]);
    expect(order.numbers.sizeDeltaUsd).eq(expandFloatDecimals(250 * 1000));
    expect(order.numbers.initialCollateralDeltaAmount).eq(expandDecimals(10, 18));
    expect(order.numbers.acceptablePrice).eq(expandDecimals(4950, 12));
    expect(order.numbers.triggerPrice).eq(expandDecimals(5050, 12));
    expect(order.numbers.executionFee).eq(expandDecimals(1, 15));
    expect(order.numbers.minOutputAmount).eq(expandDecimals(50000, 6));
    expect(order.numbers.updatedAtBlock).eq(block.number);
    expect(order.flags.orderType).eq(OrderType.LimitIncrease);
    expect(order.flags.isLong).eq(true);
    expect(order.flags.shouldUnwrapNativeToken).eq(false);
  });
});
