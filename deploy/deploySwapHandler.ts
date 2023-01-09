import { HardhatRuntimeEnvironment } from "hardhat/types";
import {hashString} from "../utils/hash";

const func = async ({ getNamedAccounts, deployments }: HardhatRuntimeEnvironment) => {
  const { deploy, get, execute } = deployments;
  const { deployer } = await getNamedAccounts();

  const roleStore = await get("RoleStore");

  const { address, newlyDeployed } = await deploy("SwapHandler", {
    from: deployer,
    log: true,
    args: [roleStore.address],
  });

  if (newlyDeployed) {
    await execute("RoleStore", {from: deployer, log: true}, "grantRole", address, hashString("CONTROLLER"));
  }
};
func.tags = ["SwapHandler"];
func.dependencies = ["RoleStore"];
export default func;
