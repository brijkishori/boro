import { randomBytes } from 'crypto';
import { getAddress, type Address, type Hex } from 'viem';
import { extractBitcoinTxVectors } from '@/lib/bitcoin-tx';
import { isTbtcRecoveryAddress } from '@/lib/btc';
import { publicClient } from '@/lib/rpc';
import {
  TBTC_BRIDGE,
  TBTC_DEFAULT_MIN_SATS,
  TBTC_VAULT,
  buildDepositReceipt,
  bytesToHex,
  depositBitcoinAddress,
  depositKey,
  isDepositReceipt,
  tbtcBridgeAbi,
  type DepositReceipt,
  type TbtcMint,
  type TbtcUtxo,
} from '@/lib/threshold';

type MempoolUtxo = {
  txid?: unknown;
  vout?: unknown;
  value?: unknown;
  status?: { confirmed?: unknown };
};

function asSats(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(number) || number < 0 || number > 21_000_000 * 1e8) return null;
  return number;
}

export async function createTbtcMint(user: Address, recoveryAddress: string): Promise<TbtcMint> {
  if (!isTbtcRecoveryAddress(recoveryAddress)) {
    throw new Error('Use a Bitcoin 1… or bc1q… address from a wallet you control. Exchange and taproot addresses cannot be used for recovery.');
  }
  const client = publicClient(1);
  const [walletHash, parameters] = await Promise.all([
    client.readContract({ address: TBTC_BRIDGE, abi: tbtcBridgeAbi, functionName: 'activeWalletPubKeyHash' }),
    client.readContract({ address: TBTC_BRIDGE, abi: tbtcBridgeAbi, functionName: 'depositParameters' }),
  ]);
  if (!walletHash || walletHash === '0x0000000000000000000000000000000000000000') {
    throw new Error('Threshold does not have an active Bitcoin wallet right now. Try again later.');
  }
  const dust = Number(parameters[0]);
  const minSats = Number.isFinite(dust) && dust > 0 ? dust : TBTC_DEFAULT_MIN_SATS;
  const receipt = buildDepositReceipt(
    getAddress(user),
    recoveryAddress.trim(),
    walletHash,
    bytesToHex(randomBytes(8)),
  );
  return {
    v: 1,
    user: getAddress(user),
    recoveryAddress: recoveryAddress.trim(),
    btcAddress: depositBitcoinAddress(receipt),
    createdAt: Date.now(),
    minSats,
    receipt,
  };
}

export async function readDepositUtxos(address: string): Promise<TbtcUtxo[]> {
  const response = await fetch(`https://mempool.space/api/address/${encodeURIComponent(address)}/utxo`, {
    headers: { Accept: 'application/json', 'User-Agent': 'boro/1.0' },
    signal: AbortSignal.timeout(8_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Could not read that Bitcoin address.');
  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) throw new Error('Bitcoin network returned an unexpected UTXO list.');
  const utxos: TbtcUtxo[] = [];
  for (const item of body as MempoolUtxo[]) {
    if (typeof item.txid !== 'string' || !/^[0-9a-fA-F]{64}$/.test(item.txid)) continue;
    if (typeof item.vout !== 'number' || !Number.isInteger(item.vout) || item.vout < 0) continue;
    const value = asSats(item.value);
    if (value === null) continue;
    utxos.push({
      txid: item.txid,
      vout: item.vout,
      value,
      confirmed: item.status?.confirmed === true,
    });
  }
  return utxos.sort((left, right) => right.value - left.value || Number(right.confirmed) - Number(left.confirmed));
}

export async function revealedAt(utxo: TbtcUtxo): Promise<number> {
  const deposit = await publicClient(1).readContract({
    address: TBTC_BRIDGE,
    abi: tbtcBridgeAbi,
    functionName: 'deposits',
    args: [depositKey(utxo.txid, utxo.vout)],
  });
  return Number(deposit[2]);
}

export async function encodeRevealDeposit(user: Address, receipt: DepositReceipt, utxo: TbtcUtxo) {
  if (!isDepositReceipt(receipt)) throw new Error('Deposit receipt is invalid.');
  if (getAddress(user) !== getAddress(receipt.depositor)) {
    throw new Error('This deposit belongs to a different Ethereum wallet.');
  }
  const response = await fetch(`https://mempool.space/api/tx/${encodeURIComponent(utxo.txid)}/hex`, {
    headers: { Accept: 'text/plain', 'User-Agent': 'boro/1.0' },
    signal: AbortSignal.timeout(8_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Could not load the Bitcoin funding transaction.');
  const hex = (await response.text()).trim();
  const vectors = extractBitcoinTxVectors(hex);
  return {
    address: TBTC_BRIDGE,
    abi: tbtcBridgeAbi,
    functionName: 'revealDeposit' as const,
    args: [
      {
        version: vectors.version,
        inputVector: vectors.inputs,
        outputVector: vectors.outputs,
        locktime: vectors.locktime,
      },
      {
        fundingOutputIndex: utxo.vout,
        blindingFactor: receipt.blindingFactor,
        walletPubKeyHash: receipt.walletPublicKeyHash,
        refundPubKeyHash: receipt.refundPublicKeyHash,
        refundLocktime: receipt.refundLocktime,
        vault: TBTC_VAULT,
      },
    ] as const,
    chainId: 1,
  };
}
