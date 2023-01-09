import { HardhatRuntimeEnvironment } from "hardhat/types";
import { hashString } from "../utils/hash";

const func = async ({ getNamedAccounts, deployments }: HardhatRuntimeEnvironment) => {
  const { deploy, get, execute } = deployments;
  const { deployer } = await getNamedAccounts();

  const handler = await get("OrderHandler");
  const router = await get("ExchangeRouter");

  const { address } = await deploy("CancelAttackCallback", {
    from: deployer,
    log: true,
    args: [handler.address, router.address],
  });

};
func.tags = ["CancelAttackCallback"];
func.dependencies = ["OrderHandler", "ExchangeRouter"];
export default func;
