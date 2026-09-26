import { encodePacked, getAddress, isAddress, keccak256, sha256, type Address, type Hex } from 'viem';
import { encodeBech32, isTbtcRecoveryAddress, recoveryPubKeyHash } from '@/lib/btc';

export const TBTC_BRIDGE = getAddress('0x5e4861a80B55f035D899f66772117F00FA0E8e7B');
export const TBTC_VAULT = getAddress('0x9C070027cdC9dc8F82416B2e5314E11DFb4FE3Cd');
export const TBTC_MINT_CHAIN_ID = 1;
export const TBTC_REFUND_SECONDS = 23_328_000;
export const TBTC_MINT_FEE_BPS = 20;
export const TBTC_DEFAULT_MIN_SATS = 1_000_000;
export const TBTC_MINT_STORAGE = 'boro_tbtc_mint';

const OP = {
  drop: 0x75,
  dup: 0x76,
  hash160: 0xa9,
  equal: 0x87,
  if: 0x63,
  checksig: 0xac,
  else: 0x67,
  equalverify: 0x88,
  checklocktimeverify: 0xb1,
  endif: 0x68,
} as const;

export type DepositReceipt = {
  depositor: Address;
  blindingFactor: Hex;
  walletPublicKeyHash: Hex;
  refundPublicKeyHash: Hex;
  refundLocktime: Hex;
};

export type TbtcMint = {
  v: 1;
  user: Address;
  recoveryAddress: string;
  btcAddress: string;
  createdAt: number;
  minSats: number;
  receipt: DepositReceipt;
  revealTx?: Hex;
};

export type TbtcUtxo = {
  txid: string;
  vout: number;
  value: number;
  confirmed: boolean;
};

export const tbtcBridgeAbi = [
  {
    name: 'activeWalletPubKeyHash',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bytes20' }],
  },
  {
    name: 'depositParameters',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'depositDustThreshold', type: 'uint64' },
      { name: 'depositTreasuryFeeDivisor', type: 'uint64' },
      { name: 'depositTxMaxFee', type: 'uint64' },
      { name: 'depositRevealAheadPeriod', type: 'uint32' },
    ],
  },
  {
    name: 'deposits',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'depositKey', type: 'uint256' }],
    outputs: [
      { name: 'depositor', type: 'address' },
      { name: 'amount', type: 'uint64' },
      { name: 'revealedAt', type: 'uint32' },
      { name: 'vault', type: 'address' },
      { name: 'treasuryFee', type: 'uint64' },
      { name: 'sweptAt', type: 'uint32' },
      { name: 'extraData', type: 'bytes32' },
    ],
  },
  {
    name: 'revealDeposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'fundingTx',
        type: 'tuple',
        components: [
          { name: 'version', type: 'bytes4' },
          { name: 'inputVector', type: 'bytes' },
          { name: 'outputVector', type: 'bytes' },
          { name: 'locktime', type: 'bytes4' },
        ],
      },
      {
        name: 'reveal',
        type: 'tuple',
        components: [
          { name: 'fundingOutputIndex', type: 'uint32' },
          { name: 'blindingFactor', type: 'bytes8' },
          { name: 'walletPubKeyHash', type: 'bytes20' },
          { name: 'refundPubKeyHash', type: 'bytes20' },
          { name: 'refundLocktime', type: 'bytes4' },
          { name: 'vault', type: 'address' },
        ],
      },
    ],
    outputs: [],
  },
] as const;

export function hexBytes(hex: string, size?: number): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) throw new Error('Invalid hex.');
  if (size !== undefined && clean.length !== size * 2) throw new Error('Invalid hex length.');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): Hex {
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function push(data: Uint8Array): number[] {
  if (data.length > 75) throw new Error('Deposit script push is too large.');
  return [data.length, ...data];
}

/** Same deposit script the official tBTC v2 SDK compiles. */
export function depositScript(receipt: DepositReceipt): Uint8Array {
  return Uint8Array.from([
    ...push(hexBytes(receipt.depositor, 20)),
    OP.drop,
    ...push(hexBytes(receipt.blindingFactor, 8)),
    OP.drop,
    OP.dup,
    OP.hash160,
    ...push(hexBytes(receipt.walletPublicKeyHash, 20)),
    OP.equal,
    OP.if,
    OP.checksig,
    OP.else,
    OP.dup,
    OP.hash160,
    ...push(hexBytes(receipt.refundPublicKeyHash, 20)),
    OP.equalverify,
    ...push(hexBytes(receipt.refundLocktime, 4)),
    OP.checklocktimeverify,
    OP.drop,
    OP.checksig,
    OP.endif,
  ]);
}

export function depositBitcoinAddress(receipt: DepositReceipt): string {
  const hash = hexBytes(sha256(depositScript(receipt)));
  return encodeBech32('bc', 0, hash);
}

export function refundLocktime(nowSeconds = Math.floor(Date.now() / 1000)): Hex {
  const locktime = nowSeconds + TBTC_REFUND_SECONDS;
  const hex = locktime.toString(16).padStart(8, '0');
  if (hex.length !== 8) throw new Error('Refund locktime is out of range.');
  return bytesToHex(hexBytes(hex).reverse()) as Hex;
}

export function buildDepositReceipt(
  user: Address,
  recoveryAddress: string,
  walletPublicKeyHash: Hex,
  blindingFactor: Hex,
  nowSeconds?: number,
): DepositReceipt {
  if (!isTbtcRecoveryAddress(recoveryAddress)) {
    throw new Error('Recovery address must be a Bitcoin 1… or bc1q… address you control.');
  }
  const refund = recoveryPubKeyHash(recoveryAddress);
  if (!refund) throw new Error('Could not read that Bitcoin recovery address.');
  return {
    depositor: getAddress(user),
    blindingFactor,
    walletPublicKeyHash,
    refundPublicKeyHash: bytesToHex(refund),
    refundLocktime: refundLocktime(nowSeconds),
  };
}

export function isDepositReceipt(value: unknown): value is DepositReceipt {
  if (!value || typeof value !== 'object') return false;
  const row = value as DepositReceipt;
  return isAddress(row.depositor)
    && typeof row.blindingFactor === 'string' && /^0x[0-9a-fA-F]{16}$/.test(row.blindingFactor)
    && typeof row.walletPublicKeyHash === 'string' && /^0x[0-9a-fA-F]{40}$/.test(row.walletPublicKeyHash)
    && typeof row.refundPublicKeyHash === 'string' && /^0x[0-9a-fA-F]{40}$/.test(row.refundPublicKeyHash)
    && typeof row.refundLocktime === 'string' && /^0x[0-9a-fA-F]{8}$/.test(row.refundLocktime);
}

export function isTbtcMint(value: unknown): value is TbtcMint {
  if (!value || typeof value !== 'object') return false;
  const row = value as TbtcMint;
  return row.v === 1
    && isAddress(row.user)
    && typeof row.recoveryAddress === 'string'
    && typeof row.btcAddress === 'string'
    && typeof row.createdAt === 'number'
    && typeof row.minSats === 'number'
    && isDepositReceipt(row.receipt)
    && (row.revealTx === undefined || /^0x[0-9a-fA-F]{64}$/.test(row.revealTx));
}

export function readStoredMint(user?: string | null): TbtcMint | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TBTC_MINT_STORAGE);
    if (!raw) return null;
    const mint = JSON.parse(raw) as unknown;
    if (!isTbtcMint(mint)) return null;
    if (user && getAddress(user) !== mint.user) return null;
    return mint;
  } catch {
    return null;
  }
}

export function writeStoredMint(mint: TbtcMint) {
  window.localStorage.setItem(TBTC_MINT_STORAGE, JSON.stringify(mint));
}

export function clearStoredMint() {
  window.localStorage.removeItem(TBTC_MINT_STORAGE);
}

export function depositKey(txid: string, vout: number): bigint {
  const clean = txid.startsWith('0x') ? txid.slice(2) : txid;
  if (clean.length !== 64 || !/^[0-9a-fA-F]+$/.test(clean)) throw new Error('Invalid Bitcoin transaction id.');
  return BigInt(keccak256(encodePacked(
    ['bytes32', 'uint32'],
    [bytesToHex(hexBytes(clean).reverse()), vout],
  )));
}

export function bitcoinUri(address: string, btc?: number) {
  const uri = `bitcoin:${address}`;
  if (btc === undefined || !(btc > 0)) return uri;
  return `${uri}?amount=${btc.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')}`;
}
