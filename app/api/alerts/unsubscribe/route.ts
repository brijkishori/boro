import { isAddress } from 'viem';
import { loadSubscriber, saveSubscriber, verifyAlertToken } from '@/lib/alerts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const address = params.get('address') ?? '';
  const token = params.get('token') ?? '';
  if (!isAddress(address) || !verifyAlertToken(`${address.toLowerCase()}:unsub`, token)) {
    return new Response('This unsubscribe link is invalid.', { status: 400 });
  }
  const subscriber = await loadSubscriber(address);
  if (subscriber) await saveSubscriber({ ...subscriber, confirmed: false });
  return new Response('You are unsubscribed from SimpleBTC loan alerts.', { status: 200 });
}
