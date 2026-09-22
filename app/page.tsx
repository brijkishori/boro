'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccount, useConnect } from 'wagmi';
import sdk from '@farcaster/frame-sdk';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import BorrowFlow from '@/components/BorrowFlow';
import LendFlow from '@/components/LendFlow';
import RepayFlow from '@/components/RepayFlow';
import FeeHistory from '@/components/FeeHistory';
import PortfolioCard from '@/components/PortfolioCard';
import MarketGuidance from '@/components/MarketGuidance';
import QuoteBoard from '@/components/QuoteBoard';
import BtcNetworkPanel from '@/components/BtcNetworkPanel';
import CbBtcConvert from '@/components/CbBtcConvert';
import TipJar from '@/components/TipJar';
import { useRates } from '@/components/useRates';
import { formatApr, formatUsd } from '@/lib/amount';
import { isChainId, matchesAssetFilter, rankVenues, rateAssets, suggestionFor, type AssetFilter, type ChainId, type Venue, type VenueAction } from '@/lib/protocol';

type Mode = 'borrow' | 'lend' | 'repay';

export default function Dashboard() {
  const { isConnected, chain } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { payload, error, loading, refresh } = useRates();
  const [mode, setMode] = useState<Mode>('borrow');
  const [filter, setFilter] = useState<AssetFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [network, setNetwork] = useState<ChainId | 'all' | 'wallet'>('wallet');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const farcaster = connectors.find((connector) => connector.id === 'farcaster');
    if (connectors.length === 0) {
      started.current = false;
      return;
    }
    if (farcaster && !isConnected) {
      void connectAsync({ connector: farcaster }).catch(() => {
        // Outside a Farcaster frame this connector has nothing to attach to.
      });
    }
    try {
      void sdk.actions.ready();
    } catch {
      // The Farcaster frame SDK is a no-op outside that client.
    }
  }, [connectors, connectAsync, isConnected]);

  const action: VenueAction = mode === 'lend' ? 'lend' : 'borrow';
  const connectedChainId = chain?.id ?? 0;
  const walletChainId = isConnected && isChainId(connectedChainId) ? connectedChainId : null;
  const networkView: ChainId | 'all' = network === 'wallet' ? (walletChainId ?? 'all') : network;
  const allForAction = useMemo(() => {
    return rankVenues(
      (payload?.venues ?? []).filter((venue) => venue.action === action && (networkView === 'all' || venue.chainId === networkView)),
      action,
    );
  }, [payload, action, networkView]);
  const ranked = useMemo(() => allForAction.filter((venue) => matchesAssetFilter(venue, filter)), [allForAction, filter]);
  const ratings = useMemo(() => rateAssets(allForAction, action), [allForAction, action]);
  const suggestion = useMemo(() => suggestionFor(ranked, action), [ranked, action]);
  const best = suggestion.venue;
  const suggested = mode === 'borrow' && suggestion.pickedForConfidence;
  const pinnedVenue = pinned ? ranked.find((venue) => venue.id === selectedId) ?? null : null;
  const selected = pinnedVenue ?? best;
  const btcPrice = payload?.btcPriceUsd ?? 0;
  const networkOptions: { id: ChainId | 'all'; label: string }[] = [
    { id: 8453, label: 'Base' },
    { id: 1, label: 'Ethereum' },
    { id: 'all', label: 'All networks' },
  ];

  function chooseVenue(id: string) {
    setPinned(true);
    setSelectedId(id);
  }

  function openPosition(venue: Venue, next: 'repay' | 'lend') {
    setNetwork(venue.chainId === walletChainId ? 'wallet' : venue.chainId);
    setFilter('all');
    setMode(next);
    chooseVenue(venue.id);
  }

  return (
    <div className="space-y-4">
      <PortfolioCard venues={payload?.venues ?? []} btcPrice={btcPrice} onOpen={openPosition} />
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">Bitcoin</p>
            <p className="text-lg font-bold">{btcPrice > 0 ? formatUsd(btcPrice) : 'Loading...'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">{mode === 'lend' ? 'Best supply APY' : suggested ? 'Suggested APR' : 'Lowest borrow APR'}</p>
            <p className="text-lg font-bold">{best ? formatApr(mode === 'lend' ? best.supplyApr : best.borrowApr) : '—'}</p>
            {suggested && suggestion.anchor && <p className="text-[10px] text-muted-foreground">Cheapest deep pool {formatApr(suggestion.anchor.borrowApr)}</p>}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {loading ? 'Loading live markets...' : payload ? `Updated ${new Date(payload.fetchedAt).toLocaleTimeString()}` : 'Rates unavailable'}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>Refresh</Button>
      </div>
      {error && <p className="text-xs font-medium text-red-500">{error}</p>}
      {payload?.warnings.map((warning) => (
        <p key={warning} className="text-xs text-orange-500">{warning}</p>
      ))}

      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Pools on</p>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
          {networkOptions.map((option) => (
            <button
              key={String(option.id)}
              type="button"
              aria-pressed={networkView === option.id}
              className={`rounded-md px-2 py-1.5 text-xs font-semibold transition ${networkView === option.id ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              onClick={() => {
                setPinned(false);
                setNetwork(option.id === walletChainId ? 'wallet' : option.id);
              }}
            >
              {option.label}{option.id === walletChainId ? ' · wallet' : ''}
            </button>
          ))}
        </div>
        {walletChainId && networkView !== 'all' && networkView !== walletChainId && (
          <p className="text-[11px] text-muted-foreground">Your wallet is on {walletChainId === 1 ? 'Ethereum' : 'Base'}. These pools need a network switch before you can sign.</p>
        )}
      </div>

      <MarketGuidance
        action={action}
        ratings={ratings}
        suggestion={suggestion}
        onPick={(venue) => {
          if (venue.assetSymbol === 'tBTC' || venue.assetSymbol === 'WBTC' || venue.assetSymbol === 'cbBTC') {
            setFilter(venue.assetSymbol);
          }
          chooseVenue(venue.id);
        }}
      />
      <QuoteBoard
        action={action}
        venues={ranked}
        selectedId={selected?.id ?? null}
        recommendedId={best?.id ?? null}
        filter={filter}
        onFilter={(next) => {
          setPinned(false);
          setFilter(next);
        }}
        onSelect={chooseVenue}
      />

      <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
        <TabsList className="mb-4 grid h-12 w-full grid-cols-3">
          <TabsTrigger value="borrow" className="text-sm font-bold">Borrow</TabsTrigger>
          <TabsTrigger value="lend" className="text-sm font-bold">Lend</TabsTrigger>
          <TabsTrigger value="repay" className="text-sm font-bold">Repay</TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === 'borrow' && <BorrowFlow key={selected?.id ?? 'borrow'} quote={selected} fetchedAt={payload?.fetchedAt ?? 0} venues={ranked} onSelect={chooseVenue} />}
      {mode === 'lend' && <LendFlow key={selected?.id ?? 'lend'} quote={selected} fetchedAt={payload?.fetchedAt ?? 0} venues={ranked} onSelect={chooseVenue} />}
      {mode === 'repay' && <RepayFlow key={selected?.id ?? 'repay'} quote={selected} venues={ranked} onSelect={chooseVenue} />}

      <FeeHistory />

      <details className="rounded-xl border bg-card px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold">Bitcoin balance and cbBTC conversion</summary>
        <div className="mt-3 space-y-3">
          <BtcNetworkPanel btcPriceUsd={btcPrice} />
          <CbBtcConvert />
        </div>
      </details>

      <section id="how-it-works" className="mt-8 border-t border-muted pt-8">
        <h2 className="mb-4 text-center text-lg font-bold">How to use Simple<span className="text-blue-500">BTC</span></h2>
        <div className="grid gap-3">
          {[
            ['Read Bitcoin, or connect an EVM wallet', 'The Bitcoin panel reads a mainnet balance. Lending and borrowing execute from your Ethereum or Base wallet.'],
            ['Compare Morpho and Aave', 'Borrow mode suggests a deep, established pool when its APR is within 0.25% of the cheapest. Lend mode highlights the highest BTC supply APY. Direct BTC markets use tBTC.'],
            ['Supply, then borrow inside the safety buffer', 'Transactions use the on-chain oracle or Aave account data. Borrowing is capped at 90% of the protocol maximum.'],
            ['Repay, then withdraw', 'Repay the selected market, including interest, before collateral can be withdrawn.'],
          ].map(([title, body], index) => (
            <div key={title} className="flex items-start gap-3 rounded-xl border bg-card p-3 shadow-sm">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">{index + 1}</div>
              <div>
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-8 flex flex-col items-center space-y-4 border-t border-muted pb-4 pt-6">
        <TipJar />
        <p className="px-4 text-center text-[10px] text-muted-foreground">
          DeFi involves liquidation and smart-contract risk. Not financial advice.<br />
          © {new Date().getFullYear()} Simple<span className="text-blue-500">BTC</span> Borrow.
        </p>
      </footer>
    </div>
  );
}
