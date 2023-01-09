import { expect } from "chai";

import { deployContract } from "../../utils/deploy";
import { deployFixture } from "../../utils/fixture";
import {
  TOKEN_ORACLE_TYPES,
  signPrices,
  getSignerInfo,
  getCompactedPrices,
  getCompactedPriceIndexes,
  getCompactedDecimals,
  getCompactedOracleBlockNumbers,
  getCompactedOracleTimestamps,
} from "../../utils/oracle";
import { printGasUsage } from "../../utils/gas";
import { grantRole } from "../../utils/role";
import * as keys from "../../utils/keys";

describe("Oracle", () => {
  const { provider } = ethers;

  let user0, signer0, signer1, signer2, signer3, signer4, signer7, signer9;
  let roleStore, dataStore, eventEmitter, oracleStore, oracle, wnt, wbtc, usdc;
  let oracleSalt;

  beforeEach(async () => {
    const fixture = await deployFixture();
    ({ user0, signer0, signer1, signer2, signer3, signer4, signer7, signer9 } = fixture.accounts);

    ({ roleStore, dataStore, eventEmitter, oracleStore, oracle, wnt, wbtc, usdc } = fixture.contracts);
    ({ oracleSalt } = fixture.props);
  });

  it("inits", async () => {
    expect(await oracle.oracleStore()).to.eq(oracleStore.address);
    expect(await oracle.SALT()).to.eq(oracleSalt);
  });

  it("setPrices", async () => {
    await expect(
      oracle.connect(user0).setPrices(dataStore.address, eventEmitter.address, {
        signerInfo: 2,
        tokens: [],
        compactedOracleBlockNumbers: [],
        compactedOracleTimestamps: [],
        compactedDecimals: [],
        compactedMinPrices: [],
        compactedMinPricesIndexes: [],
        compactedMaxPrices: [],
        compactedMaxPricesIndexes: [],
        signatures: [],
        priceFeedTokens: [],
      })
    )
      .to.be.revertedWithCustomError(oracle, "Unauthorized")
      .withArgs(user0.address, "CONTROLLER");

    await expect(
      oracle.setPrices(dataStore.address, eventEmitter.address, {
        signerInfo: 2,
        tokens: [],
        compactedOracleBlockNumbers: [],
        compactedOracleTimestamps: [],
        compactedDecimals: [],
        compactedMinPrices: [],
        compactedMinPricesIndexes: [],
        compactedMaxPrices: [],
        compactedMaxPricesIndexes: [],
        signatures: [],
        priceFeedTokens: [],
      })
    ).to.be.revertedWithCustomError(oracle, "EmptyTokens");

    const blockNumber = (await provider.getBlock()).number;
    const blockTimestamp = (await provider.getBlock()).timestamp;

    await expect(
      oracle.setPrices(dataStore.address, eventEmitter.address, {
        signerInfo: 0,
        tokens: [wnt.address],
        compactedOracleBlockNumbers: [blockNumber + 10],
        compactedOracleTimestamps: [blockTimestamp],
        compactedDecimals: [],
        compactedMinPrices: [],
        compactedMinPricesIndexes: [],
        compactedMaxPrices: [],
        compactedMaxPricesIndexes: [],
        signatures: [],
        priceFeedTokens: [],
      })
    )
      .to.be.revertedWithCustomError(oracle, "InvalidBlockNumber")
      .withArgs(blockNumber + 10);

    await expect(
      oracle.setPrices(dataStore.address, eventEmitter.address, {
        signerInfo: getSignerInfo([0, 1]),
        tokens: [wnt.address],
        compactedOracleBlockNumbers: [blockNumber],
        compactedOracleTimestamps: [blockTimestamp],
        compactedDecimals: getCompactedDecimals([1]),
        compactedMinPrices: getCompactedPrices([3000, 3000]),
        compactedMinPricesIndexes: getCompactedPriceIndexes([0, 1]),
        compactedMaxPrices: getCompactedPrices([3000, 3000]),
        compactedMaxPricesIndexes: getCompactedPriceIndexes([0, 1]),
        signatures: ["0x00", "0x00"],
        priceFeedTokens: [],
      })
    ).to.be.revertedWith("ECDSA: invalid signature length");

    await dataStore.setUint(keys.MIN_ORACLE_SIGNERS, 3);

    await expect(
      oracle.setPrices(dataStore.address, eventEmitter.address, {
        signerInfo: getSignerInfo([0, 1]),
        tokens: [wnt.address],
        compactedOracleBlockNumbers: [blockNumber],
        compactedOracleTimestamps: [blockTimestamp],
        compactedDecimals: getCompactedDecimals([1]),
        compactedMinPrices: getCompactedPrices([3000, 3000]),
        compactedMinPricesIndexes: getCompactedPriceIndexes([0, 1]),
        compactedMaxPrices: getCompactedPrices([3000, 3000]),
        compactedMaxPricesIndexes: getCompactedPriceIndexes([0, 1]),
        signatures: ["0x00", "0x00"],
        priceFeedTokens: [],
      })
    )
      .to.be.revertedWithCustomError(oracle, "MinOracleSigners")
      .withArgs(2, 3);

    await expect(
      oracle.setPrices(dataStore.address, eventEmitter.address, {
        signerInfo: getSignerInfo([0, 1, 2, 3, 4, 1, 9]),
        tokens: [wnt.address],
        compactedOracleBlockNumbers: [blockNumber],
        compactedOracleTimestamps: [blockTimestamp],
        compactedDecimals: getCompactedDecimals([1]),
        compactedMinPrices: getCompactedPrices([3000, 3000]),
        compactedMinPricesIndexes: getCompactedPriceIndexes([0, 1]),
        compactedMaxPrices: getCompactedPrices([3000, 3000]),
        compactedMaxPricesIndexes: getCompactedPriceIndexes([0, 1]),
        signatures: ["0x00", "0x00"],
        priceFeedTokens: [],
      })
    )
      .to.be.revertedWithCustomError(oracle, "DuplicateSigner")
      .withArgs(1);

    let signerInfo = getSignerInfo([0, 1, 2, 3, 4, 7, 9]);
    const block = await provider.getBlock(blockNumber);
    let minPrices = [4990, 4991, 4995, 5000, 5001, 0, 5007];
    let maxPrices = [4990, 4991, 4995, 5000, 5001, 0, 5007];
    let signatures = await signPrices({
      signers: [signer0, signer1, signer2, signer3, signer4, signer7, signer9],
      salt: oracleSalt,
      oracleBlockNumber: blockNumber,
      oracleTimestamp: blockTimestamp,
      blockHash: block.hash,
      token: wnt.address,
      tokenOracleType: TOKEN_ORACLE_TYPES.DEFAULT,
      precision: 1,
      minPrices,
      maxPrices,
    });

    await expect(
      oracle.setPrices(dataStore.address, eventEmitter.address, {
        signerInfo,
        tokens: [wnt.address],
        compactedOracleBlockNumbers: [blockNumber],
        compactedOracleTimestamps: [blockTimestamp],
        compactedDecimals: getCompactedDecimals([1]),
        compactedMinPrices: getCompactedPrices(minPrices),
        compactedMinPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6]),
        compactedMaxPrices: getCompactedPrices(maxPrices),
        compactedMaxPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6]),
        signatures: signatures,
        priceFeedTokens: [],
      })
    )
      .to.be.revertedWithCustomError(oracle, "EmptyCompactedPrice")
      .withArgs(5);

    signerInfo = getSignerInfo([0, 1, 2, 3, 4, 7, 9]);
    minPrices = [4990, 4990, 4989, 5000, 5001, 5005, 5007];
    maxPrices = [4990, 4990, 4989, 5000, 5001, 5005, 5007];
    signatures = await signPrices({
      signers: [signer0, signer1, signer2, signer3, signer4, signer7, signer9],
      salt: oracleSalt,
      oracleBlockNumber: blockNumber,
      oracleTimestamp: blockTimestamp,
      blockHash: block.hash,
      token: wnt.address,
      tokenOracleType: TOKEN_ORACLE_TYPES.DEFAULT,
      precision: 1,
      minPrices,
      maxPrices,
    });

    await expect(
      oracle.setPrices(dataStore.address, eventEmitter.address, {
        priceFeedTokens: [],
        signerInfo,
        tokens: [wnt.address],
        compactedOracleBlockNumbers: [blockNumber],
        compactedOracleTimestamps: [blockTimestamp],
        compactedDecimals: getCompactedDecimals([1]),
        compactedMinPrices: getCompactedPrices(minPrices),
        compactedMinPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6]),
        compactedMaxPrices: getCompactedPrices(maxPrices),
        compactedMaxPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6]),
        signatures,
      })
    )
      .to.be.revertedWithCustomError(oracle, "MinPricesNotSorted")
      .withArgs(wnt.address, 4989, 4990);

    signerInfo = getSignerInfo([0, 1, 2, 3, 4, 7, 9]);
    minPrices = [4990, 4990, 4991, 5000, 5001, 5005, 5007];
    maxPrices = [4990, 4995, 4979, 5000, 5001, 5005, 5007];
    signatures = await signPrices({
      signers: [signer0, signer1, signer2, signer3, signer4, signer7, signer9],
      salt: oracleSalt,
      oracleBlockNumber: blockNumber,
      oracleTimestamp: blockTimestamp,
      blockHash: block.hash,
      token: wnt.address,
      tokenOracleType: TOKEN_ORACLE_TYPES.DEFAULT,
      precision: 1,
      minPrices,
      maxPrices,
    });

    await expect(
      oracle.setPrices(dataStore.address, eventEmitter.address, {
        priceFeedTokens: [],
        signerInfo,
        tokens: [wnt.address],
        compactedOracleBlockNumbers: [blockNumber],
        compactedOracleTimestamps: [blockTimestamp],
        compactedDecimals: getCompactedDecimals([1]),
        compactedMinPrices: getCompactedPrices(minPrices),
        compactedMinPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6]),
        compactedMaxPrices: getCompactedPrices(maxPrices),
        compactedMaxPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6]),
        signatures,
      })
    )
      .to.be.revertedWithCustomError(oracle, "MaxPricesNotSorted")
      .withArgs(wnt.address, 4979, 4995);

    signerInfo = getSignerInfo([0, 1, 2, 3, 4, 7, 9]);
    minPrices = [4990, 4991, 4995, 5000, 5001, 5005, 5007];
    maxPrices = [4990, 4991, 4995, 5000, 5001, 5005, 5007];
    signatures = await signPrices({
      signers: [signer0, signer1, signer2, signer3, signer4, signer7, signer9],
      salt: oracleSalt,
      oracleBlockNumber: blockNumber,
      oracleTimestamp: blockTimestamp,
      blockHash: block.hash,
      token: wnt.address,
      tokenOracleType: TOKEN_ORACLE_TYPES.DEFAULT,
      precision: 1,
      minPrices,
      maxPrices,
    });

    signatures[3] = signatures[4];

    await expect(
      oracle.setPrices(dataStore.address, eventEmitter.address, {
        priceFeedTokens: [],
        signerInfo,
        tokens: [wnt.address],
        compactedOracleBlockNumbers: [blockNumber],
        compactedOracleTimestamps: [blockTimestamp],
        compactedDecimals: getCompactedDecimals([1]),
        compactedMinPrices: getCompactedPrices(minPrices),
        compactedMinPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6]),
        compactedMaxPrices: getCompactedPrices(maxPrices),
        compactedMaxPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6]),
        signatures,
      })
    ).to.be.revertedWithCustomError(oracle, "InvalidSignature");

    signerInfo = getSignerInfo([0, 1, 2, 3, 4, 7, 9]);
    minPrices = [4990, 4991, 4995, 5000, 5001, 5005, 5007];
    maxPrices = [4990, 4991, 4995, 5010, 5011, 5015, 5017];
    signatures = await signPrices({
      signers: [signer0, signer1, signer2, signer3, signer4, signer7, signer9],
      salt: oracleSalt,
      oracleBlockNumber: blockNumber,
      oracleTimestamp: blockTimestamp,
      blockHash: block.hash,
      token: wnt.address,
      tokenOracleType: TOKEN_ORACLE_TYPES.DEFAULT,
      precision: 1,
      minPrices,
      maxPrices,
    });

    const tx0 = await oracle.setPrices(dataStore.address, eventEmitter.address, {
      priceFeedTokens: [],
      signerInfo,
      tokens: [wnt.address],
      compactedOracleBlockNumbers: [blockNumber],
      compactedOracleTimestamps: [blockTimestamp],
      compactedDecimals: getCompactedDecimals([1]),
      compactedMinPrices: getCompactedPrices(minPrices),
      compactedMinPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6]),
      compactedMaxPrices: getCompactedPrices(maxPrices),
      compactedMaxPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6]),
      signatures,
    });

    await printGasUsage(provider, tx0, "oracle.setPrices tx0");

    expect((await oracle.getPrimaryPrice(wnt.address)).min).eq(50000);
    expect((await oracle.getPrimaryPrice(wnt.address)).max).eq(50100);

    signerInfo = getSignerInfo([0, 1, 2, 3, 4, 7, 9]);
    const wntMinPrices = [4990, 4991, 4995, 5000, 5001, 5005, 5007];
    const wntMaxPrices = [4990, 4991, 4995, 5010, 5011, 5015, 5017];
    const wbtcMinPrices = [60100, 60101, 60102, 60110, 60200, 60300, 60500];
    const wbtcMaxPrices = [60100, 60101, 60102, 60510, 60700, 60800, 60900];

    const wntSignatures = await signPrices({
      signers: [signer0, signer1, signer2, signer3, signer4, signer7, signer9],
      salt: oracleSalt,
      oracleBlockNumber: blockNumber,
      oracleTimestamp: blockTimestamp,
      blockHash: block.hash,
      token: wnt.address,
      tokenOracleType: TOKEN_ORACLE_TYPES.DEFAULT,
      precision: 1,
      minPrices: wntMinPrices,
      maxPrices: wntMaxPrices,
    });

    const wbtcSignatures = await signPrices({
      signers: [signer0, signer1, signer2, signer3, signer4, signer7, signer9],
      salt: oracleSalt,
      oracleBlockNumber: blockNumber,
      oracleTimestamp: blockTimestamp,
      blockHash: block.hash,
      token: wbtc.address,
      tokenOracleType: TOKEN_ORACLE_TYPES.DEFAULT,
      precision: 2,
      minPrices: wbtcMinPrices,
      maxPrices: wbtcMaxPrices,
    });

    await expect(
      oracle.setPrices(dataStore.address, eventEmitter.address, {
        priceFeedTokens: [],
        signerInfo,
        tokens: [wnt.address, wbtc.address],
        compactedOracleBlockNumbers: [blockNumber],
        compactedOracleTimestamps: [blockTimestamp],
        compactedDecimals: getCompactedDecimals([1, 2]),
        compactedMinPrices: getCompactedPrices(wntMinPrices.concat(wbtcMinPrices)),
        compactedMinPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6]),
        compactedMaxPrices: getCompactedPrices(wntMaxPrices.concat(wbtcMaxPrices)),
        compactedMaxPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6]),
        signatures: wntSignatures.concat(wbtcSignatures),
      })
    ).to.be.revertedWith("Oracle: tokensWithPrices not cleared");

    await oracle.clearAllPrices();

    await expect(
      oracle.setPrices(dataStore.address, eventEmitter.address, {
        priceFeedTokens: [],
        signerInfo,
        tokens: [wnt.address, wbtc.address],
        compactedOracleBlockNumbers: getCompactedOracleBlockNumbers([blockNumber]),
        compactedOracleTimestamps: getCompactedOracleTimestamps([blockTimestamp]),
        compactedDecimals: getCompactedDecimals([1, 2]),
        compactedMinPrices: getCompactedPrices(wntMinPrices.concat(wbtcMinPrices)),
        compactedMinPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6]),
        compactedMaxPrices: getCompactedPrices(wntMaxPrices.concat(wbtcMaxPrices)),
        compactedMaxPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6]),
        signatures: wntSignatures.concat(wbtcSignatures),
      })
    ).to.be.revertedWithCustomError(oracle, "EmptyCompactedBlockNumber");

    await expect(
      oracle.setPrices(dataStore.address, eventEmitter.address, {
        priceFeedTokens: [],
        signerInfo,
        tokens: [wbtc.address, wnt.address],
        compactedOracleBlockNumbers: getCompactedOracleBlockNumbers([blockNumber, blockNumber]),
        compactedOracleTimestamps: getCompactedOracleTimestamps([blockTimestamp, blockTimestamp]),
        compactedDecimals: getCompactedDecimals([1, 2]),
        compactedMinPrices: getCompactedPrices(wntMinPrices.concat(wbtcMinPrices)),
        compactedMinPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6]),
        compactedMaxPrices: getCompactedPrices(wntMaxPrices.concat(wbtcMaxPrices)),
        compactedMaxPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6]),
        signatures: wntSignatures.concat(wbtcSignatures),
      })
    ).to.be.revertedWithCustomError(oracle, "InvalidSignature");

    const tx1 = await oracle.setPrices(dataStore.address, eventEmitter.address, {
      priceFeedTokens: [],
      signerInfo,
      tokens: [wnt.address, wbtc.address],
      compactedOracleBlockNumbers: getCompactedOracleBlockNumbers([blockNumber, blockNumber]),
      compactedOracleTimestamps: getCompactedOracleTimestamps([blockTimestamp, blockTimestamp]),
      compactedDecimals: getCompactedDecimals([1, 2]),
      compactedMinPrices: getCompactedPrices(wntMinPrices.concat(wbtcMinPrices)),
      compactedMinPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6]),
      compactedMaxPrices: getCompactedPrices(wntMaxPrices.concat(wbtcMaxPrices)),
      compactedMaxPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6]),
      signatures: wntSignatures.concat(wbtcSignatures),
    });

    await printGasUsage(provider, tx1, "oracle.setPrices tx1");

    expect((await oracle.getPrimaryPrice(wnt.address)).min).eq(50000);
    expect((await oracle.getPrimaryPrice(wnt.address)).max).eq(50100);
    expect((await oracle.getPrimaryPrice(wbtc.address)).min).eq(6011000);
    expect((await oracle.getPrimaryPrice(wbtc.address)).max).eq(6051000);

    expect(await oracle.getTokensWithPricesCount()).eq(2);
    expect(await oracle.getTokensWithPrices(0, 2)).eql([wnt.address, wbtc.address]);
  });

  it("withOraclePrices", async () => {
    const oracleModuleTest = await deployContract("OracleModuleTest", []);
    await grantRole(roleStore, oracleModuleTest.address, "CONTROLLER");

    const signerInfo = getSignerInfo([0, 1, 2, 3, 4, 7, 9]);

    const wntPrices = [5990, 5991, 5995, 6010, 6011, 6015, 6017];
    const usdcPrices = [1, 1, 1, 1, 1, 1, 1];

    const block = await provider.getBlock();

    const wntSignatures = await signPrices({
      signers: [signer0, signer1, signer2, signer3, signer4, signer7, signer9],
      salt: oracleSalt,
      oracleBlockNumber: block.number,
      oracleTimestamp: block.timestamp,
      blockHash: block.hash,
      token: wnt.address,
      tokenOracleType: TOKEN_ORACLE_TYPES.DEFAULT,
      precision: 1,
      minPrices: wntPrices,
      maxPrices: wntPrices,
    });

    const usdcSignatures = await signPrices({
      signers: [signer0, signer1, signer2, signer3, signer4, signer7, signer9],
      salt: oracleSalt,
      oracleBlockNumber: block.number,
      oracleTimestamp: block.timestamp,
      blockHash: block.hash,
      token: usdc.address,
      tokenOracleType: TOKEN_ORACLE_TYPES.DEFAULT,
      precision: 6,
      minPrices: usdcPrices,
      maxPrices: usdcPrices,
    });

    const tx0 = await oracleModuleTest.withOraclePricesTest(oracle.address, dataStore.address, eventEmitter.address, {
      signerInfo,
      tokens: [wnt.address],
      compactedOracleBlockNumbers: getCompactedOracleBlockNumbers([block.number]),
      compactedOracleTimestamps: getCompactedOracleTimestamps([block.timestamp]),
      compactedDecimals: getCompactedDecimals([1]),
      compactedMinPrices: getCompactedPrices(wntPrices),
      compactedMinPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6]),
      compactedMaxPrices: getCompactedPrices(wntPrices),
      compactedMaxPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6]),
      signatures: wntSignatures,
      priceFeedTokens: [usdc.address],
    });

    await printGasUsage(provider, tx0, "oracle.withOraclePrices tx0");

    const tx1 = await oracleModuleTest.withOraclePricesTest(oracle.address, dataStore.address, eventEmitter.address, {
      signerInfo,
      tokens: [wnt.address, usdc.address],
      compactedOracleBlockNumbers: getCompactedOracleBlockNumbers([block.number, block.number]),
      compactedOracleTimestamps: getCompactedOracleTimestamps([block.timestamp, block.timestamp]),
      compactedDecimals: getCompactedDecimals([1, 6]),
      compactedMinPrices: getCompactedPrices(wntPrices.concat(usdcPrices)),
      compactedMinPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6]),
      compactedMaxPrices: getCompactedPrices(wntPrices.concat(usdcPrices)),
      compactedMaxPricesIndexes: getCompactedPriceIndexes([0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6]),
      signatures: wntSignatures.concat(usdcSignatures),
      priceFeedTokens: [],
    });

    await printGasUsage(provider, tx1, "oracle.withOraclePrices tx1");

    const tx2 = await oracleModuleTest.withOraclePricesTest(oracle.address, dataStore.address, eventEmitter.address, {
      signerInfo,
      tokens: [wnt.address, wnt.address, usdc.address],
      compactedOracleBlockNumbers: getCompactedOracleBlockNumbers([block.number, block.number, block.number]),
      compactedOracleTimestamps: getCompactedOracleTimestamps([block.timestamp, block.timestamp, block.timestamp]),
      compactedDecimals: getCompactedDecimals([1, 1, 6]),
      compactedMinPrices: getCompactedPrices(wntPrices.concat(wntPrices).concat(usdcPrices)),
      compactedMinPricesIndexes: getCompactedPriceIndexes([
        0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6,
      ]),
      compactedMaxPrices: getCompactedPrices(wntPrices.concat(wntPrices).concat(usdcPrices)),
      compactedMaxPricesIndexes: getCompactedPriceIndexes([
        0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6, 0, 1, 2, 3, 4, 5, 6,
      ]),
      signatures: wntSignatures.concat(wntSignatures).concat(usdcSignatures),
      priceFeedTokens: [],
    });

    await printGasUsage(provider, tx2, "oracle.withOraclePrices tx2");
  });
});
