import type { Address } from 'viem';
import { erc20Abi } from '@/lib/abi';
import type { Venue } from '@/lib/protocol';
import { aaveLikeAdapter, isolateCall, morphoAdapter } from './morpho';
import { compoundAdapter } from './compound';
import { moonwellAdapter } from './moonwell';
import type { ProtocolAdapter, WriteCall } from './types';

export type { PositionSnapshot, ProtocolAdapter, ReadCall, WriteCall } from './types';
export { isolateCall };

export function adapterFor(venue: Venue): ProtocolAdapter {
  if (venue.protocol === 'morpho') return morphoAdapter;
  if (venue.protocol === 'compound') return compoundAdapter;
  if (venue.protocol === 'moonwell') return moonwellAdapter;
  return aaveLikeAdapter;
}

export function approveCall(venue: Venue, spender: Address, amount: bigint, kind: 'asset' | 'loan' = 'asset'): WriteCall {
  return {
    address: kind === 'loan' ? venue.loanAddress : venue.assetAddress,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, amount],
    chainId: venue.chainId,
  };
}
