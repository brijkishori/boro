'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatBtcFromSats, formatUsd } from '@/lib/amount';
import { isBitcoinMainnetAddress } from '@/lib/btc';

type Snapshot = {
  address: string;
  confirmedSats: number;
  unconfirmedSats: number;
  txCount: number;
  fees: { fastest: number; halfHour: number; economy: number };
};

const STORAGE_KEY = 'boro_btc_address';

type BitcoinProvider = {
  requestAccounts?: () => Promise<string[]>;
};

export default function BtcNetworkPanel({ btcPriceUsd }: { btcPriceUsd: number }) {
  const [address, setAddress] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasWallet, setHasWallet] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) ?? '';
    if (isBitcoinMainnetAddress(saved)) setAddress(saved);
    setHasWallet(typeof (window as Window & { unisat?: BitcoinProvider }).unisat?.requestAccounts === 'function');
  }, []);

  async function lookup(nextAddress: string) {
    const trimmed = nextAddress.trim();
    if (!isBitcoinMainnetAddress(trimmed)) {
      setSnapshot(null);
      setError('Enter a valid Bitcoin mainnet address.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/btc?address=${encodeURIComponent(trimmed)}`, { cache: 'no-store' });
      const body = (await response.json()) as Snapshot & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Lookup failed');
      setSnapshot(body);
      window.localStorage.setItem(STORAGE_KEY, trimmed);
    } catch (err) {
      setSnapshot(null);
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }

  async function connectWallet() {
    const provider = (window as Window & { unisat?: BitcoinProvider }).unisat;
    if (!provider?.requestAccounts) {
      setError('No Bitcoin wallet was found. Paste an address instead.');
      return;
    }
    try {
      const accounts = await provider.requestAccounts();
      const next = accounts[0] ?? '';
      if (!isBitcoinMainnetAddress(next)) {
        setError('The wallet returned an address this app will not use.');
        return;
      }
      setAddress(next);
      await lookup(next);
    } catch {
      setError('Bitcoin wallet connection was rejected.');
    }
  }

  const confirmedBtc = snapshot ? formatBtcFromSats(snapshot.confirmedSats) : null;
  const confirmedUsd = snapshot && btcPriceUsd > 0 ? (snapshot.confirmedSats / 1e8) * btcPriceUsd : null;

  return (
    <Card className="border-muted shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Bitcoin network</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Reads your Bitcoin balance from the public network. Lending still settles on Ethereum or Base through tBTC, which is backed by native BTC and does not use cbBTC. This app never creates a deposit address and never asks for a Bitcoin private key.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={address}
            onChange={(event) => setAddress(event.target.value.trim())}
            placeholder="bc1... or a legacy address"
            spellCheck={false}
            autoCapitalize="off"
            className="h-11 font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-11" disabled={loading} onClick={() => void lookup(address)}>
              {loading ? 'Reading...' : 'Read balance'}
            </Button>
            {hasWallet && (
              <Button type="button" className="h-11 bg-blue-600 text-white hover:bg-blue-700" onClick={() => void connectWallet()}>
                Wallet
              </Button>
            )}
          </div>
        </div>
        {error && <p className="text-xs font-medium text-red-500">{error}</p>}
        {snapshot && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Confirmed</p>
              <p className="font-bold">{confirmedBtc} BTC</p>
              <p className="text-xs text-muted-foreground">{confirmedUsd === null ? 'Price unavailable' : formatUsd(confirmedUsd)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Next block fee</p>
              <p className="font-bold">{snapshot.fees.fastest} sat/vB</p>
              <p className="text-xs text-muted-foreground">{snapshot.txCount.toLocaleString()} confirmed txs</p>
            </div>
          </div>
        )}
        {snapshot && snapshot.unconfirmedSats !== 0 && (
          <p className="text-xs text-muted-foreground">
            Unconfirmed change: {formatBtcFromSats(Math.abs(snapshot.unconfirmedSats))} BTC {snapshot.unconfirmedSats > 0 ? 'incoming' : 'outgoing'}.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          To turn this Bitcoin into tBTC, use <span className="font-semibold">Get tBTC</span> above. If you already hold cbBTC, swap it there. Native BTC uses Threshold’s current mint at{' '}
          <a href="https://app.threshold.network/" target="_blank" rel="noreferrer" className="font-semibold text-blue-600 hover:underline">
            app.threshold.network
          </a>
          , not the old dashboard.
        </p>
      </CardContent>
    </Card>
  );
}
