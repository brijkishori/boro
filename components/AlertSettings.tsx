'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAccount } from 'wagmi';
import { toast } from 'sonner';
import { TEST_ALERT_OPTIONS, type AlertKind } from '@/lib/alertKinds';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type Status = { configured: boolean; subscriber: { email: string; confirmed: boolean; rules: { weekly: boolean; monthly: boolean; thresholdUsd: number; timeZone: string } } | null };

export default function AlertSettings() {
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
      const body = (await response.json().catch(() => ({}))) as { error?: string; sent?: number };
      if (!response.ok) throw new Error(body.error ?? 'Could not send test email.');
      toast.success(kind === 'all' ? `Sent ${body.sent ?? 9} test emails.` : 'Test email sent. Check the inbox.');
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
            <p className="text-xs font-semibold text-muted-foreground">Send a sample</p>
            <div className="grid grid-cols-2 gap-2">
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
            <Button type="button" variant="ghost" className="h-9 w-full text-xs" disabled={testing !== null} onClick={() => void sendTest('all')}>
              {testing === 'all' ? 'Sending all…' : 'Send all samples'}
            </Button>
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
      </CardContent>
    </Card>
  );
}
