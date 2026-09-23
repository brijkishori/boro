import type { Abi, Address } from 'viem';
import type { ChainId, Venue } from '@/lib/protocol';

export type WriteCall = {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  chainId: ChainId;
};

export type ReadCall = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  chainId: ChainId;
};

export type PositionSnapshot = {
  collateral: bigint;
  debt: bigint;
  maxBorrow: bigint;
  borrowRoom: bigint;
  withdrawMax: bigint;
  healthFactor: number | null;
  ltv: number;
  liquidationPrice: number;
  ready: boolean;
  extra?: { shares?: bigint; enteredMarket?: boolean; minBorrow?: bigint };
};

export type ProtocolAdapter = {
  positionReads(venue: Venue, user: Address): ReadCall[];
  parsePosition(venue: Venue, results: unknown[]): PositionSnapshot;
  buildSupply(venue: Venue, user: Address, amount: bigint, action: 'borrow' | 'lend'): WriteCall | null;
  buildBorrow(venue: Venue, user: Address, amount: bigint): WriteCall | null;
  buildRepay(venue: Venue, user: Address, amount: bigint, full: boolean, extra?: { shares?: bigint }): WriteCall | null;
  buildWithdraw(venue: Venue, user: Address, amount: bigint, action: 'borrow' | 'lend', extra?: { shares?: bigint }): WriteCall | null;
  buildEnterMarket?(venue: Venue): WriteCall | null;
};
