import { HardhatRuntimeEnvironment } from "hardhat/types";
import { hashString } from "../utils/hash";

const func = async ({ getNamedAccounts, deployments }: HardhatRuntimeEnvironment) => {
  const { deploy, get, execute } = deployments;
  const { deployer } = await getNamedAccounts();

  const { address } = await deploy("ToggleAcceptContract", {
    from: deployer,
    log: true,
    args: [],
  });
};
func.tags = ["ToggleAcceptContract"];
func.dependencies = [];
export default func;
