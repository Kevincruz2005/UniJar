// SPDX-License-Identifier: AGPL-3.0-only
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { encodeDeployData, encodeFunctionData, keccak256, type Address, type Hex } from 'viem';
import { manifestSchema, loadManifest, type Manifest } from '../src/manifest.js';
import { root, chainId, client, accounts, artifact, assertChain, broadcast, confirm, read, json } from './runtime.js';

async function main() {
  await assertChain();
  execFileSync('git', ['diff', '--quiet', 'HEAD'], { cwd: root });
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const name = chainId === 31337 ? 'local' : 'sepolia';
  const output = resolve(root, `deployments/${name}.json`);
  const pendingPath = resolve(root, chainId === 31337 ? '.local/local.pending.json' : 'deployments/sepolia.pending.json');
  mkdirSync(resolve(root, '.local'), { recursive: true });
  type Pending = { sourceCommit: string; chainId: number; transactions: Record<string, Hex>; deployments: Manifest['deployments'] };
  const p: Pending = existsSync(pendingPath) ? JSON.parse(readFileSync(pendingPath, 'utf8')) : { sourceCommit, chainId, transactions: {}, deployments: {} };
  if (p.sourceCommit !== sourceCommit || p.chainId !== chainId) throw new Error('Pending deployment belongs to another commit/chain; inspect it before resuming');
  const save = () => { writeFileSync(`${pendingPath}.tmp`, json(p)); renameSync(`${pendingPath}.tmp`, pendingPath); };
  async function transaction(stage: string, data: Hex, to?: Address) {
    if (!p.transactions[stage]) { p.transactions[stage] = await broadcast(data, to); save(); }
    return confirm(p.transactions[stage]!);
  }
  async function deploy(stage: string, path: string, args: readonly unknown[] = []): Promise<Address> {
    const old = p.deployments[stage];
    if (old) { const code = await client.getCode({ address: old.address as Address }); if (!code || keccak256(code) !== old.codeHash) throw new Error(`Changed deployed code: ${stage}`); return old.address as Address; }
    const { abi, bytecode } = artifact(path); const receipt = await transaction(`deploy:${stage}`, encodeDeployData({ abi, bytecode: bytecode.object, args }));
    if (!receipt.contractAddress) throw new Error('Missing deployment address');
    const code = await client.getCode({ address: receipt.contractAddress }); if (!code || code === '0x') throw new Error('Missing deployed code');
    p.deployments[stage] = { address: receipt.contractAddress, block: receipt.blockNumber.toString(), transactionHash: receipt.transactionHash, codeHash: keccak256(code) }; save();
    console.log(`Confirmed ${stage}: ${receipt.contractAddress}`); return receipt.contractAddress;
  }
  const tokenPath = 'contracts/out/FixtureToken.sol/FixtureToken.json';
  const token = artifact(tokenPath).abi;
  const payout = await deploy('payout', tokenPath, ['Mock USD', 'mUSDC', 6]);
  const directAsset = await deploy('directAsset', tokenPath, ['Mock Fee', 'mFEE', 18]);
  const auctionAsset = await deploy('auctionAsset', tokenPath, ['Mock Alt', 'mALT', 18]);
  const factoryPath = 'oracle-contracts/out/UniswapV3Factory.sol/UniswapV3Factory.json'; const factoryAbi = artifact(factoryPath).abi;
  const factory = await deploy('factory', factoryPath);
  const tx = async (stage: string, to: Address, abi: ReturnType<typeof artifact>['abi'], method: string, args: readonly unknown[]) => transaction(stage, encodeFunctionData({ abi, functionName: method, args }), to);
  const poolReceipt = await tx('createPool', factory, factoryAbi, 'createPool', [directAsset, payout, 3000]);
  const pool = await read(factory, factoryAbi, 'getPool', [directAsset, payout, 3000]) as Address;
  const poolPath = 'oracle-contracts/out/UniswapV3Pool.sol/UniswapV3Pool.json'; const poolAbi = artifact(poolPath).abi;
  const code = await client.getCode({ address: pool }); if (!code || code === '0x') throw new Error('No actual pool');
  p.deployments.pool = { address: pool, block: poolReceipt.blockNumber.toString(), transactionHash: poolReceipt.transactionHash, codeHash: keccak256(code) }; save();
  const assetFirst = BigInt(directAsset) < BigInt(payout);
  const sqrt = assetFirst ? 79228162514264337593543n : 79228162514264337593543950336000000n;
  await tx('initializePool', pool, poolAbi, 'initialize', [sqrt]);
  await tx('observationCapacity', pool, poolAbi, 'increaseObservationCardinalityNext', [16]);
  const fixturePath = 'oracle-contracts/out/LiquidityFixture.sol/LiquidityFixture.json'; const fixtureAbi = artifact(fixturePath).abi;
  const fixture = await deploy('fixture', fixturePath, [pool]);
  const reader = await deploy('reader', 'oracle-contracts/out/V3Reader.sol/V3Reader.json');
  const jarPath = 'contracts/out/TokenJar.sol/TokenJar.json'; const jarAbi = artifact(jarPath).abi;
  const jar = await deploy('jar', jarPath);
  const releaserPath = 'contracts/out/UniJar.sol/UniJar.json'; const saleAbi = artifact(releaserPath).abi;
  const releaser = await deploy('releaser', releaserPath, [jar, accounts.treasury, accounts.operator, payout, reader, factory]);
  await tx('adoptReleaser', jar, jarAbi, 'setReleaser', [releaser]);
  await tx('directMode', releaser, saleAbi, 'setAssetMode', [directAsset, 2]);
  await tx('auctionMode', releaser, saleAbi, 'setAssetMode', [auctionAsset, 1]);
  const policy = { pool, fee: 3000, window: 1800, maxAge: 600, minLiquidity: 1000000000000n, maxQuantity: 100n * 10n ** 18n, maxTickDeviation: 100, discountBps: 100, maxDuration: 7200, version: 1n };
  await tx('policy', releaser, saleAbi, 'setPolicy', [directAsset, policy]);
  for (const [stage, target, recipient, amount] of [
    ['liquidityUSD', payout, accounts.operator!, 1000000n * 10n ** 6n],
    ['liquidityFEE', directAsset, accounts.operator!, 1000000n * 10n ** 18n],
    ['jarFEE', directAsset, jar, 100n * 10n ** 18n], ['jarALT', auctionAsset, jar, 100n * 10n ** 18n],
    ['buyerAUSD', payout, accounts['buyer-a']!, 10000n * 10n ** 6n], ['buyerBUSD', payout, accounts['buyer-b']!, 10000n * 10n ** 6n],
  ] as const) await tx(stage, target, token, 'mint', [recipient, amount]);
  for (const [label, target, amount] of [['usd', payout, 1000000n * 10n ** 6n], ['fee', directAsset, 1000000n * 10n ** 18n]] as const) await tx(`approveFixture:${label}`, target, token, 'approve', [fixture, amount]);
  const seed = await tx('seedLiquidity', fixture, fixtureAbi, 'mint', [-887220, 887220, 1000000000000000n]);
  const seedTime = (await client.getBlock({ blockNumber: seed.blockNumber })).timestamp;
  const historyTarget = seedTime + 1801n;
  if (chainId === 31337) {
    if ((await client.getBlock()).timestamp < historyTarget) {
      await client.request({ method: 'evm_setNextBlockTimestamp' as never, params: [Number(historyTarget)] as never });
      await client.request({ method: 'evm_mine' as never, params: [] as never });
    }
  } else {
    while ((await client.getBlock()).timestamp < historyTarget) {
      console.log('Waiting for real Sepolia oracle history (30-second polling; safely resumable)'); await new Promise(r => setTimeout(r, 30000));
    }
  }
  // Genuine in-range mint writes a new observation after the complete lookback.
  // Refresh on every resume, rather than reusing an observation that may now be stale.
  const activityStage = `freshLiquidity:${(await client.getBlock()).timestamp}`;
  await tx(activityStage, fixture, fixtureAbi, 'mint', [-887220, 887220, 1000000000n]);
  const readerAbi = artifact('oracle-contracts/out/V3Reader.sol/V3Reader.json').abi;
  const reference = await read(reader, readerAbi, 'read', [pool, factory, directAsset, payout, 3000, 10n ** 18n, 1800]) as readonly [bigint, number, number, bigint, number];
  if (reference[0] === 0n || reference[3] < policy.minLiquidity || (await client.getBlock()).timestamp - BigInt(reference[4]) > 600n) throw new Error('Oracle prerequisites failed');
  if (String(await read(jar, jarAbi, 'releaser')).toLowerCase() !== releaser.toLowerCase()) throw new Error('Adoption mismatch');
  const result = manifestSchema.parse(JSON.parse(json({ chainId, sourceCommit, controlledFixture: true,
    toolchain: { foundry: '1.9.0', mainSolc: '0.8.29', mainEvm: 'cancun', oracleSolc: '0.7.6', oracleEvm: 'istanbul', optimizerRuns: '200' },
    addresses: { payout, directAsset, auctionAsset, jar, releaser, factory, pool, reader, fixture },
    roles: { operator: accounts.operator, treasury: accounts.treasury, buyerA: accounts['buyer-a'], buyerB: accounts['buyer-b'] }, deployments: p.deployments, transactions: p.transactions, policy })));
  writeFileSync(output, json(result)); loadManifest(output); console.log(`Validated real ${name} deployment manifest: deployments/${name}.json`);
}
main().catch(() => { console.error('Deployment stopped. Check chain, funding, clean source commit, keystores and RPC. Confirmed progress is retained; no success is claimed.'); process.exitCode = 1; });
