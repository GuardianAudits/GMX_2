import { HardhatRuntimeEnvironment } from "hardhat/types";

const func = async ({ getNamedAccounts, deployments }: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  await deploy("MarketUtils", {
    from: deployer,
    log: true,
  });
};
func.tags = ["MarketUtils"];
export default func;
