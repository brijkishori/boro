import Link from 'next/link';
import { formatUsd } from '@/lib/amount';
import {
  PACE_DISCLAIMER,
  PACE_LABEL,
  TREND_UNAVAILABLE,
  reachesBoundaryCopy,
  type AttentionState,
  type EarlyWarning,
} from '@/lib/finance/earlyWarning';
import { formatHealthFactor, formatPercent } from '@/lib/finance/format';
import { riskSeverityStatus, type StatusPresentation } from '@/lib/finance/riskStatus';
import { StatusBadge } from '@/components/RiskStatus';

function attentionStatus(state: AttentionState): StatusPresentation {
  if (state === 'DATA_WARNING') return { tone: 'data', mark: '!', label: 'DATA WARNING' };
  if (state === 'PREPARE') return { tone: 'prepare', mark: '▲', label: 'PREPARE' };
  if (state === 'MONITOR') return { tone: 'watch', mark: '◉', label: 'MONITOR' };
  return { tone: 'normal', mark: '●', label: 'NONE' };
}

function trendStatus(warning: EarlyWarning): StatusPresentation {
  if (warning.hfDirection === 'IMPROVING') return { tone: 'normal', mark: '↑', label: 'IMPROVING' };
  if (warning.hfDirection === 'DETERIORATING SLIGHTLY') {
    return { tone: 'watch', mark: '↓', label: 'DETERIORATING SLIGHTLY' };
  }
  if (warning.hfDirection === 'DETERIORATING') {
    return { tone: 'prepare', mark: '↓', label: 'DETERIORATING' };
  }
  if (warning.hfDirection === 'STABLE') return { tone: 'neutral', mark: '→', label: 'STABLE' };
  return { tone: 'data', mark: '—', label: 'UNAVAILABLE' };
}

function aprStatus(warning: EarlyWarning): StatusPresentation {
  if (warning.apr === 'FALLING') return { tone: 'normal', mark: '↓', label: 'FALLING' };
  if (warning.apr === 'RISING QUICKLY') return { tone: 'act', mark: '↑', label: 'RISING QUICKLY' };
  if (warning.apr === 'RISING') return { tone: 'prepare', mark: '↑', label: 'RISING' };
  if (warning.apr === 'STABLE') return { tone: 'neutral', mark: '→', label: 'STABLE' };
  return { tone: 'data', mark: '—', label: 'UNAVAILABLE' };
}

function utilizationStatus(warning: EarlyWarning): StatusPresentation {
  if (warning.utilization === 'CALM') return { tone: 'normal', mark: '●', label: 'CALM' };
  if (warning.utilization === 'ELEVATED') return { tone: 'watch', mark: '◉', label: 'ELEVATED' };
  if (warning.utilization === 'HIGH') return { tone: 'act', mark: '◆', label: 'HIGH' };
  if (warning.utilization === 'CRITICAL') return { tone: 'urgent', mark: '■', label: 'CRITICAL' };
  return { tone: 'data', mark: '—', label: 'UNAVAILABLE' };
}

function liquidityStatus(warning: EarlyWarning): StatusPresentation {
  if (warning.liquidity === 'DEEP') return { tone: 'normal', mark: '●', label: 'DEEP' };
  if (warning.liquidity === 'ADEQUATE') return { tone: 'neutral', mark: '→', label: 'ADEQUATE' };
  if (warning.liquidity === 'LIMITED') return { tone: 'prepare', mark: '▲', label: 'LIMITED' };
  if (warning.liquidity === 'THIN') return { tone: 'act', mark: '◆', label: 'THIN' };
  return { tone: 'data', mark: '—', label: 'UNAVAILABLE' };
}

function bps(value: number | undefined) {
  if (value === undefined) return 'unavailable';
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded} bps`;
}

function hfDelta(value: number | undefined) {
  if (value === undefined) return 'unavailable';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

function agoText(current: number | undefined, previous: number | undefined, digits = 0) {
  if (current === undefined) return 'unavailable';
  const now = digits === 0 ? formatPercent(current, 0) : current.toFixed(digits);
  if (previous === undefined) return now;
  const then = digits === 0 ? formatPercent(previous, 0) : previous.toFixed(digits);
  return `${then} → ${now}`;
}

export default function EarlyWarningCard({
  warning,
  alertLabel,
  onOpenPlanner,
}: {
  warning: EarlyWarning;
  alertLabel: 'Alert enabled' | 'Alert not configured';
  onOpenPlanner: () => void;
}) {
  const day = warning.snapshot.position.hfChange24h;
  const six = warning.snapshot.position.hfChange6h;
  const hfMove = day !== undefined ? `${hfDelta(day)} over 24h` : six !== undefined ? `${hfDelta(six)} over 6h` : 'unavailable';
  const thinHistory = warning.snapshot.quality.historyCoverage === undefined || warning.snapshot.quality.historyCoverage < 0.5;
  const openPlanner = warning.attention === 'PREPARE' || warning.positionState === 'ACT' || warning.positionState === 'URGENT';
  return (
    <section className="mt-3 space-y-1 rounded border px-2 py-2">
      <p className="font-semibold">Early warning</p>
      {warning.summary.slice(0, 5).map((line) => <p key={line}>{line}</p>)}
      <div className="flex flex-wrap items-center gap-2">
        <span>Position</span>
        <StatusBadge status={riskSeverityStatus(warning.positionState ?? 'NORMAL')} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span>Trend</span>
        <StatusBadge status={trendStatus(warning)} />
        <span>{hfMove}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span>Attention</span>
        <StatusBadge status={attentionStatus(warning.attention)} />
      </div>
      {warning.attention !== 'NONE' && <p>Reason: {warning.reason}</p>}
      {thinHistory && <p>{TREND_UNAVAILABLE}</p>}
      <p>Next boundary: {warning.next ? `${warning.next.state} ${formatHealthFactor(warning.next.hf)}` : 'unavailable'}</p>
      <p>BTC distance: {warning.next?.priceDistance === undefined ? 'unavailable' : formatPercent(warning.next.priceDistance, 0)}</p>
      <p>{reachesBoundaryCopy(warning.next?.state ?? 'the next level', warning.next?.btc)}</p>
      <p>Current oracle BTC: {warning.snapshot.collateral.currentOraclePrice === undefined ? 'unavailable' : formatUsd(warning.snapshot.collateral.currentOraclePrice)}</p>
      {warning.next?.btc !== undefined && <p>{warning.next.state} BTC: {formatUsd(warning.next.btc)}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <span>APR trend</span>
        <StatusBadge status={aprStatus(warning)} />
        <span>{bps(warning.snapshot.rate.change24hBps ?? warning.snapshot.rate.change6hBps)}{warning.snapshot.rate.change24hBps !== undefined ? ' / 24h' : warning.snapshot.rate.change6hBps !== undefined ? ' / 6h' : ''}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span>Utilization</span>
        <StatusBadge status={utilizationStatus(warning)} />
        <span>{agoText(warning.snapshot.market.currentUtilization, warning.snapshot.market.utilization6hAgo ?? warning.snapshot.market.utilization24hAgo)}</span>
      </div>
      {warning.utilizationNote && <p>{warning.utilizationNote}</p>}
      {warning.driver && <p>Primary driver: {warning.driver}</p>}
      <p>Current guidance: {warning.guidance}</p>
      {warning.pace.shown && warning.pace.text && <p>{PACE_LABEL}: {warning.pace.text}. {PACE_DISCLAIMER}</p>}
      <p>
        {alertLabel}{alertLabel === 'Alert enabled' ? ' ✓' : ''}
        {alertLabel === 'Alert not configured' && <> · <Link href="/alerts" className="underline">Alerts</Link></>}
      </p>
      {openPlanner && <button type="button" className="rounded border px-2 py-1" onClick={onOpenPlanner}>Open Action Planner</button>}
    </section>
  );
}

export function RateTrendDetail({ warning }: { warning: EarlyWarning }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span>Rate acceleration</span>
        <StatusBadge status={aprStatus(warning)} />
      </div>
      <p>1h {bps(warning.snapshot.rate.change1hBps)} · 6h {bps(warning.snapshot.rate.change6hBps)} · 24h {bps(warning.snapshot.rate.change24hBps)}</p>
    </div>
  );
}

export function MarketIntelligence({ warning }: { warning: EarlyWarning }) {
  const fresh = (value: EarlyWarning['snapshot']['quality']['positionFreshness']) => value === 'fresh' ? 'fresh' : value === 'stale' ? 'stale' : 'unavailable';
  const wrapper = warning.wrapper?.deviation === undefined ? 'unavailable' : `${formatPercent(warning.wrapper.deviation, 1)} ${warning.wrapper.band ?? ''}`.trim();
  const reference = warning.reference?.deviation === undefined ? 'unavailable' : `${formatPercent(warning.reference.deviation, 1)} ${warning.reference.band ?? ''}`.trim();
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span>Utilization</span>
        <StatusBadge status={utilizationStatus(warning)} />
      </div>
      <p>{agoText(warning.snapshot.market.currentUtilization, warning.snapshot.market.utilization6hAgo ?? warning.snapshot.market.utilization24hAgo)}</p>
      {warning.utilizationNote && <p>{warning.utilizationNote}</p>}
      <p>1h change {warning.snapshot.market.utilization1hAgo === undefined || warning.snapshot.market.currentUtilization === undefined ? 'unavailable' : formatPercent(warning.snapshot.market.currentUtilization - warning.snapshot.market.utilization1hAgo, 0)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <span>Available liquidity</span>
        <StatusBadge status={liquidityStatus(warning)} />
      </div>
      <p>{warning.snapshot.market.availableLiquidity === undefined ? 'unavailable' : formatUsd(warning.snapshot.market.availableLiquidity)}</p>
      <p>24h change {warning.snapshot.market.liquidityChange24hPct === undefined ? 'unavailable' : formatPercent(warning.snapshot.market.liquidityChange24hPct, 0)}</p>
      {warning.liquidityNote && <p>{warning.liquidityNote}</p>}
      <p>Reference-price divergence {reference}</p>
      <p>cbBTC/BTC ratio {warning.wrapper?.ratio === undefined ? 'unavailable' : warning.wrapper.ratio.toFixed(4)} · deviation {wrapper}</p>
      <p>Data: position {fresh(warning.snapshot.quality.positionFreshness)} · oracle {fresh(warning.snapshot.quality.oracleFreshness)} · rate {fresh(warning.snapshot.quality.rateFreshness)} · market {fresh(warning.snapshot.quality.marketFreshness)}</p>
      <p>24h position history {warning.snapshot.quality.historyCoverage === undefined ? 'unavailable' : formatPercent(warning.snapshot.quality.historyCoverage, 0)}</p>
      <p>24h market history {warning.snapshot.quality.marketHistoryCoverage === undefined ? 'unavailable' : formatPercent(warning.snapshot.quality.marketHistoryCoverage, 0)}</p>
    </div>
  );
}
