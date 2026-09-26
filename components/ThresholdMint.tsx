'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { toast } from 'sonner';
import BitcoinQr from '@/components/BitcoinQr';
import GasNotice from '@/components/GasNotice';
import UsdAmountField from '@/components/UsdAmountField';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBitcoinAccount } from '@/components/useBitcoinAccount';
import { GAS_UNITS, useGasCheck } from '@/components/useGasCheck';
import { useSendTx } from '@/components/useSendTx';
import { formatBtcFromSats, formatUsdExact } from '@/lib/amount';
import WalletQr from '@/components/WalletQr';
import { sendBitcoin } from '@/lib/bitcoin-wallet';
import { sendBitcoinWalletConnect } from '@/lib/bitcoin-wc';
import { isTbtcRecoveryAddress, normalizeBitcoinAddress } from '@/lib/btc';
import { chainLabel } from '@/lib/protocol';
import {
  TBTC_DEFAULT_MIN_SATS,
  TBTC_MINT_CHAIN_ID,
  TBTC_MINT_FEE_BPS,
  bitcoinUri,
  isTbtcMint,
  readStoredMint,
  writeStoredMint,
  type TbtcMint,
  type TbtcUtxo,
} from '@/lib/threshold';

type Status = {
  confirmedSats: number;
  unconfirmedSats: number;
  utxos: TbtcUtxo[];
  revealedAt: number;
};

export default function ThresholdMint({ btcPriceUsd }: { btcPriceUsd: number }) {
  const { address, chain, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendRaw, isBusy, isAwaitingWallet, confirmed } = useSendTx();
  const bitcoin = useBitcoinAccount();
  const gas = useGasCheck(TBTC_MINT_CHAIN_ID, GAS_UNITS.write);
  const [amount, setAmount] = useState<bigint | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [mint, setMint] = useState<TbtcMint | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pasted, setPasted] = useState('');
  const [revealedLocal, setRevealedLocal] = useState(false);
  const revealStarted = useRef(false);

  useEffect(() => {
    setMint(readStoredMint(address));
    setRevealedLocal(false);
    revealStarted.current = false;
  }, [address]);

  useEffect(() => {
    if (!mint) {
      setStatus(null);
      return;
    }
    const btcAddress = mint.btcAddress;
    let cancelled = false;
    async function poll() {
      try {
        const response = await fetch(`/api/threshold-mint?btc=${encodeURIComponent(btcAddress)}`, { cache: 'no-store' });
        const body = (await response.json()) as Status & { error?: string };
        if (!response.ok) throw new Error(body.error || 'Lookup failed');
        if (!cancelled) setStatus(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not read the Bitcoin deposit.');
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [mint?.btcAddress]);

  useEffect(() => {
    if (!confirmed || confirmed.action !== 'mint') return;
    setRevealedLocal(true);
    toast.success('Convert confirmed', { description: 'tBTC is minting to this wallet on Ethereum.' });
  }, [confirmed]);

  const minSats = mint?.minSats ?? TBTC_DEFAULT_MIN_SATS;
  const fundedSats = (status?.confirmedSats ?? 0) + (status?.unconfirmedSats ?? 0);
  const funded = fundedSats >= minSats;
  const revealed = revealedLocal || (status?.revealedAt ?? 0) > 0;
  const wrongChain = isConnected && chain?.id !== TBTC_MINT_CHAIN_ID;
  const tooSmall = amount !== null && amount < BigInt(minSats);
  const tooBig = amount !== null && amount > BigInt(bitcoin.sats);
  const amountSats = amount === null ? 0 : Number(amount);
  const amountBtc = amountSats / 1e8;

  async function ensureMint() {
    if (!address || !bitcoin.address) throw new Error('Connect the wallet that holds your Bitcoin.');
    if (!isTbtcRecoveryAddress(bitcoin.address)) {
      throw new Error('Threshold can only refund to a 1… or bc1q… address. Use the SegWit receive address from the wallet.');
    }
    if (mint && mint.user.toLowerCase() === address.toLowerCase() && mint.recoveryAddress === bitcoin.address) return mint;
    const response = await fetch('/api/threshold-mint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, recoveryAddress: bitcoin.address }),
    });
    const body = (await response.json()) as { mint?: unknown; error?: string };
    if (!response.ok || !isTbtcMint(body.mint)) throw new Error(body.error || 'Could not start the convert.');
    setMint(body.mint);
    writeStoredMint(body.mint);
    return body.mint;
  }

  async function reveal(nextMint: TbtcMint) {
    const response = await fetch('/api/threshold-mint/reveal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mint: nextMint }),
    });
    const body = (await response.json()) as { to?: unknown; data?: unknown; value?: unknown; error?: string };
    if (!response.ok || typeof body.to !== 'string' || typeof body.data !== 'string' || !body.data.startsWith('0x')) {
      throw new Error(body.error || 'Bitcoin arrived. Confirm the last step in the wallet.');
    }
    if (wrongChain) {
      await switchChainAsync({ chainId: TBTC_MINT_CHAIN_ID });
    }
    await sendRaw('mint', {
      to: body.to as `0x${string}`,
      data: body.data as `0x${string}`,
      value: typeof body.value === 'string' && /^\d+$/.test(body.value) ? BigInt(body.value) : 0n,
      chainId: TBTC_MINT_CHAIN_ID,
    });
  }

  useEffect(() => {
    if (!mint || !funded || revealed || revealStarted.current || busy || isBusy) return;
    revealStarted.current = true;
    void reveal(mint).catch((err) => {
      revealStarted.current = false;
      setError(err instanceof Error ? err.message : 'Confirm the convert in the wallet.');
    });
  }, [busy, funded, isBusy, mint, revealed]);

  async function convert() {
    if (!amount || tooSmall || tooBig) return;
    setBusy(true);
    setError('');
    try {
      const next = await ensureMint();
      const sent = (await sendBitcoin(next.btcAddress, amountSats))
        ?? (await sendBitcoinWalletConnect(next.btcAddress, amountSats).catch(() => null));
      if (!sent) {
        window.open(bitcoinUri(next.btcAddress, amountBtc), '_blank', 'noopener,noreferrer');
        toast.info('Confirm the Bitcoin send in your wallet.', {
          description: `Send ${formatBtcFromSats(amountSats)} BTC. This page watches the deposit and finishes the convert.`,
        });
      } else {
        toast.info('Bitcoin sent. Waiting for it to appear, then confirm once in this wallet.');
      }
      setAmount(null);
      setEpoch((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the convert.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <div>
        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Native Bitcoin</p>
        <p className="text-sm font-bold">Convert BTC to Ethereum tBTC</p>
      </div>
      {!isConnected ? (
        <p className="text-xs font-medium">Connect a wallet to convert.</p>
      ) : revealed ? (
        <p className="text-xs font-semibold text-emerald-600">
          Convert is in. tBTC is minting to this wallet on Ethereum.
        </p>
      ) : !bitcoin.address && !mint ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Coinbase Wallet does not send native Bitcoin to this page after a scan. Copy an address from a past Bitcoin receive — Receive often creates a new empty address.
          </p>
          <Button
            className="h-11 w-full bg-blue-600 text-white hover:bg-blue-700"
            disabled={bitcoin.connecting}
            onClick={() => void bitcoin.connect()}
          >
            {bitcoin.connecting
              ? 'Looking for Bitcoin…'
              : bitcoin.wallet
                ? 'Use Bitcoin in this wallet'
                : 'Use Bitcoin wallet'}
          </Button>
          {bitcoin.awaitingAddress && (
            <div className="space-y-2 rounded-lg border p-3">
              <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                <li>Open Coinbase Wallet → Bitcoin → Receive.</li>
                <li>Copy an address from a past Bitcoin receive, not a fresh Receive code.</li>
                <li>Come back here and paste it, or tap Paste from clipboard.</li>
              </ol>
              <Button type="button" className="h-11 w-full bg-blue-600 text-white hover:bg-blue-700" onClick={() => void bitcoin.readClipboard()}>
                Paste from clipboard
              </Button>
              <Button type="button" variant="ghost" className="h-9 w-full text-xs" onClick={() => bitcoin.cancel()}>
                Cancel
              </Button>
            </div>
          )}
          {bitcoin.pairingUri && bitcoin.phone && bitcoin.openHref && (
            <div className="space-y-2">
              <Button asChild className="h-11 w-full bg-blue-600 text-white hover:bg-blue-700">
                <a href={bitcoin.openHref}>Open Bitcoin wallet</a>
              </Button>
              <Button type="button" variant="ghost" className="h-9 w-full text-xs" onClick={() => bitcoin.cancel()}>
                Cancel
              </Button>
            </div>
          )}
          {bitcoin.pairingUri && !bitcoin.phone && (
            <div className="space-y-2">
              <WalletQr uri={bitcoin.scanUri || bitcoin.pairingUri} />
              <p className="text-xs text-muted-foreground">
                Scan with UniSat, OKX, or Phantom. Coinbase Wallet will not finish this pairing.
              </p>
              <Button type="button" variant="ghost" className="h-9 w-full text-xs" onClick={() => bitcoin.cancel()}>
                Cancel
              </Button>
            </div>
          )}
          <Input
            value={pasted}
            onChange={(event) => setPasted(normalizeBitcoinAddress(event.target.value))}
            placeholder="bc1q… Bitcoin receive address"
            spellCheck={false}
            autoCapitalize="off"
            className="h-11 font-mono text-xs"
          />
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            disabled={bitcoin.loading || !pasted}
            onClick={() => void bitcoin.apply(pasted)}
          >
            {bitcoin.loading ? 'Reading balance…' : 'Read this address'}
          </Button>
          <button
            type="button"
            className="w-full text-center text-xs font-semibold text-blue-600 underline-offset-2 hover:underline"
            onClick={() => void bitcoin.pairOther()}
          >
            I use UniSat, OKX, or Phantom
          </button>
          {bitcoin.hint && <p className="text-xs text-muted-foreground">{bitcoin.hint}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border p-3 text-xs">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">Your Bitcoin</p>
            <p className="mt-1 break-all font-mono">{bitcoin.address}</p>
            <p className="mt-1 font-bold">
              {formatBtcFromSats(bitcoin.sats)} BTC
              {btcPriceUsd > 0 ? ` · ${formatUsdExact((bitcoin.sats / 1e8) * btcPriceUsd)}` : ''}
            </p>
            <a
              href={`https://mempool.space/address/${encodeURIComponent(bitcoin.address)}`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block font-semibold text-blue-600 underline-offset-2 hover:underline"
            >
              {bitcoin.txCount === 0 ? 'Unused on-chain' : `${bitcoin.txCount} on-chain txs`}
            </a>
            {!bitcoin.canMint && (
              <p className="mt-2 text-amber-700 dark:text-amber-400">
                Threshold can refund only to a 1… or bc1q… address. Use the SegWit receive address from the wallet to convert.
              </p>
            )}
          </div>
          <UsdAmountField
            label="Convert BTC"
            symbol="BTC"
            decimals={8}
            priceUsd={btcPriceUsd}
            balance={BigInt(bitcoin.sats)}
            epoch={epoch}
            invalid={tooSmall || tooBig}
            disabled={bitcoin.sats === 0 || !bitcoin.canMint}
            onAmount={setAmount}
          />
          {tooSmall && (
            <p className="text-xs text-muted-foreground">
              Threshold’s minimum is {formatBtcFromSats(minSats)} BTC
              {btcPriceUsd > 0 ? ` (${formatUsdExact((minSats / 1e8) * btcPriceUsd)})` : ''}. Fee is {TBTC_MINT_FEE_BPS / 100}%.
            </p>
          )}
          {mint && fundedSats > 0 && !revealed && (
            <p className="text-xs text-muted-foreground">
              Seen {formatBtcFromSats(fundedSats)} BTC. Confirm the last wallet prompt if it is still open.
            </p>
          )}
          {mint && fundedSats === 0 && (
            <div className="space-y-2">
              <BitcoinQr value={mint.btcAddress} />
              <p className="break-all font-mono text-[11px] text-muted-foreground">{mint.btcAddress}</p>
              <p className="text-xs text-muted-foreground">
                Coinbase Wallet Send only reads a raw Bitcoin address. Send {formatBtcFromSats(amountSats || minSats)} BTC, or paste this address if scan fails.
              </p>
            </div>
          )}
          {!gas.enough && funded ? (
            <GasNotice chainId={TBTC_MINT_CHAIN_ID} symbol="tBTC" neededEth={gas.neededEth} balanceEth={gas.balanceEth} />
          ) : (
            <Button
              className="h-11 w-full bg-blue-600 text-white hover:bg-blue-700"
              disabled={busy || isBusy || bitcoin.sats === 0 || !bitcoin.canMint || !amount || tooSmall || tooBig}
              onClick={() => void convert()}
            >
              {isAwaitingWallet ? 'Confirm in wallet…' : busy || isBusy ? 'Converting…' : `Convert to ${chainLabel(TBTC_MINT_CHAIN_ID)} tBTC`}
            </Button>
          )}
        </div>
      )}
      {error && <p className="text-xs font-medium text-red-500">{error}</p>}
      {bitcoin.address && bitcoin.error && <p className="text-xs font-medium text-red-500">{bitcoin.error}</p>}
    </div>
  );
}
