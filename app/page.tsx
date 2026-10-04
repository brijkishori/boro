'use client';

import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { takeRemedyHandoff, type RemedyHandoff } from '@/lib/finance/actionPlanner';
import { advancePhase6D3AfterRepay, clearPhase6D3MixedExecution, completePhase6D3MixedExecution, markPhase6D3CollateralSubmitted, markPhase6D3RepaySubmitted, readPhase6D3MixedExecution, type Phase6D3MixedProgress } from '@/lib/finance/assistedMixed';
import { useAccount, useConnect } from 'wagmi';
import type { Address } from 'viem';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import BorrowFlow from '@/components/BorrowFlow';
import LendFlow from '@/components/LendFlow';
import RepayFlow from '@/components/RepayFlow';
import DailyLoanSnapshot from '@/components/DailyLoanSnapshot';
import { useLoanBook } from '@/components/useLoanBook';
import { useWalletHoldings } from '@/components/useWalletHoldings';
import Opportunities from '@/components/Opportunities';
import { useAllPositions } from '@/components/useAllPositions';
import MarketGuidance from '@/components/MarketGuidance';
import QuoteBoard from '@/components/QuoteBoard';
import BorrowCompare from '@/components/BorrowCompare';
import DecisionCard from '@/components/DecisionCard';
import StickyMarketBar from '@/components/StickyMarketBar';
import BorrowEducation from '@/components/BorrowEducation';

const FeeHistory = dynamic(() => import('@/components/FeeHistory'), { ssr: false });
const TbtcConvert = dynamic(() => import('@/components/TbtcConvert'), { ssr: false });
const BtcNetworkPanel = dynamic(() => import('@/components/BtcNetworkPanel'), { ssr: false });
const CbBtcConvert = dynamic(() => import('@/components/CbBtcConvert'), { ssr: false });
const TipJar = dynamic(() => import('@/components/TipJar'), { ssr: false });
import { useRates } from '@/components/useRates';
import { formatUsd } from '@/lib/amount';
import { NetworkPicker, useNetworkFilter } from '@/components/NetworkFilter';
import { plannerServerSnapshot, plannerSnapshot, subscribePlanner } from '@/lib/finance/persist';
import { MARKET_SORTS, sortVenuesByMode, type MarketSort } from '@/lib/finance/sort';
import { matchesAssetFilter, rankVenues, rateAssets, suggestionFor, type AssetFilter, type Venue, type VenueAction } from '@/lib/protocol';

type Mode = 'borrow' | 'lend' | 'repay';

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function HomePage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading markets…</p>}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const { isConnected, address } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { payload, error, loading, refresh } = useRates();
  const book = useLoanBook();
  const holdings = useWalletHoldings();
  const search = useSearchParams();
  const tabParam = search.get('tab');
  const marketParam = search.get('market');
  const urlMode: Mode | null = tabParam === 'borrow' || tabParam === 'lend' || tabParam === 'repay' ? tabParam : null;
  const [modeOverride, setModeOverride] = useState<Mode | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [filter, setFilter] = useState<AssetFilter>('all');
  const [selectedOverride, setSelectedOverride] = useState<string | null>(null);
  const [pinned, setPinned] = useState(Boolean(marketParam));
  const [exploreOpen, setExploreOpen] = useState(Boolean(marketParam || tabParam));
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [sortMode, setSortMode] = useState<MarketSort>('best-fit');
  const { network, setNetwork } = useNetworkFilter();
  const started = useRef(false);
  const [handoff, setHandoff] = useState<RemedyHandoff | null>(null);
  const [mixedProgress, setMixedProgress] = useState<Phase6D3MixedProgress | null>(null);
  const planner = useSyncExternalStore(subscribePlanner, plannerSnapshot, plannerServerSnapshot);
  
  // Use a deterministic initial mode for SSR and first render to prevent Radix ID mismatch.
  const mode = modeOverride ?? (mounted ? urlMode : null) ?? 'borrow';
  const selectedId = selectedOverride ?? marketParam;

  useEffect(() => {
    const stagedHandoff = takeRemedyHandoff(window.sessionStorage);
    const progress = readPhase6D3MixedExecution(window.sessionStorage);
    setMixedProgress(progress);

    if (!progress || progress.stage === 'COMPLETE') {
      setHandoff(stagedHandoff);
      return;
    }

    setSelectedOverride(progress.marketId);
    setPinned(true);
    setExploreOpen(true);

    if (progress.stage === 'REPAY_PENDING') {
      setModeOverride('repay');
      setHandoff(stagedHandoff?.type === 'REPAY' ? stagedHandoff : progress.repayHandoff);
      return;
    }
    if (progress.stage === 'COLLATERAL_PENDING') {
      setModeOverride('borrow');
      setHandoff(stagedHandoff?.type === 'ADD_COLLATERAL' ? stagedHandoff : progress.collateralHandoff);
      return;
    }

    // A transaction was submitted before a reload. Do not seed another transaction automatically.
    setHandoff(null);
  }, []);

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
    void import('@farcaster/frame-sdk').then(({ default: sdk }) => {
      void sdk.actions.ready();
    }).catch(() => undefined);
  }, [connectors, connectAsync, isConnected]);

  const action: VenueAction = mode === 'lend' ? 'lend' : 'borrow';
  const allForAction = useMemo(() => {
    return rankVenues(
      (payload?.venues ?? []).filter((venue) => venue.action === action && (network === 'all' || venue.chainId === network)),
      action,
    );
  }, [payload, action, network]);
  const ranked = useMemo(() => allForAction.filter((venue) => matchesAssetFilter(venue, filter)), [allForAction, filter]);
  const displayed = useMemo(
    () => sortVenuesByMode(ranked, action, sortMode, { scenario: planner.scenario, benchmark: planner.benchmark }),
    [ranked, action, sortMode, planner.scenario, planner.benchmark],
  );
  const ratings = useMemo(() => rateAssets(allForAction, action), [allForAction, action]);
  const suggestion = useMemo(() => suggestionFor(ranked, action), [ranked, action]);
  const best = suggestion.venue;
  const pinnedVenue = pinned ? ranked.find((venue) => venue.id === selectedId) ?? null : null;
  const selected = mode === 'borrow' ? pinnedVenue : (pinnedVenue ?? best);
  const inspect = selected ?? best;
  const topMatches = displayed.slice(0, 3);
  const btcPrice = payload?.btcPriceUsd ?? 0;
  const networkVenues = useMemo(
    () => (payload?.venues ?? []).filter((venue) => network === 'all' || venue.chainId === network),
    [payload, network],
  );
  const scenario = planner.scenario;
  const benchmark = planner.benchmark;

  function setMode(next: Mode) {
    setModeOverride(next);
  }

  function chooseVenue(id: string) {
    setPinned(true);
    setSelectedOverride(id);
  }

  function openPosition(venue: Venue, next: Mode) {
    setNetwork(venue.chainId);
    setFilter('all');
    setMode(next);
    chooseVenue(venue.id);
  }

  function compareAlternatives() {
    setExplorerOpen(true);
    scrollToId('market-explorer');
  }

  function reviewMarket() {
    if (!selected) return;
    setExplorerOpen(true);
    requestAnimationFrame(() => scrollToId(`market-${selected.id}`));
  }

  function reviewTransaction() {
    scrollToId('execution-workflow');
  }

  function handleCompareMarkets() {
    setExploreOpen(true);
    scrollToId('explore-borrowing-markets');
  }

  function handleRepayLoan(venue: Venue) {
    openPosition(venue, 'repay');
    setExploreOpen(true);
    scrollToId('execution-workflow');
  }

  function showMixedLeg(progress: Phase6D3MixedProgress, stage: 'REPAY_PENDING' | 'COLLATERAL_PENDING') {
    setMixedProgress(progress);
    setSelectedOverride(progress.marketId);
    setPinned(true);
    setExploreOpen(true);
    if (stage === 'REPAY_PENDING') {
      setModeOverride('repay');
      setHandoff(progress.repayHandoff);
      window.history.replaceState(null, '', `/?tab=repay&market=${encodeURIComponent(progress.marketId)}&mixed=1`);
    } else {
      setModeOverride('borrow');
      setHandoff(progress.collateralHandoff);
      window.history.replaceState(null, '', `/?tab=borrow&market=${encodeURIComponent(progress.marketId)}&mixed=1`);
    }
    requestAnimationFrame(() => scrollToId('execution-workflow'));
  }

  function handleMixedRepaySubmitted(hash: string) {
    if (!mixedProgress || (mixedProgress.stage !== 'REPAY_PENDING' && mixedProgress.stage !== 'REPAY_SUBMITTED')) return;
    const next = markPhase6D3RepaySubmitted(window.sessionStorage, mixedProgress.id, hash);
    if (next) setMixedProgress(next);
  }

  function handleMixedRepayComplete() {
    if (!mixedProgress || (mixedProgress.stage !== 'REPAY_PENDING' && mixedProgress.stage !== 'REPAY_SUBMITTED')) return;
    const next = advancePhase6D3AfterRepay(window.sessionStorage, mixedProgress.id);
    if (!next || next.stage !== 'COLLATERAL_PENDING') return;
    showMixedLeg(next, 'COLLATERAL_PENDING');
  }

  function handleMixedCollateralSubmitted(hash: string) {
    if (!mixedProgress || (mixedProgress.stage !== 'COLLATERAL_PENDING' && mixedProgress.stage !== 'COLLATERAL_SUBMITTED')) return;
    const next = markPhase6D3CollateralSubmitted(window.sessionStorage, mixedProgress.id, hash);
    if (next) setMixedProgress(next);
  }

  function handleMixedCollateralComplete() {
    if (!mixedProgress || (mixedProgress.stage !== 'COLLATERAL_PENDING' && mixedProgress.stage !== 'COLLATERAL_SUBMITTED')) return;
    const next = completePhase6D3MixedExecution(window.sessionStorage, mixedProgress.id);
    if (!next) return;
    setMixedProgress(next);
    setHandoff(null);
  }

  function resumeMixedAfterVerifiedRepay() {
    if (!mixedProgress || mixedProgress.stage !== 'REPAY_SUBMITTED') return;
    const next = advancePhase6D3AfterRepay(window.sessionStorage, mixedProgress.id);
    if (next?.stage === 'COLLATERAL_PENDING') showMixedLeg(next, 'COLLATERAL_PENDING');
  }

  function finishMixedAfterVerifiedCollateral() {
    if (!mixedProgress || mixedProgress.stage !== 'COLLATERAL_SUBMITTED') return;
    const next = completePhase6D3MixedExecution(window.sessionStorage, mixedProgress.id);
    if (next) {
      setMixedProgress(next);
      setHandoff(null);
    }
  }

  function dismissMixedProgress() {
    clearPhase6D3MixedExecution(window.sessionStorage);
    setMixedProgress(null);
    setHandoff(null);
  }

  return (
    <div className={`space-y-4 ${selected && mode === 'borrow' ? 'pb-20 md:pb-0' : ''}`}>
      <NetworkPicker onChange={() => setPinned(false)} />

      <DailyLoanSnapshot
        views={book.views}
        active={book.active}
        isConnected={isConnected}
        holdings={holdings}
        onCompareMarkets={handleCompareMarkets}
        onRepayLoan={handleRepayLoan}
      />

      <details
        id="explore-borrowing-markets"
        className="rounded-xl border bg-card px-4 py-3"
        open={exploreOpen}
        onToggle={(event) => setExploreOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm font-semibold">Explore borrowing markets</summary>
        <div className="mt-4 space-y-4">
          <HomeOpportunities
            mode={mode}
            venues={networkVenues}
            address={address}
            onOpen={openPosition}
            onShowLend={() => setMode('lend')}
          />

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Bitcoin</p>
              <p className="text-lg font-bold">{btcPrice > 0 ? formatUsd(btcPrice) : 'Loading...'}</p>
              <p className="text-[11px] text-muted-foreground">
                {loading ? 'Loading live markets...' : payload ? `Updated ${new Date(payload.fetchedAt).toLocaleTimeString()}` : 'Rates unavailable'}
              </p>
            </div>
            <Button type="button" variant="outline" className="h-11" onClick={() => void refresh()}>Refresh</Button>
          </div>
          {error && <p className="text-xs font-medium text-red-500">{error}</p>}
          {payload?.warnings.map((warning) => (
            <p key={warning} className="text-xs text-orange-500">{warning}</p>
          ))}

          {mode === 'borrow' && (
            <>
              <BorrowCompare venue={inspect} btcPrice={btcPrice} stored={planner} />
              {scenario && selected && (
                <DecisionCard
                  venue={selected}
                  scenario={scenario}
                  benchmark={benchmark}
                  btcPrice={btcPrice}
                  onCompare={compareAlternatives}
                  onReviewMarket={reviewMarket}
                  onReviewTransaction={reviewTransaction}
                />
              )}
              <section id="top-markets" className="space-y-2">
                <h2 className="text-sm font-semibold">Top matching markets</h2>
                <p className="text-[11px] text-muted-foreground">
                  Suggested is a suitability pick, not the lowest current APR alone. Selected stays separate until you tap a market.
                </p>
                <div className="flex flex-wrap gap-2">
                  {MARKET_SORTS.map((item) => (
                    <Button
                      key={item.id}
                      type="button"
                      size="sm"
                      variant={sortMode === item.id ? 'default' : 'outline'}
                      className={`h-10 ${sortMode === item.id ? 'bg-blue-600 text-white hover:bg-blue-700' : ''}`}
                      onClick={() => setSortMode(item.id)}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
                <QuoteBoard
                  action={action}
                  venues={topMatches}
                  peers={ranked}
                  selectedId={selected?.id ?? null}
                  recommendedId={best?.id ?? null}
                  onSelect={chooseVenue}
                  scenario={scenario}
                  benchmark={benchmark}
                  btcPrice={btcPrice}
                  showFilters={false}
                  prefetchHistory
                />
              </section>
              <details id="market-explorer" className="rounded-xl border bg-card px-4 py-3" open={explorerOpen} onToggle={(event) => setExplorerOpen(event.currentTarget.open)}>
                <summary className="cursor-pointer text-sm font-semibold">All markets</summary>
                <div className="mt-3 space-y-3">
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
                    venues={displayed}
                    selectedId={selected?.id ?? null}
                    recommendedId={best?.id ?? null}
                    filter={filter}
                    onFilter={(next) => {
                      setPinned(false);
                      setFilter(next);
                    }}
                    onSelect={chooseVenue}
                    scenario={scenario}
                    benchmark={benchmark}
                    btcPrice={btcPrice}
                    cardAnchor
                  />
                </div>
              </details>
            </>
          )}

          {mode !== 'borrow' && (
            <>
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
                btcPrice={btcPrice}
                cardAnchor
              />
            </>
          )}

          {mixedProgress && (
            <Card className="border-blue-500/40">
              <CardContent className="space-y-2 p-4 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">Phase 6D.3 mixed recovery</p>
                    <p className="text-xs text-muted-foreground">
                      {mixedProgress.stage === 'REPAY_PENDING' && 'Step 1 of 2: review and confirm the USDC repayment.'}
                      {mixedProgress.stage === 'REPAY_SUBMITTED' && 'Repayment transaction submitted. Do not resubmit after a reload; verify the repayment is reflected before continuing.'}
                      {mixedProgress.stage === 'COLLATERAL_PENDING' && 'Step 2 of 2: the repayment reconciled. Review and confirm the cbBTC collateral addition using the updated live position.'}
                      {mixedProgress.stage === 'COLLATERAL_SUBMITTED' && 'Collateral transaction submitted. Do not resubmit after a reload; verify the collateral is reflected before finishing.'}
                      {mixedProgress.stage === 'COMPLETE' && 'Mixed recovery complete. Both position-changing legs confirmed and reconciled.'}
                    </p>
                  </div>
                  {mixedProgress.stage === 'COMPLETE' && <Button type="button" size="sm" variant="outline" onClick={dismissMixedProgress}>Dismiss</Button>}
                </div>
                {mixedProgress.stage === 'REPAY_SUBMITTED' && (
                  <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                    <p className="font-semibold">Reload recovery safeguard</p>
                    <p>Only continue after Loans/Morpho shows that the repayment actually landed. If only an approval occurred, cancel this mixed recovery and start it again.</p>
                    <div className="mt-2 flex gap-2">
                      <Button type="button" size="sm" onClick={resumeMixedAfterVerifiedRepay}>Repayment is reflected — continue</Button>
                      <Button type="button" size="sm" variant="outline" onClick={dismissMixedProgress}>Cancel mixed recovery</Button>
                    </div>
                  </div>
                )}
                {mixedProgress.stage === 'COLLATERAL_SUBMITTED' && (
                  <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                    <p className="font-semibold">Reload recovery safeguard</p>
                    <p>Only finish after Loans/Morpho shows the collateral increase. This prevents an accidental duplicate supply after a reload.</p>
                    <div className="mt-2 flex gap-2">
                      <Button type="button" size="sm" onClick={finishMixedAfterVerifiedCollateral}>Collateral is reflected — finish</Button>
                      <Button type="button" size="sm" variant="outline" onClick={dismissMixedProgress}>Cancel mixed recovery</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Tabs value={mode} onValueChange={(value) => setMode(value as Mode)}>
            <TabsList className="mb-2 grid h-12 w-full grid-cols-3">
              <TabsTrigger value="borrow" className="text-sm font-bold">Borrow</TabsTrigger>
              <TabsTrigger value="lend" className="text-sm font-bold">Lend</TabsTrigger>
              <TabsTrigger value="repay" className="text-sm font-bold">Repay</TabsTrigger>
            </TabsList>

            <section id="execution-workflow">
              <TabsContent value="borrow">
                {!selected && (
                  <Card>
                    <CardContent className="space-y-3 p-4">
                      <p className="text-sm font-semibold">Select a market to continue</p>
                      <p className="text-xs text-muted-foreground">
                        Choose a market above to set the protocol, chain, and assets. A saved planning scenario stays separate until you load it.
                      </p>
                      <Button type="button" className="h-11" onClick={() => scrollToId('top-markets')}>Compare markets</Button>
                    </CardContent>
                  </Card>
                )}
                {selected && (
                  <BorrowFlow
                    key={selected.id}
                    quote={selected}
                    fetchedAt={payload?.fetchedAt ?? 0}
                    venues={ranked}
                    onSelect={chooseVenue}
                    initialCollateral={scenario?.collateralAmount}
                    initialBorrowUsd={scenario?.borrowAmount}
                    handoff={handoff && selected && handoff.marketId === selected.id && handoff.type === 'ADD_COLLATERAL' ? handoff : null}
                    onAssistedSubmitted={mixedProgress && (mixedProgress.stage === 'COLLATERAL_PENDING' || mixedProgress.stage === 'COLLATERAL_SUBMITTED') ? handleMixedCollateralSubmitted : undefined}
                    onAssistedComplete={mixedProgress && (mixedProgress.stage === 'COLLATERAL_PENDING' || mixedProgress.stage === 'COLLATERAL_SUBMITTED') ? handleMixedCollateralComplete : undefined}
                  />
                )}
              </TabsContent>
              <TabsContent value="lend">
                <LendFlow key={selected?.id ?? 'lend'} quote={selected} fetchedAt={payload?.fetchedAt ?? 0} venues={ranked} onSelect={chooseVenue} />
              </TabsContent>
              <TabsContent value="repay">
                <RepayFlow
                  key={selected?.id ?? 'repay'}
                  quote={selected}
                  venues={ranked}
                  onSelect={chooseVenue}
                  handoff={handoff && selected && handoff.marketId === selected.id && handoff.type === 'REPAY' ? handoff : null}
                  onAssistedSubmitted={mixedProgress && (mixedProgress.stage === 'REPAY_PENDING' || mixedProgress.stage === 'REPAY_SUBMITTED') ? handleMixedRepaySubmitted : undefined}
                  onAssistedComplete={mixedProgress && (mixedProgress.stage === 'REPAY_PENDING' || mixedProgress.stage === 'REPAY_SUBMITTED') ? handleMixedRepayComplete : undefined}
                />
              </TabsContent>
            </section>
          </Tabs>

          <details className="rounded-xl border bg-card px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold">Convert Bitcoin and fee history</summary>
            <div className="mt-3 space-y-3">
              <FeeHistory />
              <TbtcConvert btcPriceUsd={btcPrice} />
              <BtcNetworkPanel btcPriceUsd={btcPrice} />
              <CbBtcConvert />
            </div>
          </details>

          <BorrowEducation />
        </div>
      </details>

      <footer className="mt-8 flex flex-col items-center space-y-4 border-t border-muted pb-4 pt-6">
        <TipJar />
        <p className="px-4 text-center text-[10px] text-muted-foreground">
          DeFi involves liquidation and smart-contract risk. Not financial advice.<br />
          © {new Date().getFullYear()} Simple<span className="text-blue-500">BTC</span> Borrow.
        </p>
      </footer>

      {mode === 'borrow' && selected && (
        <StickyMarketBar venue={selected} scenario={scenario} btcPrice={btcPrice} onReview={reviewTransaction} />
      )}
    </div>
  );
}

function HomeOpportunities({
  mode,
  venues,
  address,
  onOpen,
  onShowLend,
}: {
  mode: Mode;
  venues: Venue[];
  address?: Address;
  onOpen: (venue: Venue, mode: Mode) => void;
  onShowLend: () => void;
}) {
  const { positions } = useAllPositions(venues, address);
  return (
    <Opportunities
      compact={mode === 'borrow'}
      positions={positions.filter((item) => item.venue.action === 'borrow')}
      venues={venues}
      onRefinance={(hint) => onOpen(hint.to, 'borrow')}
      onShowLend={onShowLend}
    />
  );
}
