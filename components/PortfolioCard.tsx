'use client';

import { useMemo } from 'react';
import { useAccount, useReadContracts } from 'wagmi';
import { formatUnits, type Address } from 'viem';
import { Card, CardContent } from '@/components/ui/card';
import CoinbaseTransferButton from '@/components/CoinbaseTransferButton';
import { aavePoolAbi, erc20Abi, morphoAbi } from '@/lib/abi';
import { formatToken, formatUsdExact } from '@/lib/amount';
import { AAVE_POOLS, CHAINS, MORPHO_BLUE, chainLabel, protocolLabel, type ChainId, type Venue } from '@/lib/protocol';
import { morphoDebtAssets } from '@/lib/risk';

const CHAIN_IDS: ChainId[] = [8453, 1];
const VIRTUAL_SHARES = 1_000_000n;

type Holding = { key: string; label: string; symbol: string; amount: bigint; decimals: number; usd: number; venue?: Venue; mode?: 'repay' | 'lend' };

function asBigint(value: unknown): bigint {
  return typeof value === 'bigint' ? value : 0n;
}

function toUsd(amount: bigint, decimals: number, price: number) {
  return Number(formatUnits(amount, decimals)) * price;
}

export default function PortfolioCard({ venues, btcPrice, onOpen }: { venues: Venue[]; btcPrice: number; onOpen: (venue: Venue, mode: 'repay' | 'lend') => void }) {
  const { address } = useAccount();

  const walletTokens = useMemo(
    () => CHAIN_IDS.flatMap((chainId) => CHAINS[chainId].btc.map((token) => ({ chainId, token }))),
    [],
  );
  const aaveAssets = useMemo(() => {
    const seen = new Map<string, Venue>();
    for (const venue of venues) {
      if (venue.protocol !== 'aave' || !venue.aave) continue;
      const key = `${venue.chainId}:${venue.assetAddress}`;
      const current = seen.get(key);
      if (!current || (current.action === 'lend' && venue.action === 'borrow')) seen.set(key, venue);
    }
    return [...seen.values()];
  }, [venues]);
  const morphoVenues = useMemo(() => venues.filter((venue) => venue.protocol === 'morpho' && venue.morpho), [venues]);

  const contracts = useMemo(() => {
    if (!address) return [];
    const owner = address as Address;
    return [
      ...walletTokens.map(({ chainId, token }) => ({ address: token.address, abi: erc20Abi, functionName: 'balanceOf' as const, args: [owner] as const, chainId })),
      ...aaveAssets.map((venue) => ({ address: venue.aave!.aToken, abi: erc20Abi, functionName: 'balanceOf' as const, args: [owner] as const, chainId: venue.chainId })),
      ...CHAIN_IDS.map((chainId) => ({ address: AAVE_POOLS[chainId], abi: aavePoolAbi, functionName: 'getUserAccountData' as const, args: [owner] as const, chainId })),
      ...morphoVenues.flatMap((venue) => [
        { address: MORPHO_BLUE, abi: morphoAbi, functionName: 'position' as const, args: [venue.morpho!.marketId, owner] as const, chainId: venue.chainId },
        { address: MORPHO_BLUE, abi: morphoAbi, functionName: 'market' as const, args: [venue.morpho!.marketId] as const, chainId: venue.chainId },
      ]),
    ];
  }, [address, walletTokens, aaveAssets, morphoVenues]);

  const { data, isLoading } = useReadContracts({ contracts, query: { enabled: contracts.length > 0, refetchInterval: 20_000 } });

  const summary = useMemo(() => {
    const wallet: Holding[] = [];
    const supplied: Holding[] = [];
    let debtUsd = 0;
    if (!data) return { wallet, supplied, debtUsd };
    let index = 0;
    for (const { chainId, token } of walletTokens) {
      const amount = asBigint(data[index++]?.result);
      if (amount > 0n) wallet.push({ key: `w:${chainId}:${token.symbol}`, label: `Wallet · ${chainLabel(chainId)}`, symbol: token.symbol, amount, decimals: token.decimals, usd: toUsd(amount, token.decimals, btcPrice) });
    }
    for (const venue of aaveAssets) {
      const amount = asBigint(data[index++]?.result);
      if (amount > 0n) supplied.push({ key: `a:${venue.id}`, label: `${protocolLabel('aave')} · ${chainLabel(venue.chainId)}`, symbol: venue.assetSymbol, amount, decimals: venue.assetDecimals, usd: toUsd(amount, venue.assetDecimals, venue.priceUsd || btcPrice), venue, mode: venue.action === 'borrow' ? 'repay' : 'lend' });
    }
    for (let i = 0; i < CHAIN_IDS.length; i += 1) {
      const account = data[index++]?.result as readonly bigint[] | undefined;
      if (account) debtUsd += Number(formatUnits(account[1] ?? 0n, 8));
    }
    for (const venue of morphoVenues) {
      const position = data[index++]?.result as readonly [bigint, bigint, bigint] | undefined;
      const market = data[index++]?.result as readonly bigint[] | undefined;
      if (!position || !market) continue;
      const [supplyShares, borrowShares, collateral] = position;
      if (venue.action === 'borrow' && collateral > 0n) {
        supplied.push({ key: `mc:${venue.id}`, label: `${protocolLabel('morpho')} collateral · ${chainLabel(venue.chainId)}`, symbol: venue.assetSymbol, amount: collateral, decimals: venue.assetDecimals, usd: toUsd(collateral, venue.assetDecimals, venue.priceUsd || btcPrice), venue, mode: 'repay' });
      }
      if (venue.action === 'borrow' && borrowShares > 0n) {
        debtUsd += Number(formatUnits(morphoDebtAssets(borrowShares, market[2] ?? 0n, market[3] ?? 0n), venue.loanDecimals));
      }
      if (venue.action === 'lend' && supplyShares > 0n) {
        const assets = (supplyShares * ((market[0] ?? 0n) + 1n)) / ((market[1] ?? 0n) + VIRTUAL_SHARES);
        if (assets > 0n) supplied.push({ key: `ml:${venue.id}`, label: `${protocolLabel('morpho')} lending · ${chainLabel(venue.chainId)}`, symbol: venue.assetSymbol, amount: assets, decimals: venue.assetDecimals, usd: toUsd(assets, venue.assetDecimals, venue.priceUsd || btcPrice), venue, mode: 'lend' });
      }
    }
    return { wallet, supplied, debtUsd };
  }, [data, walletTokens, aaveAssets, morphoVenues, btcPrice]);

  if (!address) return null;
  const rows = [...summary.wallet, ...summary.supplied];
  const totalBtc = rows.reduce((sum, row) => sum + Number(formatUnits(row.amount, row.decimals)), 0);
  const totalUsd = rows.reduce((sum, row) => sum + row.usd, 0);
  const noBtcOnBase = !summary.wallet.some((row) => row.key.startsWith('w:8453:'));

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">Your BTC · Base and Ethereum</p>
            <p className="text-2xl font-bold tracking-tight">{isLoading && !data ? 'Reading…' : `${totalBtc.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')} BTC`}</p>
            <p className="text-sm text-muted-foreground">{formatUsdExact(totalUsd)}</p>
          </div>
          {summary.debtUsd > 0 && (
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Borrowed</p>
              <p className="text-lg font-bold text-red-500">{formatUsdExact(summary.debtUsd)}</p>
              <p className="text-xs text-muted-foreground">Net {formatUsdExact(totalUsd - summary.debtUsd)}</p>
            </div>
          )}
        </div>

        {rows.length > 0 && (
          <div className="space-y-1.5">
            {rows.map((row) => {
              const content = (
                <>
                  <span className="text-muted-foreground">{row.label}</span>
                  <span className="text-right font-semibold">
                    {formatToken(row.amount, row.decimals)} {row.symbol}
                    <span className="ml-1 font-normal text-muted-foreground">{formatUsdExact(row.usd)}</span>
                  </span>
                </>
              );
              return row.venue && row.mode ? (
                <button key={row.key} type="button" className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 text-xs hover:bg-muted" onClick={() => onOpen(row.venue!, row.mode!)}>
                  {content}
                </button>
              ) : (
                <div key={row.key} className="flex items-center justify-between gap-2 px-1 py-0.5 text-xs">{content}</div>
              );
            })}
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Supplied BTC is held by the Aave or Morpho contract, and only this wallet can withdraw it. Coinbase&apos;s BTC-backed loans work the same way. Tap a supplied row to repay or withdraw it.
        </p>

        {noBtcOnBase && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <p className="flex-1 text-xs text-muted-foreground">Have BTC in a Coinbase account? Send it here as cbBTC on Base, 1:1.</p>
            <CoinbaseTransferButton className="h-9 bg-blue-600 text-xs text-white hover:bg-blue-700" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
