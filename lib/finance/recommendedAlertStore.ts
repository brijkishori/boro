import type { StoredRecommendedPlan } from '@/lib/finance/recommendedAlerts';

const KEY = 'simplebtc_recommended_alerts';
const EMPTY: StoredRecommendedPlan[] = [];
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: StoredRecommendedPlan[] = EMPTY;

function emit() {
  for (const listener of listeners) listener();
}

function parse(raw: string | null): StoredRecommendedPlan[] {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as StoredRecommendedPlan[];
    if (!Array.isArray(parsed)) return EMPTY;
    const plans = parsed.filter((plan) => typeof plan?.marketKey === 'string');
    return plans.length > 0 ? plans : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function subscribeRecommendedPlans(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    cachedRaw = undefined;
    listener();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

export function readRecommendedPlans(): StoredRecommendedPlan[] {
  if (typeof window === 'undefined') return EMPTY;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  cached = parse(raw);
  return cached;
}

export function readRecommendedPlan(marketKey: string): StoredRecommendedPlan | null {
  return readRecommendedPlans().find((plan) => plan.marketKey === marketKey) ?? null;
}

export function writeRecommendedPlan(plan: StoredRecommendedPlan): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const next = readRecommendedPlans().filter((row) => row.marketKey !== plan.marketKey);
    next.push(plan);
    const text = JSON.stringify(next);
    window.localStorage.setItem(KEY, text);
    cachedRaw = text;
    cached = next;
    emit();
    return true;
  } catch {
    return false;
  }
}

export function removeUnapprovedPlan(marketKey: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const next = readRecommendedPlans().filter((plan) => plan.marketKey !== marketKey || plan.approved);
    const text = JSON.stringify(next);
    window.localStorage.setItem(KEY, text);
    cachedRaw = text;
    cached = next.length > 0 ? next : EMPTY;
    emit();
    return true;
  } catch {
    return false;
  }
}
