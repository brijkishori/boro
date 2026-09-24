import { publicClient } from '@/lib/rpc';

export const ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' as const;
export const BTC_USD_FEED = '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c' as const;
const FEED_MAX_AGE_SECONDS = 86_400n;

export const feedAbi = [
  {
    name: 'latestRoundData',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const;

export type UsdPrices = {
  ethUsd: number;
  btcUsd: number;
};

export function parseFeedUsd(data: readonly [bigint, bigint, bigint, bigint, bigint] | undefined) {
  if (!data) return 0;
  const [, answer, , updatedAt] = data;
  if (answer <= 0n) return 0;
  const age = BigInt(Math.floor(Date.now() / 1000)) - updatedAt;
  if (age < 0n || age > FEED_MAX_AGE_SECONDS) return 0;
  return Number(answer) / 1e8;
}

export async function fetchUsdPrices(): Promise<UsdPrices> {
  const client = publicClient(1);
  const [eth, btc] = await Promise.all([
    client.readContract({ address: ETH_USD_FEED, abi: feedAbi, functionName: 'latestRoundData' }).catch(() => undefined),
    client.readContract({ address: BTC_USD_FEED, abi: feedAbi, functionName: 'latestRoundData' }).catch(() => undefined),
  ]);
  return {
    ethUsd: parseFeedUsd(eth),
    btcUsd: parseFeedUsd(btc),
  };
}
