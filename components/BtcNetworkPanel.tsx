'use client';

import { useState } from 'react';
import WalletQr from '@/components/WalletQr';
import { useBitcoinAccount } from '@/components/useBitcoinAccount';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { formatBtcFromSats, formatUsd } from '@/lib/amount';

export default function BtcNetworkPanel({ btcPriceUsd }: { btcPriceUsd: number }) {
  const bitcoin = useBitcoinAccount();
  const [draft, setDraft] = useState('');

  const confirmedBtc = bitcoin.address ? formatBtcFromSats(bitcoin.confirmedSats) : null;
  const confirmedUsd = bitcoin.address && btcPriceUsd > 0 ? (bitcoin.confirmedSats / 1e8) * btcPriceUsd : null;

  return (
    <Card className="border-muted shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-sm font-semibold">Bitcoin network</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Paste the Bitcoin receive address from Coinbase Wallet → Bitcoin → Receive. This page then reads the on-chain balance. Lending still settles on Ethereum or Base through tBTC.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={draft || bitcoin.address}
            onChange={(event) => setDraft(event.target.value.trim())}
            placeholder="bc1... or a legacy address"
            spellCheck={false}
            autoCapitalize="off"
            className="h-11 font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={bitcoin.loading}
              onClick={() => void bitcoin.apply(draft || bitcoin.address)}
            >
              {bitcoin.loading ? 'Reading...' : 'Read balance'}
            </Button>
            <Button
              type="button"
              className="h-11 bg-blue-600 text-white hover:bg-blue-700"
              disabled={bitcoin.connecting}
              onClick={() => void bitcoin.connect()}
            >
              {bitcoin.connecting ? 'Looking…' : 'Use wallet'}
            </Button>
          </div>
        </div>
        {bitcoin.awaitingAddress && (
          <div className="space-y-2 rounded-lg border p-3">
            <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
              <li>Open Coinbase Wallet → Bitcoin → Receive.</li>
              <li>Copy the SegWit address that starts with bc1q.</li>
              <li>Paste it here, or tap Paste from clipboard.</li>
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
        <button
          type="button"
          className="text-left text-xs font-semibold text-blue-600 underline-offset-2 hover:underline"
          onClick={() => void bitcoin.pairOther()}
        >
          I use UniSat, OKX, or Phantom
        </button>
        {bitcoin.hint && <p className="text-xs text-muted-foreground">{bitcoin.hint}</p>}
        {bitcoin.error && <p className="text-xs font-medium text-red-500">{bitcoin.error}</p>}
        {bitcoin.address && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Confirmed</p>
              <p className="font-bold">{confirmedBtc} BTC</p>
              <p className="text-xs text-muted-foreground">{confirmedUsd === null ? 'Price unavailable' : formatUsd(confirmedUsd)}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Address</p>
              <p className="break-all font-mono text-xs">{bitcoin.address}</p>
            </div>
          </div>
        )}
        {bitcoin.address && bitcoin.unconfirmedSats !== 0 && (
          <p className="text-xs text-muted-foreground">
            Unconfirmed change: {formatBtcFromSats(Math.abs(bitcoin.unconfirmedSats))} BTC {bitcoin.unconfirmedSats > 0 ? 'incoming' : 'outgoing'}.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          To turn this Bitcoin into tBTC, use <span className="font-semibold">Get tBTC</span> above.
        </p>
      </CardContent>
    </Card>
  );
}
