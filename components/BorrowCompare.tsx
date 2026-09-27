'use client';

import { useMemo, useState, type MouseEvent } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { formatApr, formatUsd } from '@/lib/amount';
import { rateAlertLevel, stressRows, type FinancingBenchmark } from '@/lib/finance/benchmark';
import { formatPercentPoints, PAYOFF_RATE_NOTE, RATE_UNCHANGED_NOTE, yearOneInterestLabel } from '@/lib/finance/display';
import { formatCushion, formatHealthFactor, formatLtv, healthFactorLabel } from '@/lib/finance/format';
import {
  DEFAULT_STRESS_RATES,
  type BorrowScenario,
  type PlannerSnapshot,
  writeAlertConfig,
  writeBenchmark,
  writeScenario,
  writeStressRates,
} from '@/lib/finance/persist';
import { scenarioForVenue } from '@/lib/finance/scenario';
import type { Venue } from '@/lib/protocol';

function asNumber(value: string): number | undefined {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) ? parsed : undefined;
}

function percentInput(value: string): number | undefined {
  const parsed = asNumber(value);
  if (parsed === undefined) return undefined;
  return parsed > 1 ? parsed / 100 : parsed;
}

function trimRatePercent(rate: number): string {
  return String(Number((rate * 100).toFixed(4)));
}

export default function BorrowCompare({
  venue,
  btcPrice,
  stored,
}: {
  venue: Venue | null;
  btcPrice: number;
  stored: PlannerSnapshot;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed'>('idle');
  const [saveNote, setSaveNote] = useState('');
  const [editingScenario, setEditingScenario] = useState(false);
  const [editingBenchmark, setEditingBenchmark] = useState(false);
  const name = draft.name ?? stored.benchmark?.name ?? '';
  const provider = draft.provider ?? stored.benchmark?.provider ?? '';
  const annualRate = draft.annualRate ?? (stored.benchmark ? trimRatePercent(stored.benchmark.annualRate) : '');
  const rateType = (draft.rateType === 'variable' || draft.rateType === 'fixed'
    ? draft.rateType
    : stored.benchmark?.rateType) ?? 'fixed';
  const balance = draft.balance ?? stored.benchmark?.balance?.toString() ?? '';
  const borrowAmount = draft.borrowAmount ?? stored.scenario?.borrowAmount.toString() ?? '';
  const collateralAmount = draft.collateralAmount ?? stored.scenario?.collateralAmount?.toString() ?? '';
  const monthlyPayment = draft.monthlyPayment ?? stored.scenario?.monthlyPayment?.toString() ?? '';
  const warningBps = draft.warningBps ?? String(stored.alerts.warningBufferBps);
  const criticalBps = draft.criticalBps ?? String(stored.alerts.criticalBufferBps);
  const stressText = draft.stressText ?? stored.stress.map((rate) => (rate * 100).toFixed(rate * 100 % 1 === 0 ? 0 : 2)).join(', ');
  const benchmark = useMemo<FinancingBenchmark | null>(() => {
    const rate = percentInput(annualRate);
    if (!name.trim() || rate === undefined || rate < 0 || rate >= 1) return null;
    return {
      id: 'benchmark',
      name: name.trim(),
      provider: provider.trim() || undefined,
      annualRate: rate,
      rateType,
      balance: asNumber(balance),
    };
  }, [name, provider, annualRate, rateType, balance]);

  const scenario = useMemo<BorrowScenario | null>(() => {
    const amount = asNumber(borrowAmount);
    if (amount === undefined || amount <= 0) return null;
    return {
      borrowAmount: amount,
      collateralAmount: asNumber(collateralAmount),
      collateralAsset: venue?.assetSymbol ?? 'BTC',
      loanAsset: venue?.loanSymbol ?? 'USDC',
      monthlyPayment: asNumber(monthlyPayment),
    };
  }, [borrowAmount, collateralAmount, monthlyPayment, venue]);

  const alerts = useMemo(() => ({
    warningBufferBps: Math.max(0, asNumber(warningBps) ?? 100),
    criticalBufferBps: Math.max(0, asNumber(criticalBps) ?? 0),
  }), [warningBps, criticalBps]);

  const stressRates = useMemo(() => {
    const parsed = stressText.split(',').map((part) => percentInput(part)).filter((value): value is number => value !== undefined);
    return parsed.length > 0 ? parsed : DEFAULT_STRESS_RATES;
  }, [stressText]);

  const setField = (key: string) => (value: string) => {
    setSaveState('idle');
    setDraft((current) => ({ ...current, [key]: value }));
  };

  function persist(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const wrote = [
      writeBenchmark(benchmark),
      writeScenario(scenario),
      writeAlertConfig(alerts),
      writeStressRates(stressRates),
    ];
    if (wrote.some((ok) => !ok)) {
      setSaveState('failed');
      setSaveNote('This browser blocked saving. Check private mode or storage permissions.');
      toast.error('Could not save on this device');
      return;
    }
    const parts: string[] = [];
    if (benchmark) parts.push(`${benchmark.name} at ${(benchmark.annualRate * 100).toFixed(2)}% APR`);
    else if (name.trim() || annualRate.trim()) parts.push('benchmark skipped — enter both a name and an APR below 100%');
    if (scenario) parts.push(`borrow ${scenario.borrowAmount} ${scenario.loanAsset}`);
    else if (borrowAmount.trim()) parts.push('borrow amount skipped — enter a number greater than 0');
    parts.push('alert buffers and stress rates');
    const note = `Saved on this device: ${parts.join('; ')}.`;
    setSaveState('saved');
    setSaveNote(note);
    setEditingScenario(false);
    setEditingBenchmark(false);
    toast.success('Saved on this device', { description: note });
  }

  const view = venue && scenario ? scenarioForVenue(venue, scenario, venue.priceUsd || btcPrice, benchmark) : null;
  const alert = venue && benchmark ? rateAlertLevel(venue.borrowApr, benchmark.annualRate, alerts) : null;
  const stressBalance = scenario?.borrowAmount ?? 0;
  const rows = stressBalance > 0 ? stressRows(stressBalance, stressRates, benchmark?.annualRate, scenario?.monthlyPayment) : [];

  return (
    <div className="space-y-3">
      <section id="borrow-scenario" className="rounded-xl border bg-card p-3">
        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Planning scenario</p>
        {!editingScenario && stored.scenario ? (
          <div className="mt-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {formatUsd(stored.scenario.borrowAmount)} {stored.scenario.loanAsset}
                {stored.scenario.collateralAmount ? ` · ${stored.scenario.collateralAmount} BTC collateral` : ''}
                {stored.scenario.monthlyPayment ? ` · ${formatUsd(stored.scenario.monthlyPayment)}/month` : ''}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">Planning values do not represent current wallet debt.</p>
            </div>
            <Button type="button" variant="outline" className="h-11 shrink-0" onClick={() => setEditingScenario(true)}>Edit</Button>
          </div>
        ) : (
          <>
            <p className="mt-1 text-[11px] text-muted-foreground">Optional. Saved only on this device. Planning values do not represent current wallet debt.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Intended borrow (USDC)" value={borrowAmount} onChange={setField('borrowAmount')} placeholder="10000" inputMode="decimal" />
              <Field label="BTC collateral amount" value={collateralAmount} onChange={setField('collateralAmount')} placeholder="0.25" inputMode="decimal" />
              <Field label="Planned monthly payment" value={monthlyPayment} onChange={setField('monthlyPayment')} placeholder="Optional" inputMode="decimal" />
            </div>
          </>
        )}
      </section>

      <section id="financing-benchmark" className="rounded-xl border bg-card p-3">
        <p className="text-[10px] font-semibold uppercase text-muted-foreground">Benchmark financing</p>
        {!editingBenchmark && stored.benchmark ? (
          <div className="mt-2 flex items-start justify-between gap-3">
            <p className="min-w-0 text-sm font-semibold">
              {[
                stored.benchmark.name,
                stored.benchmark.provider,
                `${formatApr(stored.benchmark.annualRate)} ${stored.benchmark.rateType}`,
                stored.benchmark.balance ? `${formatUsd(stored.benchmark.balance)} payoff` : null,
              ].filter(Boolean).join(' · ')}
            </p>
            <Button type="button" variant="outline" className="h-11 shrink-0" onClick={() => setEditingBenchmark(true)}>Edit</Button>
          </div>
        ) : (
          <>
            <p className="mt-1 text-[11px] text-muted-foreground">Compare crypto markets against another financing option. Leave blank to browse markets only.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Benchmark name" value={name} onChange={setField('name')} placeholder="Personal loan, HELOC, credit card" />
              <Field label="Provider (optional)" value={provider} onChange={setField('provider')} placeholder="Optional" />
              <Field label="Benchmark APR %" value={annualRate} onChange={setField('annualRate')} placeholder="7.5" inputMode="decimal" />
              <label className="space-y-1 text-xs">
                <Label className="text-[11px] text-muted-foreground">Rate type</Label>
                <select
                  className="border-input h-11 w-full rounded-md border bg-transparent px-3 text-sm"
                  value={rateType}
                  onChange={(event) => setField('rateType')(event.target.value === 'variable' ? 'variable' : 'fixed')}
                >
                  <option value="fixed">Fixed</option>
                  <option value="variable">Variable</option>
                </select>
              </label>
              <Field label="Current payoff balance (optional)" value={balance} onChange={setField('balance')} placeholder="20000" inputMode="decimal" />
            </div>
          </>
        )}
      </section>

      {(editingScenario || editingBenchmark) && (
        <div className="relative z-20 flex flex-col items-start gap-1.5">
          <Button
            type="button"
            className={`h-11 pointer-events-auto active:scale-[0.98] ${saveState === 'saved' ? 'bg-emerald-600 text-white hover:bg-emerald-700' : saveState === 'failed' ? 'bg-red-600 text-white hover:bg-red-700' : ''}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={persist}
          >
            {saveState === 'saved' ? 'Saved' : saveState === 'failed' ? 'Save failed' : 'Save on this device'}
          </Button>
          {saveNote && (
            <p className={`text-[11px] leading-relaxed ${saveState === 'failed' ? 'text-red-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {saveNote}
            </p>
          )}
        </div>
      )}

      <details className="rounded-xl border bg-card px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold">Alerts, stress test, and extra scenario math</summary>
        {!editingScenario && !editingBenchmark && (
          <div className="relative z-20 mt-3">
            <Button type="button" className="h-11" onPointerDown={(event) => event.stopPropagation()} onClick={persist}>
              Save alerts on this device
            </Button>
          </div>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Yellow alert buffer (bps)" value={warningBps} onChange={setField('warningBps')} placeholder="100" inputMode="numeric" />
          <Field label="Red alert buffer (bps)" value={criticalBps} onChange={setField('criticalBps')} placeholder="0" inputMode="numeric" />
          <label className="space-y-1 text-xs sm:col-span-2">
            <Label className="text-[11px] text-muted-foreground">Stress rates (%)</Label>
            <Input value={stressText} onChange={(event) => setField('stressText')(event.target.value)} placeholder="6, 8, 10, 12, 15" />
          </label>
        </div>
        {venue && (
          <div className="mt-4 space-y-3 text-xs">
            {benchmark && (
              <div className="rounded-lg border p-3">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">Benchmark comparison</p>
                <p className="mt-1">Benchmark financing {formatApr(benchmark.annualRate)} {benchmark.rateType} APR</p>
                <p>Selected market {formatApr(venue.borrowApr)} variable APR</p>
                {view?.spread !== null && view?.spread !== undefined && (
                  <p>Current spread {formatPercentPoints(view.spread)}</p>
                )}
                {view?.annualDifference !== null && view?.annualDifference !== undefined && (
                  <p>Estimated interest difference at current rates {formatUsd(view.annualDifference)}</p>
                )}
                {view && (
                  <p className="text-muted-foreground">
                    Interest comparison based on planned borrow amount: {formatUsd(view.comparisonPrincipal)}
                  </p>
                )}
                {view?.benchmarkPayoffBalance !== null && view?.benchmarkPayoffBalance !== undefined
                  && Math.abs(view.benchmarkPayoffBalance - view.comparisonPrincipal) > 0.005 && (
                  <p className="text-muted-foreground">
                    Saved payoff balance {formatUsd(view.benchmarkPayoffBalance)} is not used for this comparison.
                  </p>
                )}
                {alert && <p className={alert === 'green' ? 'text-emerald-600' : alert === 'yellow' ? 'text-orange-500' : 'text-red-500'}>Rate alert: {alert}</p>}
              </div>
            )}
            {view && (
              <div className="rounded-lg border p-3">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">My scenario</p>
                {view.startingLtv !== null && <p>Your LTV {formatLtv(view.startingLtv)}</p>}
                {view.healthFactor !== null && <p>{healthFactorLabel(view.healthFactorKind)} {formatHealthFactor(view.healthFactor)}</p>}
                {view.liquidationPrice !== null && <p>Approximate liquidation level {formatUsd(view.liquidationPrice)}</p>}
                {view.distanceToLiquidation !== null && <p>BTC cushion {formatCushion(view.distanceToLiquidation)}</p>}
                <p>{yearOneInterestLabel(view.interestDeclining)} {formatUsd(view.yearOneInterest)}</p>
                <p className="text-muted-foreground">{RATE_UNCHANGED_NOTE}</p>
                <p>Estimated first-month interest {formatUsd(view.monthOneInterest)}</p>
                {view.healthFactorPrices.length > 0 && (
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    {view.healthFactorPrices.map((row) => (
                      <p key={row.healthFactor}>BTC price at HF {formatHealthFactor(row.healthFactor)}: {row.price ? formatUsd(row.price) : '—'}</p>
                    ))}
                  </div>
                )}
                {view.amortization && (
                  <div className="mt-2">
                    <p className="font-medium">{PAYOFF_RATE_NOTE}</p>
                    {view.amortization.coversInterest ? (
                      <>
                        <p>Estimated months to payoff {view.amortization.months}</p>
                        <p>Estimated total interest {view.amortization.totalInterest !== null ? formatUsd(view.amortization.totalInterest) : '—'}</p>
                        <p>First payment interest {formatUsd(view.amortization.firstInterest)} · principal {formatUsd(view.amortization.firstPrincipal)}</p>
                      </>
                    ) : (
                      <p className="text-orange-500">Payment does not currently cover estimated interest.</p>
                    )}
                  </div>
                )}
              </div>
            )}
            {rows.length > 0 && (
              <div className="rounded-lg border p-3">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">Rate stress test</p>
                <p className="mt-1 text-muted-foreground">If the variable borrow APR moved to these levels. {RATE_UNCHANGED_NOTE}</p>
                <div className="mt-2 grid gap-1">
                  {rows.map((row) => (
                    <p key={row.rate}>
                      {formatApr(row.rate)} APR{row.breakEven ? ' · break-even' : ''}
                      {' · first month '}{formatUsd(row.monthOneInterest)}
                      {' · next 12 months '}{formatUsd(row.yearOneInterest)}
                      {row.months !== null ? ` · payoff ${row.months} mo` : ''}
                      {row.totalInterest !== null ? ` · total ${formatUsd(row.totalInterest)}` : ''}
                      {row.spread !== null ? ` · spread ${formatPercentPoints(row.spread)}` : ''}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </details>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: 'decimal' | 'numeric';
}) {
  return (
    <label className="space-y-1 text-xs">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input className="h-11" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} inputMode={inputMode} />
    </label>
  );
}
