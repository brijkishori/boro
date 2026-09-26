import { concatHex, getAddress, padHex, toHex, type Address, type Hex, type PublicClient } from 'viem';
import type { ChainId } from '@/lib/protocol';
import { CHAINS } from '@/lib/protocol';

export const WETH: Record<ChainId, Address> = {
  1: getAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
  8453: getAddress('0x4200000000000000000000000000000000000006'),
};

export const SWAP_FEES = [100, 500, 3000, 10_000] as const;

export const SWAP_ROUTER: Record<ChainId, Address> = {
  1: getAddress('0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'),
  8453: getAddress('0x2626664c2603336E57B271c5C0b26F421741e481'),
};

export const QUOTER_V2: Record<ChainId, Address> = {
  1: getAddress('0x61fFE014bA17989E743c5F6cB21bF9697530B21e'),
  8453: getAddress('0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'),
};

export const quoterAbi = [
  {
    name: 'quoteExactInputSingle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{
      name: 'params',
      type: 'tuple',
      components: [
        { name: 'tokenIn', type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'fee', type: 'uint24' },
        { name: 'sqrtPriceLimitX96', type: 'uint160' },
      ],
    }],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
  {
    name: 'quoteExactInput',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'path', type: 'bytes' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96AfterList', type: 'uint160[]' },
      { name: 'initializedTicksCrossedList', type: 'uint32[]' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const;

export const swapRouterAbi = [
  {
    name: 'exactInputSingle',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{
      name: 'params',
      type: 'tuple',
      components: [
        { name: 'tokenIn', type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'recipient', type: 'address' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'amountOutMinimum', type: 'uint256' },
        { name: 'sqrtPriceLimitX96', type: 'uint160' },
      ],
    }],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    name: 'exactInput',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{
      name: 'params',
      type: 'tuple',
      components: [
        { name: 'path', type: 'bytes' },
        { name: 'recipient', type: 'address' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'amountOutMinimum', type: 'uint256' },
      ],
    }],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;

export type RelaySwapStep = {
  kind: 'approve' | 'deposit';
  to: Address;
  data: Hex;
  value: bigint;
  chainId: number;
};

export type SwapQuote = {
  out: bigint;
  fee?: number;
  path?: Hex;
  destChainId?: ChainId;
  steps?: RelaySwapStep[];
};

export function tbtcToken(chainId: ChainId) {
  return token(chainId, 'tBTC');
}

export function encodeUniPath(tokens: Address[], fees: number[]): Hex {
  const parts: Hex[] = [tokens[0]];
  fees.forEach((fee, index) => {
    parts.push(padHex(toHex(fee), { size: 3 }));
    parts.push(tokens[index + 1]);
  });
  return concatHex(parts);
}

export type SwapRoute = {
  id: string;
  chainId: ChainId;
  fromSymbol: string;
  from: Address;
  fromDecimals: number;
  to: Address;
  toDecimals: number;
};

function token(chainId: ChainId, symbol: string) {
  const match = CHAINS[chainId].btc.find((item) => item.symbol === symbol);
  if (!match) throw new Error(`Missing ${symbol} on ${chainId}`);
  return match;
}

export const TBTC_ROUTES: SwapRoute[] = [
  {
    id: 'base-cbbtc',
    chainId: 8453,
    fromSymbol: 'cbBTC',
    from: token(8453, 'cbBTC').address,
    fromDecimals: token(8453, 'cbBTC').decimals,
    to: token(8453, 'tBTC').address,
    toDecimals: token(8453, 'tBTC').decimals,
  },
  {
    id: 'eth-cbbtc',
    chainId: 1,
    fromSymbol: 'cbBTC',
    from: token(1, 'cbBTC').address,
    fromDecimals: token(1, 'cbBTC').decimals,
    to: token(1, 'tBTC').address,
    toDecimals: token(1, 'tBTC').decimals,
  },
  {
    id: 'eth-wbtc',
    chainId: 1,
    fromSymbol: 'WBTC',
    from: token(1, 'WBTC').address,
    fromDecimals: token(1, 'WBTC').decimals,
    to: token(1, 'tBTC').address,
    toDecimals: token(1, 'tBTC').decimals,
  },
];

export const SLIPPAGE_BPS = 100n;

export function uniswapSwapUrl(route: SwapRoute) {
  const chain = route.chainId === 8453 ? 'base' : 'ethereum';
  return `https://app.uniswap.org/swap?chain=${chain}&inputCurrency=${route.from}&outputCurrency=${route.to}`;
}

const HOP_FEES: Array<[number, number]> = [
  [100, 500],
  [500, 500],
  [500, 3000],
  [100, 3000],
  [3000, 3000],
  [3000, 500],
];

export async function quoteTbtcSwap(
  client: PublicClient,
  route: SwapRoute,
  amountIn: bigint,
): Promise<SwapQuote | null> {
  if (amountIn <= 0n) return null;
  const quoter = QUOTER_V2[route.chainId];
  let best: SwapQuote | null = null;

  for (const fee of SWAP_FEES) {
    try {
      const { result } = await client.simulateContract({
        address: quoter,
        abi: quoterAbi,
        functionName: 'quoteExactInputSingle',
        args: [{ tokenIn: route.from, tokenOut: route.to, amountIn, fee, sqrtPriceLimitX96: 0n }],
      });
      if (result[0] > 0n && (!best || result[0] > best.out)) best = { out: result[0], fee };
    } catch {
      // No pool, or this fee cannot fill the size.
    }
  }

  for (const [first, second] of HOP_FEES) {
    try {
      const path = encodeUniPath([route.from, WETH[route.chainId], route.to], [first, second]);
      const { result } = await client.simulateContract({
        address: quoter,
        abi: quoterAbi,
        functionName: 'quoteExactInput',
        args: [path, amountIn],
      });
      if (result[0] > 0n && (!best || result[0] > best.out)) best = { out: result[0], path };
    } catch {
      // No multi-hop route at this fee pair.
    }
  }

  return best;
}
