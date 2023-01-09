import { Address } from "hardhat-deploy/dist/types";
import { hashString, hashData } from "./hash";

export const WNT = hashString("WNT");
export const MAX_LEVERAGE = hashString("MAX_LEVERAGE");

export const MIN_ORACLE_BLOCK_CONFIRMATIONS = hashString("MIN_ORACLE_BLOCK_CONFIRMATIONS");
export const MAX_ORACLE_PRICE_AGE = hashString("MAX_ORACLE_PRICE_AGE");
export const MIN_ORACLE_SIGNERS = hashString("MIN_ORACLE_SIGNERS");

export const FEE_RECEIVER_DEPOSIT_FACTOR = hashString("FEE_RECEIVER_DEPOSIT_FACTOR");
export const FEE_RECEIVER_WITHDRAWAL_FACTOR = hashString("FEE_RECEIVER_WITHDRAWAL_FACTOR");

export const TOKEN_TRANSFER_GAS_LIMIT = hashString("TOKEN_TRANSFER_GAS_LIMIT");
export const NATIVE_TOKEN_TRANSFER_GAS_LIMIT = hashString("NATIVE_TOKEN_TRANSFER_GAS_LIMIT");

export const PRICE_FEED = hashString("PRICE_FEED");
export const PRICE_FEED_MULTIPLIER = hashString("PRICE_FEED_MULTIPLIER");
export const ORACLE_TYPE = hashString("ORACLE_TYPE");
export const RESERVE_FACTOR = hashString("RESERVE_FACTOR");
export const SWAP_FEE_FACTOR = hashString("SWAP_FEE_FACTOR");
export const SWAP_IMPACT_FACTOR = hashString("SWAP_IMPACT_FACTOR");
export const SWAP_IMPACT_EXPONENT_FACTOR = hashString("SWAP_IMPACT_EXPONENT_FACTOR");
export const POSITION_IMPACT_FACTOR = hashString("POSITION_IMPACT_FACTOR");
export const POSITION_IMPACT_EXPONENT_FACTOR = hashString("POSITION_IMPACT_EXPONENT_FACTOR");

export const POSITION_IMPACT_POOL_AMOUNT = hashString("POSITION_IMPACT_POOL_AMOUNT");
export const POOL_AMOUNT = hashString("POOL_AMOUNT");
export const SWAP_IMPACT_POOL_AMOUNT = hashString("SWAP_IMPACT_POOL_AMOUNT");
export const COLLATERAL_SUM = hashString("COLLATERAL_SUM");

export const POSITION_FEE_FACTOR = hashString("POSITION_FEE_FACTOR");
export const FUNDING_FACTOR = hashString("FUNDING_FACTOR");
export const CLAIMABLE_FUNDING_AMOUNT = hashString("CLAIMABLE_FUNDING_AMOUNT");

export const EXECUTE_ORDER_FEATURE = hashString("EXECUTE_ORDER_FEATURE");

export const CUMULATIVE_BORROWING_FACTOR = hashString("CUMULATIVE_BORROWING_FACTOR");
export const IS_ADL_ENABLED = hashString("IS_ADL_ENABLED");

export const MAX_PNL_FACTOR = hashString("MAX_PNL_FACTOR");

export function tokenTransferGasLimit(token) {
  return hashData(["bytes32", "address"], [TOKEN_TRANSFER_GAS_LIMIT, token]);
}

export function priceFeedKey(token) {
  return hashData(["bytes32", "address"], [PRICE_FEED, token]);
}

export function priceFeedMultiplierKey(token) {
  return hashData(["bytes32", "address"], [PRICE_FEED_MULTIPLIER, token]);
}

export function oracleTypeKey(token) {
  return hashData(["bytes32", "address"], [ORACLE_TYPE, token]);
}

export function reserveFactorKey(market, isLong) {
  return hashData(["bytes32", "address", "bool"], [RESERVE_FACTOR, market, isLong]);
}

export function swapFeeFactorKey(market) {
  return hashData(["bytes32", "address"], [SWAP_FEE_FACTOR, market]);
}

export function swapImpactFactorKey(market, isPositive) {
  return hashData(["bytes32", "address", "bool"], [SWAP_IMPACT_FACTOR, market, isPositive]);
}

export function swapImpactExponentFactorKey(market) {
  return hashData(["bytes32", "address"], [SWAP_IMPACT_EXPONENT_FACTOR, market]);
}

export function swapImpactPoolAmountKey(market, token) {
  return hashData(["bytes32", "address", "address"], [SWAP_IMPACT_POOL_AMOUNT, market, token]);
}

export function collateralSumKey(market: Address, token: Address, isLong: boolean) {
  return hashData(["bytes32", "address", "address", "bool"], [COLLATERAL_SUM, market, token, isLong]);
}

export function poolAmountKey(market: Address, token: Address) {
  return hashData(["bytes32", "address", "address"], [POOL_AMOUNT, market, token]);
}

export function positionImpactFactorKey(market, isPositive) {
  return hashData(["bytes32", "address", "bool"], [POSITION_IMPACT_FACTOR, market, isPositive]);
}

export function positionImpactExponentFactorKey(market) {
  return hashData(["bytes32", "address"], [POSITION_IMPACT_EXPONENT_FACTOR, market]);
}

export function positionImpactPoolAmountKey(market) {
  return hashData(["bytes32", "address"], [POSITION_IMPACT_POOL_AMOUNT, market]);
}

export function positionFeeFactorKey(market) {
  return hashData(["bytes32", "address"], [POSITION_FEE_FACTOR, market]);
}

export function executeOrderFeatureKey(orderHandlerAddress, orderType) {
  return hashData(["bytes32", "address", "uint"], [EXECUTE_ORDER_FEATURE, orderHandlerAddress, orderType]);
}

export function cumulativeBorrowingFactorKey(marketAddress, isLong) {
  return hashData(["bytes32", "address", "bool"], [CUMULATIVE_BORROWING_FACTOR, marketAddress, isLong])
}
export function isAdlEnabledKey(market, isLong) {
  return hashData(["bytes32", "address", "bool"], [IS_ADL_ENABLED, market, isLong]);
}

export function maxPnlFactorKey(market, isLong) {
  return hashData(["bytes32", "address", "bool"], [MAX_PNL_FACTOR, market, isLong]);
}

export function fundingFactorKey(market) {
  return hashData(["bytes32", "address"], [FUNDING_FACTOR, market]);
}

export function claimableFundingAmountKey(market, token, account) {
  return hashData(["bytes32", "address", "address", "address"], [CLAIMABLE_FUNDING_AMOUNT, market, token, account]);
}
