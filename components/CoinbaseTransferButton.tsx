'use client';

import { useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

const MANUAL_HELP = 'https://help.coinbase.com/coinbase/trading-and-funding/sending-or-receiving-cryptocurrency/coinbase-wrapped-btc';
let configPromise: Promise<boolean> | null = null;

function loadConfigured() {
  configPromise ??= fetch('/api/onramp', { cache: 'no-store' })
    .then((response) => response.json() as Promise<{ configured?: unknown }>)
    .then((body) => body.configured === true)
    .catch(() => false);
  return configPromise;
}

export default function CoinbaseTransferButton({ usd, className, label = 'Move BTC from Coinbase' }: { usd?: number; className?: string; label?: string }) {
  const { address } = useAccount();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void loadConfigured().then((value) => {
      if (live) setConfigured(value);
    });
    return () => {
      live = false;
    };
  }, []);

  async function open() {
    if (!address) return;
    if (!configured) {
      window.open(MANUAL_HELP, '_blank', 'noopener,noreferrer');
      return;
    }
    const popup = window.open('about:blank', 'coinbase-transfer', 'width=460,height=760');
    setBusy(true);
    try {
      const response = await fetch('/api/onramp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, usd }),
      });
      const body = (await response.json().catch(() => ({}))) as { url?: unknown; error?: unknown };
      if (!response.ok || typeof body.url !== 'string' || !body.url.startsWith('https://pay.coinbase.com/')) {
        popup?.close();
        toast.error(typeof body.error === 'string' ? body.error : 'Coinbase did not start the transfer.');
        return;
      }
      if (popup && !popup.closed) {
        popup.opener = null;
        popup.location.href = body.url;
      } else {
        window.location.assign(body.url);
      }
      toast.info('Finish the transfer in the Coinbase window.', {
        description: 'Coinbase sends your BTC to this wallet as cbBTC on Base, 1:1. It usually lands within a few minutes, and the balance here updates on its own.',
        duration: 12_000,
      });
    } catch {
      popup?.close();
      toast.error('Could not reach Coinbase. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type="button" className={className ?? 'bg-blue-600 text-white hover:bg-blue-700'} disabled={!address || busy || configured === null} onClick={() => void open()}>
      {busy ? 'Opening Coinbase…' : configured === false ? 'How to send BTC from Coinbase' : label}
    </Button>
  );
}
