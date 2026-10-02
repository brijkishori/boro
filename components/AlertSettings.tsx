'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { toast } from 'sonner';
import { TEST_ALERT_OPTIONS, type AlertKind } from '@/lib/alertKinds';
import { markLoanAlertChecked, readLoanAlertRule, writeLoanAlertRule, type LoanAlertRule } from '@/lib/finance/loanAlerts';
import RecommendedAlerts from '@/components/RecommendedAlerts';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { protocolLabel, chainLabel } from '@/lib/protocol';
import type { OpenPosition } from '@/components/useAllPositions';
import type { StoredRecommendedPlan } from '@/lib/finance/recommendedAlerts';

type Status = { configured: boolean; subscriber: { email: string; confirmed: boolean; rules: { weekly: boolean; monthly: boolean; thresholdUsd: number; timeZone: string }; positionPlans?: StoredRecommendedPlan[] } | null };

export default function AlertSettings({ loans = [] }: { loans?: OpenPosition[] }) {
  const { address, isConnected } = useAccount();
  const [status, setStatus] = useState<Status | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<AlertKind | 'all' | null>(null);
  const [editing, setEditing] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!address) return;
    const response = await fetch(`/api/alerts/subscribe?address=${address}`, { cache: 'no-store' });
    const body = (await response.json()) as Status;
    setStatus(body);
    if (body.subscriber?.email) setEmail(body.subscriber.email);
    if (body.subscriber?.confirmed) setEditing(false);
  }, [address]);

  useEffect(() => {
    void refreshStatus().catch(() => setStatus({ configured: false, subscriber: null }));
  }, [refreshStatus]);

  useEffect(() => {
    if (!address || status?.subscriber?.confirmed || !status?.subscriber) return;
    const poll = window.setInterval(() => {
      void refreshStatus().catch(() => undefined);
    }, 3_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshStatus().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [address, refreshStatus, status?.subscriber, status?.subscriber?.confirmed]);

  async function subscribe() {
    if (!address) return;
    setBusy(true);
    try {
      const nonceRes = await fetch(`/api/alerts/nonce?address=${address}`);
      const nonceBody = (await nonceRes.json()) as { nonce?: string; error?: string };
      if (!nonceRes.ok || !nonceBody.nonce) {
        toast.error(nonceBody.error ?? 'Could not start alert signup.');
        return;
      }
      const cleanEmail = email.trim().toLowerCase();
      const response = await fetch('/api/alerts/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          email: cleanEmail,
          nonce: nonceBody.nonce,
          rules: { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        toast.error(body.error ?? 'Could not subscribe.');
        return;
      }
      setEditing(false);
      setStatus((current) => ({
        configured: current?.configured ?? true,
        subscriber: {
          email: cleanEmail,
          confirmed: false,
          rules: { weekly: true, monthly: true, thresholdUsd: 0, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        },
      }));
      toast.success('Check your email and open the confirmation link.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not subscribe.');
    } finally {
      setBusy(false);
    }
  }

  async function sendTest(kind: AlertKind | 'all') {
    if (!address) return;
    setTesting(kind);
    try {
      const response = await fetch('/api/alerts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, kind: kind === 'all' ? undefined : kind }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; sent?: number | boolean; reason?: string };
      if (!response.ok) throw new Error(body.error ?? 'Could not send test email.');
      if (body.sent === false) {
        toast.info(body.reason === 'NO_QUALIFIED_REFINANCE_OPPORTUNITY'
          ? 'No qualified refinance opportunity found for your position at live rates.'
          : `No test email sent: ${body.reason ?? 'not qualified'}`);
      } else {
        toast.success(kind === 'all' ? `Sent ${body.sent ?? 8} test emails.` : 'Test email sent. Check the inbox.');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send test email.');
    } finally {
      setTesting(null);
    }
  }

  if (!isConnected) return null;

  const confirmed = Boolean(status?.subscriber?.confirmed);
  const pending = Boolean(status?.subscriber && !status.subscriber.confirmed);

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <p className="text-sm font-semibold">Email alerts</p>
        {confirmed && !editing ? (
          <>
            <p className="text-sm text-emerald-600">On · {status?.subscriber?.email}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Liquidation-risk messages, a weekly digest (skipped under $1), and a monthly statement will go to this address for the connected wallet.
            </p>
            <details className="rounded-lg border px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold">Sample email tests</summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {TEST_ALERT_OPTIONS.map((option) => (
                  <Button
                    key={option.kind}
                    type="button"
                    variant="outline"
                    className="h-9 text-xs"
                    disabled={testing !== null}
                    onClick={() => void sendTest(option.kind)}
                  >
                    {testing === option.kind ? 'Sending…' : option.label}
                  </Button>
                ))}
              </div>
              <Button type="button" variant="ghost" className="mt-2 h-9 w-full text-xs" disabled={testing !== null} onClick={() => void sendTest('all')}>
                {testing === 'all' ? 'Sending all…' : 'Send all samples'}
              </Button>
            </details>
            <Button type="button" variant="outline" className="h-10 w-full" onClick={() => setEditing(true)}>
              Change email
            </Button>
          </>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Alerts go to this email for the connected wallet. Open the confirmation link we send. This page updates on its own after you confirm.
            </p>
            {!status?.configured && <p className="text-xs text-orange-500">Gmail SMTP is not configured on this server yet. Add GMAIL_USER and GMAIL_APP_PASSWORD.</p>}
            {pending && <p className="text-xs text-orange-500">Waiting for {status?.subscriber?.email} to confirm. Check that inbox, including spam.</p>}
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@email.com"
              className="h-11 w-full rounded-md border bg-background px-3 text-base sm:text-sm"
            />
            <Button type="button" className="h-10 w-full bg-blue-600 text-white hover:bg-blue-700" disabled={busy || !email || !status?.configured} onClick={() => void subscribe()}>
              {busy ? 'Sending confirmation…' : pending ? 'Resend confirmation' : confirmed ? 'Update email' : 'Enable email alerts'}
            </Button>
            {editing && (
              <Button type="button" variant="ghost" className="h-9 w-full" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </>
        )}
        {loans.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-semibold">Per-loan thresholds</p>
            {loans.map((loan) => (
              <div key={loan.venue.id} className="space-y-2">
                <LoanAlertEditor loan={loan} />
                <RecommendedAlerts loan={loan} emailConfirmed={confirmed} serverPlans={status?.subscriber?.positionPlans} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LoanAlertEditor({ loan }: { loan: OpenPosition }) {
  const [rule, setRule] = useState<LoanAlertRule>(() => readLoanAlertRule(loan.venue.id));

  function save(next: LoanAlertRule) {
    writeLoanAlertRule(next);
    setRule(next);
  }

  return (
    <div className="space-y-2 rounded-lg border px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">{protocolLabel(loan.venue.protocol)} · {chainLabel(loan.venue.chainId)} · {loan.venue.assetSymbol}</p>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={rule.enabled} onChange={(event) => save({ ...rule, enabled: event.target.checked })} />
          {rule.enabled ? 'Enabled' : 'Disabled'}
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label>Borrow APR %
          <input className="mt-1 h-8 w-full rounded border bg-background px-2" inputMode="decimal" value={rule.borrowAprThreshold !== undefined ? String(rule.borrowAprThreshold * 100) : ''} onChange={(event) => save({ ...rule, borrowAprThreshold: event.target.value ? Number(event.target.value) / 100 : undefined })} />
        </label>
        <label>Health factor
          <input className="mt-1 h-8 w-full rounded border bg-background px-2" inputMode="decimal" value={rule.healthFactorThreshold ?? ''} onChange={(event) => save({ ...rule, healthFactorThreshold: event.target.value ? Number(event.target.value) : undefined })} />
        </label>
        <label>LTV %
          <input className="mt-1 h-8 w-full rounded border bg-background px-2" inputMode="decimal" value={rule.ltvThreshold !== undefined ? String(rule.ltvThreshold * 100) : ''} onChange={(event) => save({ ...rule, ltvThreshold: event.target.value ? Number(event.target.value) / 100 : undefined })} />
        </label>
        <label>BTC cushion %
          <input className="mt-1 h-8 w-full rounded border bg-background px-2" inputMode="decimal" value={rule.liquidationDistanceThreshold !== undefined ? String(rule.liquidationDistanceThreshold * 100) : ''} onChange={(event) => save({ ...rule, liquidationDistanceThreshold: event.target.value ? Number(event.target.value) / 100 : undefined })} />
        </label>
        <label>BTC liquidation price
          <input className="mt-1 h-8 w-full rounded border bg-background px-2" inputMode="decimal" value={rule.liquidationPriceThreshold ?? ''} onChange={(event) => save({ ...rule, liquidationPriceThreshold: event.target.value ? Number(event.target.value) : undefined })} />
        </label>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-1"><input type="checkbox" checked={rule.utilizationSpike} onChange={(event) => save({ ...rule, utilizationSpike: event.target.checked })} />Utilization spike</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={rule.significantRateChange} onChange={(event) => save({ ...rule, significantRateChange: event.target.checked })} />Significant rate change</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={rule.monthlyStatement} onChange={(event) => save({ ...rule, monthlyStatement: event.target.checked })} />Monthly statement</label>
      </div>
      <p className="text-muted-foreground">
        {rule.enabled ? 'Enabled' : 'Disabled'}
        {rule.lastChecked ? ` · last checked ${new Date(rule.lastChecked).toLocaleString()}` : ' · not checked yet'}
        {rule.lastNotified ? ` · last notification ${new Date(rule.lastNotified).toLocaleString()}` : ' · no notification yet'}
      </p>
      <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => setRule(markLoanAlertChecked(loan.venue.id))}>
        Mark checked now
      </Button>
    </div>
  );
}
