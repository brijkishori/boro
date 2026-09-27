'use client';

import { useMemo, useState, useSyncExternalStore } from 'react';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { toast } from 'sonner';
import type { OpenPosition } from '@/components/useAllPositions';
import { Button } from '@/components/ui/button';
import { formatApr, formatUsd } from '@/lib/amount';
import { formatHealthFactor, formatLtv, formatPercent } from '@/lib/finance/format';
import { asBig } from '@/lib/audit';
import { episodeForVenue, useAudit } from '@/components/useAudit';
import { historyCoverage } from '@/lib/finance/history';
import { readBenchmark } from '@/lib/finance/persist';
import { readRecommendedPlans, subscribeRecommendedPlans, writeRecommendedPlan } from '@/lib/finance/recommendedAlertStore';
import {
  ALERT_ACTIONS,
  RECOMMENDED_ALERT_DEFAULTS,
  alertMarketKey,
  approveSelectedRules,
  createRecommendedPlan,
  describeRecommendedAlert,
  monthlyStatementLines,
  resumePositionAlerts,
  type AlertCategory,
  type AlertRecommendationInput,
  type MonthlyLedger,
  type StoredRecommendedPlan,
} from '@/lib/finance/recommendedAlerts';
import { chainLabel, protocolLabel, protocolMarketId } from '@/lib/protocol';

const CATEGORIES: { id: AlertCategory; label: string }[] = [
  { id: 'position-safety', label: 'Position safety' },
  { id: 'borrowing-cost', label: 'Borrowing cost' },
  { id: 'market-stress', label: 'Market stress' },
  { id: 'data-health', label: 'System' },
  { id: 'reporting', label: 'Reporting' },
];

function liveInput(loan: OpenPosition, wallet: string, benchmarkApr: number | null, custom: AlertRecommendationInput['customRateThresholds']): AlertRecommendationInput {
  const venue = loan.venue;
  const collateralAmount = Number(formatUnits(loan.snapshot.collateral, venue.assetDecimals));
  const debtUsd = Number(formatUnits(loan.snapshot.debt, venue.loanDecimals));
  const coverage = historyCoverage(venue.rateHistory);
  return {
    wallet,
    chainId: venue.chainId,
    protocol: venue.protocol,
    marketId: protocolMarketId(venue),
    collateralAmount,
    debtUsd,
    oraclePriceUsd: venue.priceUsd,
    healthFactor: loan.snapshot.healthFactor,
    ltv: loan.snapshot.ltv,
    liquidationThreshold: venue.maxLtv,
    liquidationPriceUsd: loan.snapshot.liquidationPrice > 0 ? loan.snapshot.liquidationPrice : null,
    cushion: venue.priceUsd > 0 && loan.snapshot.liquidationPrice > 0
      ? (venue.priceUsd - loan.snapshot.liquidationPrice) / venue.priceUsd
      : null,
    borrowApr: venue.borrowApr,
    benchmarkApr,
    utilization: venue.utilization,
    liquidityUsd: venue.liquidityUsd,
    historyAdequate: coverage === 'adequate',
    recentBorrowApr: coverage === 'adequate' ? venue.rateHistory?.avg24h ?? null : null,
    aprChange24hBps: coverage === 'adequate' && venue.rateHistory?.avg24h !== undefined
      ? (venue.borrowApr - venue.rateHistory.avg24h) * 10_000
      : null,
    freshnessAgeMs: venue.freshness?.fetchedAt ? Date.now() - venue.freshness.fetchedAt : null,
    customRateThresholds: custom,
  };
}

const EMPTY_PLANS: StoredRecommendedPlan[] = [];

function percentInput(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed / 100;
}

function monthLedger(events: { action: string; at: number; episodeKey: string; decimals: number; interestPaid?: string; principalPaid?: string; feeWei: string; ethUsd: number | null }[], episodeKey: string | undefined): MonthlyLedger | undefined {
  if (!episodeKey) return undefined;
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  let principalRepaidUsd = 0;
  let interestPaidUsd = 0;
  let networkFeesUsd = 0;
  let pricedFees = false;
  let sawRepay = false;
  for (const event of events) {
    if (event.episodeKey !== episodeKey || event.at < start.getTime()) continue;
    if (event.action === 'repay') {
      sawRepay = true;
      principalRepaidUsd += Number(formatUnits(asBig(event.principalPaid), event.decimals));
      interestPaidUsd += Number(formatUnits(asBig(event.interestPaid), event.decimals));
    }
    if (/^\d+$/.test(event.feeWei) && event.feeWei !== '0' && event.ethUsd && event.ethUsd > 0) {
      networkFeesUsd += Number(formatUnits(BigInt(event.feeWei), 18)) * event.ethUsd;
      pricedFees = true;
    }
  }
  return {
    principalRepaidUsd: sawRepay ? principalRepaidUsd : null,
    interestPaidUsd: sawRepay ? interestPaidUsd : null,
    interestAccruedUsd: null,
    networkFeesUsd: pricedFees ? networkFeesUsd : null,
    startingDebtUsd: null,
  };
}

export default function RecommendedAlerts({
  loan,
  emailConfirmed,
  serverPlans,
}: {
  loan: OpenPosition;
  emailConfirmed: boolean;
  serverPlans?: StoredRecommendedPlan[];
}) {
  const { address } = useAccount();
  const [open, setOpen] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [preferred, setPreferred] = useState(String(RECOMMENDED_ALERT_DEFAULTS.preferredHealthFactor));
  const [customWatch, setCustomWatch] = useState('');
  const [customBreak, setCustomBreak] = useState('');
  const [customHigh, setCustomHigh] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [benchmarkApr, setBenchmarkApr] = useState<number | null>(null);
  const wallet = address ?? '';
  const storedPlans = useSyncExternalStore(subscribeRecommendedPlans, readRecommendedPlans, () => EMPTY_PLANS);
  const { events, episodes } = useAudit(address);
  const custom = useMemo(() => ({
    watch: percentInput(customWatch),
    breakEven: percentInput(customBreak),
    highCost: percentInput(customHigh),
  }), [customBreak, customHigh, customWatch]);
  const input = useMemo(
    () => liveInput(loan, wallet, benchmarkApr, benchmarkApr === null ? custom : null),
    [benchmarkApr, custom, loan, wallet],
  );
  const rules = useMemo(() => (open ? createRecommendedPlan(input, Number(preferred) || RECOMMENDED_ALERT_DEFAULTS.preferredHealthFactor).rules : []), [input, open, preferred]);
  const marketKey = alertMarketKey(input);
  const localPlan = storedPlans.find((plan) => plan.marketKey === marketKey) ?? null;
  const serverPlan = serverPlans?.find((plan) => plan.marketKey === marketKey) ?? null;
  const saved = serverPlan?.states.some((state) => state.resumePending) ? serverPlan : (localPlan ?? serverPlan);
  const resumePending = Boolean(saved?.states.some((state) => state.resumePending));
  const episode = episodeForVenue(episodes, address, loan.venue);
  const ledger = useMemo(() => monthLedger(events, episode?.key), [episode?.key, events]);

  function generate() {
    setBenchmarkApr(readBenchmark()?.annualRate ?? null);
    const next = liveInput(loan, wallet, readBenchmark()?.annualRate ?? null, null);
    setSelected(createRecommendedPlan(next).rules.map((rule) => rule.id));
    setCustomizing(false);
    setOpen(true);
  }

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function enable() {
    const preferredHealthFactor = Number(preferred);
    const plan = createRecommendedPlan(input, Number.isFinite(preferredHealthFactor) ? preferredHealthFactor : RECOMMENDED_ALERT_DEFAULTS.preferredHealthFactor);
    plan.approved = true;
    plan.rules = approveSelectedRules(rules, selected);
    if (saved?.states.length) plan.states = resumePositionAlerts(saved.states);
    writeRecommendedPlan(plan);
    if (emailConfirmed && address) {
      const response = await fetch('/api/alerts/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, plan }),
      });
      if (!response.ok) {
        toast.success('Alerts saved on this device. Confirm the email address to start delivery.');
      } else {
        toast.success('Selected alerts are on.');
      }
    } else {
      toast.success('Alerts saved on this device. Confirm an email address to start delivery.');
    }
    setOpen(false);
  }

  async function resume() {
    if (!saved) return;
    const plan = { ...saved, states: resumePositionAlerts(saved.states) };
    writeRecommendedPlan(plan);
    if (emailConfirmed && address) {
      await fetch('/api/alerts/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, plan }),
      });
    }
    toast.success('Position alerts can send again.');
  }

  return (
    <div className="space-y-2 border-t pt-2">
      <Button type="button" variant="outline" className="h-8 text-xs" onClick={generate}>Generate recommended alerts</Button>
      {saved?.approved && !open && <p className="text-muted-foreground">Recommended alerts are on for this market. Preferred safety HF {saved.preferredHealthFactor.toFixed(2)}. Generate again to review a new draft.</p>}
      {resumePending && <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => void resume()}>Resume alerts</Button>}
      {open && (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="space-y-1">
            <p className="font-semibold">Current position</p>
            <p>{protocolLabel(loan.venue.protocol)} · {chainLabel(loan.venue.chainId)} · {loan.venue.assetSymbol}/{loan.venue.loanSymbol}</p>
            <p>Collateral {input.collateralAmount} {loan.venue.assetSymbol} · Debt {formatUsd(input.debtUsd)}</p>
            <p>BTC/oracle {formatUsd(input.oraclePriceUsd)} · LTV {input.ltv === null ? '—' : formatLtv(input.ltv)} · HF {input.healthFactor === null ? '—' : formatHealthFactor(input.healthFactor)}</p>
            <p>Liquidation threshold {formatPercent(input.liquidationThreshold, 2)} · Liquidation BTC {input.liquidationPriceUsd === null ? '—' : formatUsd(input.liquidationPriceUsd)} · Cushion {input.cushion === null ? '—' : formatPercent(input.cushion, 0)}</p>
            <p>Borrow APR {formatApr(input.borrowApr)} · Benchmark {benchmarkApr === null ? 'Not saved' : formatApr(benchmarkApr)} · Utilization {typeof input.utilization === 'number' ? formatPercent(input.utilization, 0) : '—'}</p>
            <p>Preferred safety HF {preferred}. HF 1.00 is the liquidation boundary, not an alert. Nothing is sent until you enable the selection.</p>
          </div>
          {CATEGORIES.map((category) => {
            const rows = rules.filter((rule) => rule.category === category.id);
            if (rows.length === 0) return null;
            return (
              <div key={category.id} className="space-y-2">
                <p className="font-semibold uppercase">{category.label}</p>
                {rows.map((rule) => {
                  const detail = describeRecommendedAlert(rule, input);
                  return (
                    <label key={rule.id} className="block space-y-1 rounded-md border px-2 py-2">
                      <span className="flex items-start gap-2">
                        <input type="checkbox" className="mt-0.5" checked={selected.includes(rule.id)} onChange={() => toggle(rule.id)} />
                        <span>
                          <span className="font-semibold">{detail.trigger}</span>
                          <span className="block">Now: {detail.currentValue}</span>
                          {detail.equivalentLtv !== null && <span className="block">Equivalent LTV: {formatLtv(detail.equivalentLtv)}</span>}
                          {detail.equivalentBtcPrice !== null && <span className="block">BTC trigger: ~{formatUsd(detail.equivalentBtcPrice)}</span>}
                          {detail.btcDistance !== null && rule.alertType.startsWith('hf-') && <span className="block">BTC distance: {formatPercent(detail.btcDistance, 0)}</span>}
                          <span className="block text-muted-foreground">{detail.reason}</span>
                          <span className="block">{detail.action}</span>
                          <span className="block text-muted-foreground">{emailConfirmed ? 'Email' : 'Email after you confirm an address'} · {rule.persistenceMs === 0 ? 'Immediate' : `Sustained ${Math.round(rule.persistenceMs / 3_600_000)}h`} · {rule.severity}</span>
                          {rule.id === 'monthly-statement' && (
                            <span className="block">{monthlyStatementLines(input, ledger).join(' · ')}</span>
                          )}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            );
          })}
          {benchmarkApr === null && (
            <p className="text-muted-foreground">No financing benchmark is saved, so rate levels are not invented. Enter custom APR thresholds below if you want them.</p>
          )}
          {customizing && (
            <div className="grid grid-cols-2 gap-2">
              <label>Preferred HF
                <input className="mt-1 h-8 w-full rounded border bg-background px-2" inputMode="decimal" value={preferred} onChange={(event) => setPreferred(event.target.value)} />
              </label>
              {benchmarkApr === null && (
                <>
                  <label>Watch APR %
                    <input className="mt-1 h-8 w-full rounded border bg-background px-2" inputMode="decimal" value={customWatch} onChange={(event) => setCustomWatch(event.target.value)} />
                  </label>
                  <label>Break-even APR %
                    <input className="mt-1 h-8 w-full rounded border bg-background px-2" inputMode="decimal" value={customBreak} onChange={(event) => setCustomBreak(event.target.value)} />
                  </label>
                  <label>High-cost APR %
                    <input className="mt-1 h-8 w-full rounded border bg-background px-2" inputMode="decimal" value={customHigh} onChange={(event) => setCustomHigh(event.target.value)} />
                  </label>
                </>
              )}
            </div>
          )}
          <p className="text-muted-foreground">{ALERT_ACTIONS.watch}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => setCustomizing((value) => !value)}>Customize</Button>
            <Button type="button" className="h-8 bg-blue-600 text-xs text-white hover:bg-blue-700" onClick={() => void enable()}>Enable selected alerts</Button>
            <Button type="button" variant="ghost" className="h-8 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
