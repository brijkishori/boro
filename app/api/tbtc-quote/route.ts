import { isAddress } from 'viem';
import { publicClient } from '@/lib/rpc';
import { parseDestChain, quoteRelayTbtc } from '@/lib/relay';
import { TBTC_ROUTES, quoteTbtcSwap, tbtcToken } from '@/lib/uniswap';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const routeId = url.searchParams.get('route') ?? '';
  const amountText = url.searchParams.get('amount') ?? '';
  const user = url.searchParams.get('user') ?? '';
  const route = TBTC_ROUTES.find((item) => item.id === routeId);
  if (!route || !/^\d+$/.test(amountText)) {
    return Response.json({ error: 'Need a known route and a token amount.' }, { status: 400 });
  }
  const amount = BigInt(amountText);
  const destChainId = parseDestChain(url.searchParams.get('dest'), route.chainId);
  if (amount <= 0n) return Response.json({ quote: null });
  try {
    if (destChainId !== route.chainId) {
      if (!isAddress(user)) {
        return Response.json({ error: 'Connect a wallet to quote a cross-network swap.' }, { status: 400 });
      }
      const quote = await quoteRelayTbtc({
        user,
        fromChainId: route.chainId,
        toChainId: destChainId,
        fromToken: route.from,
        toToken: tbtcToken(destChainId).address,
        amount,
      });
      if (!quote) return Response.json({ quote: null });
      return Response.json({
        quote: {
          out: quote.out.toString(),
          destChainId,
          steps: quote.steps.map((step) => ({
            kind: step.kind,
            to: step.to,
            data: step.data,
            value: step.value.toString(),
            chainId: step.chainId,
          })),
        },
      });
    }
    const quote = await quoteTbtcSwap(publicClient(route.chainId), route, amount);
    if (!quote) return Response.json({ quote: null });
    return Response.json({
      quote: {
        out: quote.out.toString(),
        fee: quote.fee ?? null,
        path: quote.path ?? null,
        destChainId,
      },
    });
  } catch {
    return Response.json({ error: 'Quote unavailable. Try again in a moment.' }, { status: 503 });
  }
}
