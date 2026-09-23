'use client';

import Link from 'next/link';
import { formatApr, formatUsdExact } from '@/lib/amount';
import { compareBorrowVsLend, type ComparedPool, type MarketPair } from '@/lib/opportunities';
import { chainLabel, protocolAppUrl, protocolLabel, type Venue } from '@/lib/protocol';
import type { OpenPosition } from '@/components/useAllPositions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

function signedUsd(value: number) {
  const abs = formatUsdExact(Math.abs(value));
  if (value > 0.005) return `+${abs}`;
  if (value < -0.005) return `-${abs}`;
  return formatUsdExact(0);
}

function poolMatches(pool: ComparedPool, other: ComparedPool | undefined) {
  return Boolean(other && pool.protocol === other.protocol && pool.chainId === other.chainId);
}

function appFor(venues: Venue[], protocol: ComparedPool['protocol'], chainId: ComparedPool['chainId']) {
  const venue = venues.find((item) => item.protocol === protocol && item.chainId === chainId);
  return venue ? protocolAppUrl(venue) : null;
}

function PairCard({
  title,
  pair,
  venues,
}: {
  title: string;
  pair: MarketPair;
  venues: Venue[];
}) {
  const borrowApp = appFor(venues, pair.borrow.protocol, pair.borrow.chainId);
  const lendApp = appFor(venues, pair.lend.protocol, pair.lend.chainId);
  return (
    <div className="space-y-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-3">
      <p className="text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-400">{title}</p>
      <p className="text-sm font-bold">
        Borrow {pair.borrow.label} {formatApr(pair.borrow.apr)}, lend {pair.lend.label} {formatApr(pair.lend.apr)}
      </p>
      <p className={`text-lg font-bold ${pair.spread >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
        {signedUsd(pair.year)}/yr · {signedUsd(pair.month)}/mo · spread {formatApr(Math.abs(pair.spread))}
      </p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Same network, so no bridge. Rates move; Ethereum gas can erase a small dollar spread. Nothing is sent automatically.
      </p>
      <div className="flex flex-wrap gap-2">
        {borrowApp && (
          <Button asChild size="sm" className="h-9 bg-blue-600 text-xs text-white hover:bg-blue-700">
            <a href={borrowApp} target="_blank" rel="noreferrer">Open {protocolLabel(pair.borrow.protocol)}</a>
          </Button>
        )}
        {lendApp && lendApp !== borrowApp && (
          <Button asChild size="sm" variant="outline" className="h-9 text-xs">
            <a href={lendApp} target="_blank" rel="noreferrer">Open {protocolLabel(pair.lend.protocol)}</a>
          </Button>
        )}
      </div>
    </div>
  );
}

export default function BorrowVsLend({
  positions,
  venues,
  fetchedAt,
}: {
  positions: OpenPosition[];
  venues: Venue[];
  fetchedAt?: number;
}) {
  const compare = compareBorrowVsLend(positions, venues);
  if (!compare) return null;

  const { borrow, lendUsdc, lendBtc, bestPair } = compare;
  const betterThanLoan = Boolean(bestPair && bestPair.spread > compare.loopSpread + 0.0005);
  const headline = compare.loopPays
    ? 'Lending the borrowed dollars would cover this loan'
    : 'This loan does not pay for itself if you lend the cash back out';

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">Borrow vs lend</p>
            <p className="text-sm font-bold">{headline}</p>
          </div>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Live{fetchedAt ? ` · ${new Date(fetchedAt).toLocaleTimeString()}` : ''}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
          <div className="rounded-lg border px-3 py-2">
            <p className="text-muted-foreground">You pay to borrow</p>
            <p className="text-lg font-bold">{formatApr(borrow.apr)}</p>
            <p className="text-muted-foreground">{formatUsdExact(borrow.year)}/yr on {formatUsdExact(compare.debtUsd)}</p>
            <p className="text-[11px] text-muted-foreground">{protocolLabel(borrow.venue.protocol)} · {chainLabel(borrow.venue.chainId)}</p>
          </div>
          <div className="rounded-lg border px-3 py-2">
            <p className="text-muted-foreground">Earn if you lend that USDC here</p>
            <p className="text-lg font-bold">{lendUsdc ? formatApr(lendUsdc.apr) : '—'}</p>
            <p className="text-muted-foreground">{lendUsdc ? `${formatUsdExact(lendUsdc.year)}/yr` : 'No trusted USDC pool'}</p>
            {lendUsdc && (
              <p className="text-[11px] text-muted-foreground">{protocolLabel(lendUsdc.venue.protocol)} · {chainLabel(lendUsdc.venue.chainId)}</p>
            )}
          </div>
          <div className="col-span-2 rounded-lg border px-3 py-2 sm:col-span-1">
            <p className="text-muted-foreground">Net on this loan</p>
            <p className={`text-lg font-bold ${compare.loopNetYear >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {lendUsdc ? `${signedUsd(compare.loopNetYear)}/yr` : '—'}
            </p>
            <p className="text-muted-foreground">{lendUsdc ? `${signedUsd(compare.loopNetYear / 12)}/mo · spread ${formatApr(Math.abs(compare.loopSpread))}` : '—'}</p>
          </div>
        </div>

        <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
          {compare.personalized ? (
            <p>
              Live Aave/Morpho/Compound/Spark/Moonwell quotes. You pay {formatApr(borrow.apr)} on {formatUsdExact(compare.debtUsd)} ({formatUsdExact(borrow.year)} a year).
              {lendUsdc
                ? ` Lending that same USDC on this network at ${protocolLabel(lendUsdc.venue.protocol)} would earn ${formatApr(lendUsdc.apr)} (${formatUsdExact(lendUsdc.year)} a year).`
                : ' No trusted USDC supply pool is available on this network.'}
            </p>
          ) : (
            <p>
              Example on {formatUsdExact(compare.debtUsd)} of USDC on {chainLabel(compare.chainId)}: cheapest trusted borrow is {formatApr(borrow.apr)}
              {lendUsdc ? `, and the best trusted USDC lend is ${formatApr(lendUsdc.apr)}.` : '.'}
            </p>
          )}

          {compare.personalized && compare.collateralEarnYear > 0.01 && (
            <p>
              Your supplied {compare.assetSymbol} already earns {formatApr(compare.collateralEarnApr)} ({formatUsdExact(compare.collateralEarnYear)} a year).
              After the loan, this position nets about {signedUsd(compare.positionNetYear)} a year.
            </p>
          )}

          {compare.loopPays ? (
            <p>
              Net is about {formatUsdExact(compare.loopNetYear)} a year before gas. Spreads close, and you still have a liquidation price.
            </p>
          ) : lendUsdc ? (
            <p>
              On this loan, depositing the borrowed dollars back out on the same network is a loss
              ({signedUsd(compare.loopNetYear)} a year before gas).
            </p>
          ) : null}

          {compare.personalized && (
            <p>
              Keep this loan if you need the {formatUsdExact(compare.debtUsd)} in cash. If you do not, repay and the interest stops.
              {lendBtc && compare.collateralUsd > 0
                ? ` Supplying the ${compare.assetSymbol} instead would earn ${formatApr(lendBtc.apr)} on ${formatUsdExact(compare.collateralUsd)} (${formatUsdExact(lendBtc.year)} a year) with no liquidation price.`
                : ''}
            </p>
          )}
        </div>

        {bestPair && betterThanLoan && bestPair.spread > 0 && (
          <PairCard title="Live winner across every trusted pool" pair={bestPair} venues={venues} />
        )}

        {lendBtc && (
          <p className="text-[11px] text-muted-foreground">
            Best trusted BTC supply: {formatApr(lendBtc.apr)} on {protocolLabel(lendBtc.venue.protocol)} {lendBtc.venue.assetSymbol} ({chainLabel(lendBtc.venue.chainId)}).{' '}
            <Link href={`/?tab=lend&market=${encodeURIComponent(lendBtc.venue.id)}`} className="font-semibold text-blue-600 hover:underline">
              Open lend
            </Link>
          </p>
        )}

        {(compare.usdcPools.length > 0 || compare.borrowPools.length > 0) && (
          <div className="space-y-2 rounded-lg border px-3 py-2">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">Every trusted pool · live</p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Morpho, Aave, Compound, Spark, and Moonwell on Base and Ethereum. Highlighted rows are the cheapest borrow and the highest USDC lend on the same network.
            </p>
            <div className="grid gap-3 text-[11px] sm:grid-cols-2">
              {compare.usdcPools.length > 0 && (
                <div>
                  <p className="font-semibold text-foreground">USDC lend APY</p>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {compare.usdcPools.map((pool) => {
                      const win = poolMatches(pool, bestPair?.lend);
                      return (
                        <li key={`usdc:${pool.protocol}:${pool.chainId}`} className={`flex justify-between gap-2 rounded px-1 ${win ? 'bg-emerald-500/10 font-semibold text-foreground' : ''}`}>
                          <span>{pool.label}{win ? ' · best lend' : ''}</span>
                          <span className="text-foreground">{formatApr(pool.apr)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {compare.borrowPools.length > 0 && (
                <div>
                  <p className="font-semibold text-foreground">USDC borrow APR</p>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {compare.borrowPools.map((pool) => {
                      const win = poolMatches(pool, bestPair?.borrow);
                      const yours = compare.personalized && pool.protocol === borrow.venue.protocol && pool.chainId === borrow.venue.chainId;
                      return (
                        <li key={`borrow:${pool.protocol}:${pool.chainId}`} className={`flex justify-between gap-2 rounded px-1 ${win ? 'bg-emerald-500/10 font-semibold text-foreground' : yours ? 'bg-muted' : ''}`}>
                          <span>{pool.label}{win ? ' · cheapest borrow' : yours ? ' · your loan' : ''}</span>
                          <span className="text-foreground">{formatApr(pool.apr)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
