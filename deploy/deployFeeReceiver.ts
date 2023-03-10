import { HardhatRuntimeEnvironment } from "hardhat/types";

const func = async ({ getNamedAccounts, deployments }: HardhatRuntimeEnvironment) => {
  const { deploy, get } = deployments;
  const { deployer } = await getNamedAccounts();

  const roleStore = await get("RoleStore");
  const dataStore = await get("DataStore");

  await deploy("FeeReceiver", {
    from: deployer,
    log: true,
    args: [roleStore.address, dataStore.address],
  });
};
func.tags = ["FeeReceiver"];
func.dependencies = ["RoleStore", "DataStore"];
export default func;
