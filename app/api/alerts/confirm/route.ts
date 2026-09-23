import { getAddress, isAddress } from 'viem';
import { appUrl, loadSubscriber, saveSubscriber, verifyAlertToken } from '@/lib/alerts';

export const dynamic = 'force-dynamic';

function page(title: string, body: string, redirect?: string) {
  const extra = redirect ? `<p><a href="${redirect}">Back to Loans</a></p><script>setTimeout(function(){location.replace(${JSON.stringify(redirect)})},800)</script>` : '';
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;line-height:1.5"><p>${body}</p>${extra}</body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const address = params.get('address') ?? '';
  const email = params.get('email') ?? '';
  const token = params.get('token') ?? '';
  const loans = `${appUrl()}/loans`;
  if (!isAddress(address) || !email || !verifyAlertToken(`${address.toLowerCase()}:${email}:confirm`, token)) {
    return page('Invalid confirmation', 'This confirmation link is invalid.', loans);
  }
  const subscriber = await loadSubscriber(address);
  if (!subscriber || subscriber.email !== email) return page('No pending alerts', 'No pending subscription for this wallet.', loans);
  await saveSubscriber({ ...subscriber, address: getAddress(address), confirmed: true });
  return page('Email confirmed', 'Email confirmed. Loan alerts are on. Taking you back to Loans…', loans);
}
