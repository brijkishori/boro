'use client';

import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { Card, CardContent } from '@/components/ui/card';
import CoinbaseTransferButton from '@/components/CoinbaseTransferButton';
import { useAllPositions } from '@/components/useAllPositions';
import { useWalletHoldings } from '@/components/useWalletHoldings';
import { matchesNetwork, networkTitle, useNetworkFilter } from '@/components/NetworkFilter';
import { formatToken, formatUsdExact } from '@/lib/amount';
import { chainLabel, protocolLabel, type Venue } from '@/lib/protocol';

type WalletRow = { key: string; label: string; symbol: string; amount: bigint; decimals: number; usd: number };
type SuppliedRow = WalletRow & { venue: Venue; mode: 'lend' | 'repay'; debtUsd: number };

function isSuppliedRow(row: WalletRow | SuppliedRow): row is SuppliedRow {
  return 'venue' in row;
}

export default function PortfolioCard({ venues, btcPrice, onOpen }: { venues: Venue[]; btcPrice: number; onOpen: (venue: Venue, mode: 'repay' | 'lend') => void }) {
  const { address } = useAccount();
  const { network } = useNetworkFilter();
  const { positions, isLoading } = useAllPositions(venues, address);
  const holdings = useWalletHoldings();

  if (!address) return null;

  const walletRows: WalletRow[] = holdings.rows.flatMap((row) => {
    if (row.kind !== 'btc' || row.amount <= 0n || !matchesNetwork(row.chainId, network)) return [];
    return [{ key: `w:${row.chainId}:${row.symbol}`, label: `Wallet · ${row.network}`, symbol: row.symbol, amount: row.amount, decimals: row.decimals, usd: row.usd ?? Number(formatUnits(row.amount, row.decimals)) * btcPrice }];
  });
  const suppliedRows: SuppliedRow[] = positions.map(({ venue, snapshot }) => ({
    key: venue.id,
    label: `${protocolLabel(venue.protocol)} · ${chainLabel(venue.chainId)}`,
    symbol: venue.assetSymbol,
    amount: snapshot.collateral,
    decimals: venue.assetDecimals,
    usd: Number(formatUnits(snapshot.collateral, venue.assetDecimals)) * (venue.priceUsd || btcPrice),
    venue,
    mode: (venue.action === 'lend' ? 'lend' : 'repay') as 'lend' | 'repay',
    debtUsd: Number(formatUnits(snapshot.debt, venue.loanDecimals)),
  }));
  const rows = [...walletRows, ...suppliedRows.filter((row) => row.amount > 0n)];
  const totalBtc = rows.reduce((sum, row) => sum + Number(formatUnits(row.amount, row.decimals)), 0);
  const totalUsd = rows.reduce((sum, row) => sum + row.usd, 0);
  const debtUsd = suppliedRows.reduce((sum, row) => sum + row.debtUsd, 0);
  const noBtcOnBase = matchesNetwork(8453, network) && !walletRows.some((row) => row.key.startsWith('w:8453:'));

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">Your BTC · {networkTitle(network)}</p>
            <p className="text-2xl font-bold tracking-tight">{isLoading && rows.length === 0 ? 'Reading…' : `${totalBtc.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')} BTC`}</p>
            <p className="text-sm text-muted-foreground">{formatUsdExact(totalUsd)}</p>
          </div>
          {debtUsd > 0 && (
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">Borrowed</p>
              <p className="text-lg font-bold text-red-500">{formatUsdExact(debtUsd)}</p>
              <p className="text-xs text-muted-foreground">Net {formatUsdExact(totalUsd - debtUsd)}</p>
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
              return isSuppliedRow(row) ? (
                <button key={row.key} type="button" className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-0.5 text-xs hover:bg-muted" onClick={() => onOpen(row.venue, row.mode)}>
                  {content}
                </button>
              ) : (
                <div key={row.key} className="flex items-center justify-between gap-2 px-1 py-0.5 text-xs">{content}</div>
              );
            })}
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Supplied BTC is held by the protocol contract, and only this wallet can withdraw it. Tap a supplied row to repay or withdraw.
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
