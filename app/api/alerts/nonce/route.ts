import { isAddress } from 'viem';
import { nonceFor } from '@/lib/alerts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get('address') ?? '';
  if (!isAddress(address)) return Response.json({ error: 'Invalid address.' }, { status: 400 });
  const nonce = await nonceFor(address);
  return Response.json({ nonce, expires: Date.now() + 10 * 60_000 });
}
