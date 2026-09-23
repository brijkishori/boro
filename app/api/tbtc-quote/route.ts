import { publicClient } from '@/lib/rpc';
import { TBTC_ROUTES, quoteTbtcSwap } from '@/lib/uniswap';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const routeId = url.searchParams.get('route') ?? '';
  const amountText = url.searchParams.get('amount') ?? '';
  const route = TBTC_ROUTES.find((item) => item.id === routeId);
  if (!route || !/^\d+$/.test(amountText)) {
    return Response.json({ error: 'Need a known route and a token amount.' }, { status: 400 });
  }
  const amount = BigInt(amountText);
  if (amount <= 0n) return Response.json({ quote: null });
  try {
    const quote = await quoteTbtcSwap(publicClient(route.chainId), route, amount);
    if (!quote) return Response.json({ quote: null });
    return Response.json({
      quote: {
        out: quote.out.toString(),
        fee: quote.fee ?? null,
        path: quote.path ?? null,
      },
    });
  } catch {
    return Response.json({ error: 'Quote unavailable. Try again in a moment.' }, { status: 503 });
  }
}
