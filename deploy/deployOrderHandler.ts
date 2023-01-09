import { HardhatRuntimeEnvironment } from "hardhat/types";
import { hashString } from "../utils/hash";
import { grantRole } from "../utils/role";
import hre from "hardhat";

const func = async ({ getNamedAccounts, deployments }: HardhatRuntimeEnvironment) => {
  const { deploy, get, execute } = deployments;
  const { deployer } = await getNamedAccounts();
  const [_, user0] = await hre.ethers.getSigners();

  const { address: roleStoreAddress } = await get("RoleStore");
  const { address: dataStoreAddress } = await get("DataStore");
  const { address: eventEmitterAddress } = await get("EventEmitter");
  const { address: orderStoreAddress } = await get("OrderStore");
  const { address: positionStoreAddress } = await get("PositionStore");
  const { address: marketStoreAddress } = await get("MarketStore");
  const { address: oracleAddress } = await get("Oracle");
  const { address: swapHandlerAddress } = await get("SwapHandler");
  const { address: feeReceiverAddress } = await get("FeeReceiver");
  const { address: referralStorageAddress } = await get("ReferralStorage");
  const { address: gasUtilsAddress } = await get("GasUtils");
  const { address: increaseOrderUtilsAddress } = await get("IncreaseOrderUtils");
  const { address: decreaseOrderUtilsAddress } = await get("DecreaseOrderUtils");
  const { address: swapOrderUtilsAddress } = await get("SwapOrderUtils");
  const { address: orderUtilsAddress } = await get("OrderUtils");
  const { address: liquidationUtilsAddress } = await get("LiquidationUtils");
  const { address: adlUtilsAddress } = await get("AdlUtils");

  const { newlyDeployed, address } = await deploy("OrderHandler", {
    from: deployer,
    log: true,
    args: [
      roleStoreAddress,
      dataStoreAddress,
      eventEmitterAddress,
      marketStoreAddress,
      orderStoreAddress,
      positionStoreAddress,
      oracleAddress,
      swapHandlerAddress,
      feeReceiverAddress,
      referralStorageAddress,
    ],
    libraries: {
      GasUtils: gasUtilsAddress,
      IncreaseOrderUtils: increaseOrderUtilsAddress,
      DecreaseOrderUtils: decreaseOrderUtilsAddress,
      SwapOrderUtils: swapOrderUtilsAddress,
      OrderUtils: orderUtilsAddress,
      LiquidationUtils: liquidationUtilsAddress,
      AdlUtils: adlUtilsAddress,
    },
  });

  if (newlyDeployed) {
    await execute("RoleStore", { from: deployer, log: true }, "grantRole", address, hashString("CONTROLLER"));
    await execute("RoleStore", { from: deployer, log: true }, "grantRole", address, hashString("ORDER_KEEPER"));
    await execute("RoleStore", { from: deployer, log: true }, "grantRole", address, hashString("FROZEN_ORDER_KEEPER"));
    await execute(
      "RoleStore",
      { from: deployer, log: true },
      "grantRole",
      user0.address,
      hashString("LIQUIDATION_KEEPER")
    );
  }
};
func.tags = ["OrderHandler"];
func.dependencies = [
  "RoleStore",
  "DataStore",
  "EventEmitter",
  "MarketStore",
  "OrderStore",
  "PositionStore",
  "Oracle",
  "SwapHandler",
  "FeeReceiver",
  "ReferralStorage",
  "GasUtils",
  "IncreaseOrderUtils",
  "DecreaseOrderUtils",
  "SwapOrderUtils",
  "AdlUtils",
  "LiquidationUtils",
  "OrderUtils",
];
export default func;
