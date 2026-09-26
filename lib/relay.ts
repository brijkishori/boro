import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { isChainId, type ChainId } from '@/lib/protocol';
import type { RelaySwapStep } from '@/lib/uniswap';

type RelayTxData = {
  to?: unknown;
  data?: unknown;
  value?: unknown;
  chainId?: unknown;
};

type RelayStepJson = {
  id?: unknown;
  kind?: unknown;
  items?: Array<{ data?: RelayTxData }>;
};

type RelayQuoteJson = {
  requestId?: unknown;
  steps?: RelayStepJson[];
  details?: {
    currencyOut?: { amount?: unknown };
  };
};

function asHex(value: unknown): Hex | null {
  return typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value) ? value as Hex : null;
}

function asAmount(value: unknown): bigint | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const amount = BigInt(value);
  return amount > 0n ? amount : null;
}

function parseStep(step: RelayStepJson, expectedChain: ChainId): RelaySwapStep | null {
  const tx = step.items?.[0]?.data;
  if (!tx || typeof tx.to !== 'string' || !isAddress(tx.to)) return null;
  const data = asHex(tx.data);
  if (!data) return null;
  const chainId = Number(tx.chainId);
  if (chainId !== expectedChain) return null;
  const valueText = typeof tx.value === 'string' && /^\d+$/.test(tx.value) ? tx.value : '0';
  const kind = step.id === 'approve' ? 'approve' : 'deposit';
  return {
    kind,
    to: getAddress(tx.to),
    data,
    value: BigInt(valueText),
    chainId,
  };
}

export async function quoteRelayTbtc(input: {
  user: Address;
  fromChainId: ChainId;
  toChainId: ChainId;
  fromToken: Address;
  toToken: Address;
  amount: bigint;
}): Promise<{ out: bigint; steps: RelaySwapStep[] } | null> {
  if (input.fromChainId === input.toChainId || input.amount <= 0n) return null;
  const response = await fetch('https://api.relay.link/quote/v2', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      user: input.user,
      originChainId: input.fromChainId,
      destinationChainId: input.toChainId,
      originCurrency: input.fromToken,
      destinationCurrency: input.toToken,
      amount: input.amount.toString(),
      tradeType: 'EXACT_INPUT',
    }),
  });
  if (!response.ok) return null;
  const body = await response.json() as RelayQuoteJson;
  const out = asAmount(body.details?.currencyOut?.amount);
  if (!out || !Array.isArray(body.steps) || body.steps.length === 0) return null;
  const steps: RelaySwapStep[] = [];
  for (const step of body.steps) {
    const parsed = parseStep(step, input.fromChainId);
    if (!parsed) return null;
    steps.push(parsed);
  }
  return { out, steps };
}

export function parseDestChain(raw: string | null, fallback: ChainId): ChainId {
  const id = Number(raw);
  return isChainId(id) ? id : fallback;
}
