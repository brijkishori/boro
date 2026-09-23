import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAddress, isAddress } from 'viem';
import { storeGet, storeSadd, storeSet, storeSetJson, storeSmembers, storeJson, type Json } from '@/lib/store';

export type AlertRules = {
  healthWarn: number;
  healthUrgent: number;
  liqDistancePct: number;
  aprAbove: number;
  refinanceUsd: number;
  weekly: boolean;
  monthly: boolean;
  thresholdUsd: number;
  timeZone: string;
};

export type AlertSubscriber = {
  address: string;
  email: string;
  confirmed: boolean;
  rules: AlertRules;
  lastWeekly?: string;
  lastMonthly?: string;
  lastThresholdUsd?: number;
};

export const DEFAULT_RULES: AlertRules = {
  healthWarn: 1.5,
  healthUrgent: 1.2,
  liqDistancePct: 15,
  aprAbove: 0.12,
  refinanceUsd: 25,
  weekly: true,
  monthly: true,
  thresholdUsd: 0,
  timeZone: 'America/New_York',
};

function secret() {
  return process.env.ALERT_SIGNING_SECRET?.trim() || process.env.GMAIL_APP_PASSWORD?.trim() || 'dev-alert-secret';
}

export function alertToken(payload: string) {
  return createHmac('sha256', secret()).update(payload).digest('hex');
}

export function verifyAlertToken(payload: string, token: string) {
  const expected = Buffer.from(alertToken(payload));
  const got = Buffer.from(token);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function subscriberKey(address: string) {
  return `alert:sub:${address.toLowerCase()}`;
}

export async function nonceFor(address: string) {
  const nonce = randomBytes(16).toString('hex');
  await storeSet(`alert:nonce:${address.toLowerCase()}`, nonce, 600);
  return nonce;
}

export async function consumeNonce(address: string, nonce: string) {
  const key = `alert:nonce:${address.toLowerCase()}`;
  const stored = await storeGet(key);
  if (!stored || stored !== nonce) return false;
  await storeSet(key, '', 1);
  return true;
}

export { alertTypedData, personalAlertMessage } from '@/lib/alertMessage';

export async function saveSubscriber(subscriber: AlertSubscriber) {
  if (!isAddress(subscriber.address)) throw new Error('bad address');
  subscriber.address = getAddress(subscriber.address);
  await storeSetJson(subscriberKey(subscriber.address), JSON.parse(JSON.stringify(subscriber)) as Json);
  await storeSadd('alert:subs', subscriber.address.toLowerCase());
}

export async function loadSubscriber(address: string): Promise<AlertSubscriber | null> {
  return storeJson<AlertSubscriber>(subscriberKey(address));
}

export async function allSubscribers(): Promise<AlertSubscriber[]> {
  const members = await storeSmembers('alert:subs');
  const rows = await Promise.all(members.map((member) => loadSubscriber(member)));
  return rows.filter((row): row is AlertSubscriber => Boolean(row?.confirmed));
}

export function cooldownKey(address: string, rule: string, venueId: string) {
  return `alert:cd:${address.toLowerCase()}:${rule}:${venueId}`;
}

export async function shouldSend(address: string, rule: string, venueId: string, hours: number, record = true) {
  const key = cooldownKey(address, rule, venueId);
  const last = await storeGet(key);
  if (last && Date.now() - Number(last) < hours * 3_600_000) return false;
  if (record) await storeSet(key, String(Date.now()), hours * 3600);
  return true;
}

export function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://boro-ruddy.vercel.app';
}

export function unsubscribeUrl(address: string) {
  return `${appUrl()}/api/alerts/unsubscribe?address=${address}&token=${alertToken(`${address.toLowerCase()}:unsub`)}`;
}
