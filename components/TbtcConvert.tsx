'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useReadContract, useSwitchChain } from 'wagmi';
import { erc20Abi } from '@/lib/abi';
import { approvalStep, formatToken, formatUsdExact, tokenAmountUsd } from '@/lib/amount';
import { chainLabel } from '@/lib/protocol';
import {
  SLIPPAGE_BPS,
  SWAP_ROUTER,
  TBTC_ROUTES,
  THRESHOLD_MINT_URL,
  uniswapSwapUrl,
  swapRouterAbi,
  type SwapQuote,
  type SwapRoute,
} from '@/lib/uniswap';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import UsdAmountField from '@/components/UsdAmountField';
import GasNotice from '@/components/GasNotice';
import { GAS_UNITS, useGasCheck } from '@/components/useGasCheck';
import { useSendTx } from '@/components/useSendTx';
import { useWalletHoldings } from '@/components/useWalletHoldings';

function readQuote(body: unknown): SwapQuote | null {
  if (!body || typeof body !== 'object' || !('quote' in body)) return null;
  const quote = (body as { quote?: { out?: unknown; fee?: unknown; path?: unknown } }).quote;
  if (!quote || typeof quote.out !== 'string' || !/^\d+$/.test(quote.out)) return null;
  const out = BigInt(quote.out);
  if (out <= 0n) return null;
  const fee = typeof quote.fee === 'number' ? quote.fee : undefined;
  const path = typeof quote.path === 'string' && quote.path.startsWith('0x') ? quote.path as `0x${string}` : undefined;
  return { out, fee, path };
}

export default function TbtcConvert({ btcPriceUsd }: { btcPriceUsd: number }) {
  const { address, chain, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { send, isBusy, isAwaitingWallet, confirmed } = useSendTx();
  const holdings = useWalletHoldings();
  const [routeId, setRouteId] = useState(TBTC_ROUTES[0].id);
  const [amount, setAmount] = useState<bigint | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [lastOut, setLastOut] = useState<string | null>(null);
  const route = TBTC_ROUTES.find((item) => item.id === routeId) ?? TBTC_ROUTES[0];
  const gas = useGasCheck(route.chainId, GAS_UNITS.write);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);

  const fromBalance = holdings.amountOf(route.chainId, route.fromSymbol);
  const tbtcBase = holdings.amountOf(8453, 'tBTC');
  const tbtcEth = holdings.amountOf(1, 'tBTC');
  const picked = useRef(false);

  useEffect(() => {
    if (!address || !holdings.ready || picked.current) return;
    const richest = TBTC_ROUTES
      .map((item) => ({ id: item.id, value: holdings.amountOf(item.chainId, item.fromSymbol) }))
      .sort((left, right) => (right.value > left.value ? 1 : -1))[0];
    if (richest && richest.value > 0n) {
      setRouteId(richest.id);
      picked.current = true;
    }
  }, [address, holdings]);

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: route.from,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address ? [address, SWAP_ROUTER[route.chainId]] : undefined,
    chainId: route.chainId,
    query: { enabled: Boolean(address), refetchInterval: 8_000, placeholderData: (previous) => previous },
  });

  useEffect(() => {
    if (!amount || amount <= 0n) {
      setQuote(null);
      setQuoting(false);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const timer = window.setTimeout(() => {
      void fetch(`/api/tbtc-quote?route=${encodeURIComponent(route.id)}&amount=${amount.toString()}`, { cache: 'no-store' })
        .then((response) => response.json())
        .then((body: unknown) => {
          if (!cancelled) setQuote(readQuote(body));
        })
        .catch(() => {
          if (!cancelled) setQuote(null);
        })
        .finally(() => {
          if (!cancelled) setQuoting(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [amount, route.id]);

  useEffect(() => {
    if (!confirmed) return;
    void refetchAllowance();
    holdings.refetch();
    if (confirmed.action === 'swap') {
      if (quote) {
        setLastOut(`Received about ${formatToken(quote.out, route.toDecimals)} tBTC on ${chainLabel(route.chainId)}.`);
      }
      setAmount(null);
      setQuote(null);
      setEpoch((value) => value + 1);
    }
  }, [confirmed]);

  const step = approvalStep(allowance ?? 0n, amount ?? 0n);
  const wrongChain = isConnected && chain?.id !== route.chainId;
  const tooBig = amount !== null && amount > fromBalance;
  const minOut = quote ? quote.out - (quote.out * SLIPPAGE_BPS) / 10_000n : 0n;

  async function approve() {
    if (!amount) return;
    await send('approve', {
      address: route.from,
      abi: erc20Abi,
      functionName: 'approve',
      args: [SWAP_ROUTER[route.chainId], amount],
      chainId: route.chainId,
    });
  }

  async function swap() {
    if (!address || !amount || !quote) return;
    if (quote.path) {
      await send('swap', {
        address: SWAP_ROUTER[route.chainId],
        abi: swapRouterAbi,
        functionName: 'exactInput',
        args: [{ path: quote.path, recipient: address, amountIn: amount, amountOutMinimum: minOut }],
        chainId: route.chainId,
      });
      return;
    }
    if (quote.fee === undefined) return;
    await send('swap', {
      address: SWAP_ROUTER[route.chainId],
      abi: swapRouterAbi,
      functionName: 'exactInputSingle',
      args: [{
        tokenIn: route.from,
        tokenOut: route.to,
        fee: quote.fee,
        recipient: address,
        amountIn: amount,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      }],
      chainId: route.chainId,
    });
  }

  function routeButton(item: SwapRoute) {
    const balance = holdings.amountOf(item.chainId, item.fromSymbol);
    const active = item.id === route.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => {
          setRouteId(item.id);
          setAmount(null);
          setEpoch((value) => value + 1);
        }}
        className={`rounded-lg border px-3 py-2 text-left text-xs ${active ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10' : ''}`}
      >
        <p className="font-semibold">{item.fromSymbol} → tBTC</p>
        <p className="text-muted-foreground">{chainLabel(item.chainId)}</p>
        <p className="font-bold">{isConnected ? `${formatToken(balance, item.fromDecimals)} ${item.fromSymbol}` : 'Connect wallet'}</p>
      </button>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Get tBTC</p>
          <p className="text-sm font-bold">Swap wrapped Bitcoin you already hold. Two wallet clicks.</p>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Approval only allows the swap. tBTC arrives after the second confirmation. Native Bitcoin still has to be sent from a Bitcoin wallet.
        </p>
        {lastOut && <p className="text-xs font-semibold text-emerald-600">{lastOut}</p>}
        {isConnected && (allowance ?? 0n) > 0n && (amount === null || amount === 0n) && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            This wallet already approved {formatToken(allowance ?? 0n, route.fromDecimals)} {route.fromSymbol} on {chainLabel(route.chainId)}. Type that amount or less, then tap Swap to tBTC. Approval alone does not move coins.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          {TBTC_ROUTES.map(routeButton)}
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border p-2">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">tBTC on Base</p>
            <p className="font-bold">{isConnected ? formatToken(tbtcBase, 18) : '—'}</p>
          </div>
          <div className="rounded-lg border p-2">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">tBTC on Ethereum</p>
            <p className="font-bold">{isConnected ? formatToken(tbtcEth, 18) : '—'}</p>
          </div>
        </div>
        <UsdAmountField
          label={`Swap ${route.fromSymbol}`}
          symbol={route.fromSymbol}
          decimals={route.fromDecimals}
          priceUsd={btcPriceUsd}
          balance={isConnected ? fromBalance : undefined}
          epoch={epoch}
          invalid={tooBig}
          disabled={!isConnected || fromBalance === 0n}
          onAmount={setAmount}
        />
        {amount !== null && amount > 0n && (
          <p className="text-xs text-muted-foreground">
            {quote
              ? `You receive about ${formatToken(quote.out, route.toDecimals)} tBTC (${formatUsdExact(tokenAmountUsd(quote.out, route.toDecimals, btcPriceUsd) ?? 0)}). 1% slippage cap.`
              : quoting
                ? 'Looking for the best Uniswap route…'
                : 'No in-app route for this size. Use Uniswap with the pair already filled in.'}
          </p>
        )}
        {!isConnected ? (
          <Button className="h-11 w-full" disabled>Connect a wallet to swap</Button>
        ) : fromBalance === 0n ? (
          <p className="text-xs text-muted-foreground">
            No {route.fromSymbol} on {chainLabel(route.chainId)} in this wallet. Pick another pair, or mint from native Bitcoin below.
          </p>
        ) : wrongChain ? (
          <Button className="h-11 w-full bg-indigo-600 text-white" disabled={isBusy} onClick={() => void switchChainAsync({ chainId: route.chainId })}>
            Switch to {chainLabel(route.chainId)}
          </Button>
        ) : !gas.enough ? (
          <GasNotice chainId={route.chainId} symbol={route.fromSymbol} neededEth={gas.neededEth} balanceEth={gas.balanceEth} />
        ) : tooBig ? (
          <Button className="h-11 w-full" disabled>Not enough {route.fromSymbol}</Button>
        ) : step !== 'none' ? (
          <Button className="h-11 w-full bg-indigo-600 text-white" disabled={isBusy || !amount} onClick={() => void approve()}>
            {isAwaitingWallet ? 'Confirm in wallet…' : isBusy ? 'Confirming…' : `Approve ${route.fromSymbol}`}
          </Button>
        ) : (
          <Button className="h-11 w-full bg-blue-600 text-white" disabled={isBusy || !amount || !quote} onClick={() => void swap()}>
            {isAwaitingWallet ? 'Confirm in wallet…' : isBusy ? 'Confirming…' : `Swap to tBTC`}
          </Button>
        )}
        {amount !== null && amount > 0n && !quoting && !quote && (
          <Button asChild className="h-11 w-full" variant="outline">
            <a href={uniswapSwapUrl(route)} target="_blank" rel="noreferrer">
              Open Uniswap · {route.fromSymbol} to tBTC
            </a>
          </Button>
        )}

        <div className="space-y-2 border-t pt-3">
          <p className="text-xs font-semibold">Only have Bitcoin on the Bitcoin network?</p>
          <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
            <li>Open Threshold’s Bitcoin Router (the current mint page, not the old dashboard).</li>
            <li>Connect this same Ethereum or Base wallet as the destination.</li>
            <li>Send BTC from your Bitcoin wallet to the one-time address they show. tBTC usually arrives in 1–3 hours.</li>
          </ol>
          <Button asChild size="sm" variant="outline">
            <a href={THRESHOLD_MINT_URL} target="_blank" rel="noreferrer">Open Threshold mint</a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
