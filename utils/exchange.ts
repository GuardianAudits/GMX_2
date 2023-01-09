import { logGasUsage } from "./gas";
import { getOracleParams } from "./oracle";

export async function executeWithOracleParams(fixture, overrides) {
  const { key, oracleBlockNumber, tokens, tokenOracleTypes, precisions, minPrices, maxPrices, execute, gasUsageLabel } =
    overrides;
  const { provider } = ethers;
  const { signers } = fixture.accounts;
  const { oracleSalt, signerIndexes } = fixture.props;

  const block = await provider.getBlock(oracleBlockNumber.toNumber());

  const oracleParams = await getOracleParams({
    oracleSalt,
    oracleBlockNumbers: Array(tokens.length).fill(block.number, 0, tokens.length),
    oracleTimestamps: Array(tokens.length).fill(block.timestamp, 0, tokens.length),
    blockHashes: Array(tokens.length).fill(block.hash, 0, tokens.length),
    signerIndexes,
    tokens,
    tokenOracleTypes,
    precisions,
    minPrices,
    maxPrices,
    signers,
    priceFeedTokens: overrides.priceFeedTokens || [],
  });

  await logGasUsage({
    tx: execute(key, oracleParams),
    label: gasUsageLabel,
  });
}

export async function executeLimitWithOracleParams(fixture, overrides) {
  const { key, firstOracleBlockNumber, secondOracleBlockNumber, tokens, tokenOracleTypes, precisions, minPrices, maxPrices, execute, gasUsageLabel } =
    overrides;
  const { provider } = ethers;
  const { signers } = fixture.accounts;
  const { oracleSalt, signerIndexes } = fixture.props;

  const firstBlock = await provider.getBlock(firstOracleBlockNumber.toNumber());
  const secondBlock = await provider.getBlock(secondOracleBlockNumber.toNumber());

  const oracleParams = await getOracleParams({
    oracleSalt,
    oracleBlockNumbers: Array(tokens.length*2).fill(firstOracleBlockNumber, 0, tokens.length).fill(secondOracleBlockNumber, tokens.length, tokens.length*2),
    oracleTimestamps: Array(tokens.length*2).fill(firstBlock.timestamp, 0, tokens.length).fill(secondBlock.timestamp, tokens.length, tokens.length*2),
    blockHashes: Array(tokens.length*2).fill(firstBlock.hash, 0, tokens.length).fill(secondBlock.hash, tokens.length, tokens.length*2),
    signerIndexes,
    tokens: [...tokens, ...tokens],
    tokenOracleTypes: [...tokenOracleTypes, ...tokenOracleTypes],
    precisions: [...precisions, ...precisions],
    minPrices,
    maxPrices,
    signers: [...signers],
    priceFeedTokens: overrides.priceFeedTokens || [],
  });

  await logGasUsage({
    tx: execute(key, oracleParams),
    label: gasUsageLabel,
  });
}
