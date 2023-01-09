import { HardhatRuntimeEnvironment } from "hardhat/types";

const func = async ({ getNamedAccounts, deployments }: HardhatRuntimeEnvironment) => {
  const { deploy, get } = deployments;
  const { deployer } = await getNamedAccounts();

  const roleStore = await get("RoleStore");
  const dataStore = await get("DataStore");

  await deploy("DepositStore", {
    from: deployer,
    log: true,
    args: [roleStore.address, dataStore.address],
  });
};
func.tags = ["DepositStore"];
func.dependencies = ["RoleStore", "DataStore"];
export default func;
