import { getAddress, isAddress } from 'viem';
import { loadSubscriber, saveSubscriber } from '@/lib/alerts';
import type { StoredRecommendedPlan } from '@/lib/finance/recommendedAlerts';

export const dynamic = 'force-dynamic';

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Request must come from this app.' }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { address?: unknown; plan?: StoredRecommendedPlan };
  if (typeof body.address !== 'string' || !isAddress(body.address) || !body.plan || typeof body.plan.marketKey !== 'string') {
    return Response.json({ error: 'Invalid alert plan.' }, { status: 400 });
  }
  const address = getAddress(body.address);
  const subscriber = await loadSubscriber(address);
  if (!subscriber?.confirmed) return Response.json({ error: 'Confirm email alerts before enabling delivery.' }, { status: 403 });
  const plans = (subscriber.positionPlans ?? []).filter((plan) => plan.marketKey !== body.plan?.marketKey);
  plans.push(body.plan);
  const monthly = plans.some((plan) => plan.approved && plan.rules.some((rule) => rule.id === 'monthly-statement' && rule.enabled));
  subscriber.positionPlans = plans;
  if (monthly) subscriber.rules.monthly = true;
  await saveSubscriber(subscriber);
  return Response.json({ ok: true });
}
