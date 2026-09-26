'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useReadContract, useSwitchChain } from 'wagmi';
import { erc20Abi } from '@/lib/abi';
import { approvalStep, formatToken, formatUsdExact, tokenAmountUsd } from '@/lib/amount';
import { chainLabel, isChainId, type ChainId } from '@/lib/protocol';
import {
  SLIPPAGE_BPS,
  SWAP_ROUTER,
  TBTC_ROUTES,
  uniswapSwapUrl,
  swapRouterAbi,
  type RelaySwapStep,
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
import ThresholdMint from '@/components/ThresholdMint';

function readSteps(value: unknown): RelaySwapStep[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const steps: RelaySwapStep[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return undefined;
    const row = item as { kind?: unknown; to?: unknown; data?: unknown; value?: unknown; chainId?: unknown };
    if ((row.kind !== 'approve' && row.kind !== 'deposit') || typeof row.to !== 'string' || typeof row.data !== 'string') return undefined;
    if (!row.data.startsWith('0x') || typeof row.value !== 'string' || !/^\d+$/.test(row.value)) return undefined;
    const chainId = Number(row.chainId);
    if (!isChainId(chainId)) return undefined;
    steps.push({
      kind: row.kind,
      to: row.to as `0x${string}`,
      data: row.data as `0x${string}`,
      value: BigInt(row.value),
      chainId,
    });
  }
  return steps;
}

function readQuote(body: unknown): SwapQuote | null {
  if (!body || typeof body !== 'object' || !('quote' in body)) return null;
  const quote = (body as { quote?: { out?: unknown; fee?: unknown; path?: unknown; destChainId?: unknown; steps?: unknown } }).quote;
  if (!quote || typeof quote.out !== 'string' || !/^\d+$/.test(quote.out)) return null;
  const out = BigInt(quote.out);
  if (out <= 0n) return null;
  const fee = typeof quote.fee === 'number' ? quote.fee : undefined;
  const path = typeof quote.path === 'string' && quote.path.startsWith('0x') ? quote.path as `0x${string}` : undefined;
  const dest = Number(quote.destChainId);
  const destChainId = isChainId(dest) ? dest : undefined;
  return { out, fee, path, destChainId, steps: readSteps(quote.steps) };
}

export default function TbtcConvert({ btcPriceUsd }: { btcPriceUsd: number }) {
  const { address, chain, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { send, sendRaw, isBusy, isAwaitingWallet, confirmed } = useSendTx();
  const holdings = useWalletHoldings();
  const [routeId, setRouteId] = useState(TBTC_ROUTES[0].id);
  const [destChainId, setDestChainId] = useState<ChainId>(TBTC_ROUTES[0].chainId);
  const [amount, setAmount] = useState<bigint | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [relayStep, setRelayStep] = useState(0);
  const [relayApproved, setRelayApproved] = useState(false);
  const [lastOut, setLastOut] = useState<string | null>(null);
  const route = TBTC_ROUTES.find((item) => item.id === routeId) ?? TBTC_ROUTES[0];
  const crossChain = destChainId !== route.chainId;
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
      const params = new URLSearchParams({
        route: route.id,
        amount: amount.toString(),
        dest: String(destChainId),
      });
      if (address) params.set('user', address);
      void fetch(`/api/tbtc-quote?${params}`, { cache: 'no-store' })
        .then((response) => response.json())
        .then((body: unknown) => {
          const next = readQuote(body);
          if (!cancelled && next) setQuote(next);
        })
        .catch(() => {
          if (!cancelled) setQuote((current) => current);
        })
        .finally(() => {
          if (!cancelled) setQuoting(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [address, amount, destChainId, route.id]);

  useEffect(() => {
    if (!quote?.steps?.length) return;
    const depositAt = quote.steps.findIndex((item) => item.kind === 'deposit');
    if (depositAt < 0) return;
    if (relayApproved || quote.steps[0]?.kind === 'deposit') setRelayStep(depositAt);
  }, [quote, relayApproved]);

  useEffect(() => {
    if (!confirmed) return;
    void refetchAllowance();
    holdings.refetch();
    if (confirmed.action === 'approve' && (quote?.steps?.some((item) => item.kind === 'deposit') || crossChain)) {
      setRelayApproved(true);
      const depositAt = quote?.steps?.findIndex((item) => item.kind === 'deposit') ?? -1;
      if (depositAt >= 0) setRelayStep(depositAt);
      return;
    }
    if (confirmed.action === 'swap') {
      if (quote) {
        const dest = quote.destChainId ?? destChainId;
        setLastOut(
          crossChain
            ? `tBTC is on the way to ${chainLabel(dest)}. About ${formatToken(quote.out, 18)} tBTC usually arrives in under a minute.`
            : `Received about ${formatToken(quote.out, route.toDecimals)} tBTC on ${chainLabel(dest)}.`,
        );
      }
      setAmount(null);
      setQuote(null);
      setRelayStep(0);
      setRelayApproved(false);
      setEpoch((value) => value + 1);
    }
  }, [confirmed]);

  const relayNext = quote?.steps?.[relayStep] ?? quote?.steps?.find((item) => item.kind === (relayApproved ? 'deposit' : 'approve'));
  const crossNeedsApprove = Boolean(crossChain && quote?.steps?.some((item) => item.kind === 'approve') && !relayApproved);
  const step = crossChain
    ? (crossNeedsApprove ? 'approve' : 'none')
    : approvalStep(allowance ?? 0n, amount ?? 0n);
  const canSwap = crossChain
    ? Boolean(quote?.steps?.some((item) => item.kind === 'deposit') && (relayApproved || quote.steps[0]?.kind === 'deposit'))
    : Boolean(quote);
  const wrongChain = isConnected && chain?.id !== route.chainId;
  const tooBig = amount !== null && amount > fromBalance;
  const minOut = quote ? quote.out - (quote.out * SLIPPAGE_BPS) / 10_000n : 0n;

  async function approve() {
    if (!amount) return;
    if (relayNext?.kind === 'approve') {
      await sendRaw('approve', relayNext);
      return;
    }
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
    if (relayNext?.kind === 'deposit') {
      await sendRaw('swap', relayNext);
      return;
    }
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
          setRelayStep(0);
          setRelayApproved(false);
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
          <p className="text-sm font-bold">Convert Bitcoin you already hold to tBTC</p>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Enter an amount. Approve once if asked, then convert. Same-network swaps finish after the second confirmation. Crossing networks usually takes under a minute.
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
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Receive tBTC on</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {([8453, 1] as const).map((chainId) => (
              <button
                key={chainId}
                type="button"
                aria-pressed={destChainId === chainId}
                onClick={() => {
                  setDestChainId(chainId);
                  setRelayStep(0);
                  setRelayApproved(false);
                  setQuote(null);
                }}
                className={`rounded-lg border px-3 py-2 text-left ${destChainId === chainId ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10' : ''}`}
              >
                <p className="font-semibold">{chainLabel(chainId)} tBTC</p>
                <p className="font-bold">{isConnected ? formatToken(chainId === 8453 ? tbtcBase : tbtcEth, 18) : '—'}</p>
                <p className="text-muted-foreground">
                  {chainId === route.chainId ? 'Uniswap on this network' : `From ${route.fromSymbol} on ${chainLabel(route.chainId)}`}
                </p>
              </button>
            ))}
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
              ? `You receive about ${formatToken(quote.out, 18)} tBTC on ${chainLabel(destChainId)} (${formatUsdExact(tokenAmountUsd(quote.out, 18, btcPriceUsd) ?? 0)}). ${crossChain ? 'Relay fee is included in that quote.' : '1% slippage cap.'}`
              : quoting
                ? crossChain
                  ? `Looking for a route from ${chainLabel(route.chainId)} to ${chainLabel(destChainId)} tBTC…`
                  : 'Looking for the best Uniswap route…'
                : crossChain
                  ? `No in-app route from ${route.fromSymbol} on ${chainLabel(route.chainId)} to tBTC on ${chainLabel(destChainId)} for this size.`
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
          <Button className="h-11 w-full bg-blue-600 text-white" disabled={isBusy || !amount || !canSwap} onClick={() => void swap()}>
            {isAwaitingWallet ? 'Confirm in wallet…' : isBusy ? 'Confirming…' : `Swap to ${chainLabel(destChainId)} tBTC`}
          </Button>
        )}
        {amount !== null && amount > 0n && !quoting && !quote && !crossChain && (
          <Button asChild className="h-11 w-full" variant="outline">
            <a href={uniswapSwapUrl(route)} target="_blank" rel="noreferrer">
              Open Uniswap · {route.fromSymbol} to tBTC
            </a>
          </Button>
        )}

        <ThresholdMint btcPriceUsd={btcPriceUsd} />
      </CardContent>
    </Card>
  );
}
