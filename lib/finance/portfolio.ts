import { formatUnits } from 'viem';
import { isAprDecimal } from '@/lib/finance/carry';
import { asBig, type AuditEvent, type LoanEpisode } from '@/lib/audit';
import { distanceToLiquidation, loanToValue } from '@/lib/finance/ltv';
import type { PositionSnapshot } from '@/lib/adapters';
import type { Venue } from '@/lib/protocol';

export type OpenDebtPosition = {
  venue: Venue;
  snapshot: PositionSnapshot;
};

export type PortfolioDebtSummary = {
  totalCollateralUsd: number;
  totalDebtUsd: number;
  weightedBorrowApr: number | null;
  estimatedMonthlyInterest: number | null;
  worstHealthFactor: number | null;
  highestLtv: number | null;
  nearestLiquidationPrice: number | null;
  smallestCushion: number | null;
  interestPaidMonthToDate: number | null;
  interestPaidYearToDate: number | null;
};

function debtUsd(position: OpenDebtPosition): number {
  return Number(formatUnits(position.snapshot.debt, position.venue.loanDecimals));
}

function collateralUsd(position: OpenDebtPosition): number {
  const amount = Number(formatUnits(position.snapshot.collateral, position.venue.assetDecimals));
  return amount > 0 && position.venue.priceUsd > 0 ? amount * position.venue.priceUsd : 0;
}

export function activeDebtPositions(positions: OpenDebtPosition[]): OpenDebtPosition[] {
  return positions.filter((item) => item.venue.action === 'borrow' && item.snapshot.debt > 0n && debtUsd(item) > 0);
}

export function zeroDebtMarkets(positions: OpenDebtPosition[]): OpenDebtPosition[] {
  return positions.filter((item) => item.venue.action === 'borrow' && item.snapshot.debt === 0n && item.snapshot.collateral > 0n);
}

export function weightedBorrowApr(positions: OpenDebtPosition[]): number | null {
  let weight = 0;
  let debt = 0;
  for (const item of activeDebtPositions(positions)) {
    const usd = debtUsd(item);
    const apr = item.venue.borrowApr;
    if (!(usd > 0) || !isAprDecimal(apr)) continue;
    weight += usd * apr;
    debt += usd;
  }
  if (!(debt > 0)) return null;
  return weight / debt;
}

export function interestPaidUsd(events: AuditEvent[], start: number, end: number): number | null {
  let total = 0;
  let found = false;
  for (const event of events) {
    if (event.action !== 'repay' || event.at < start || event.at > end) continue;
    const paid = asBig(event.interestPaid);
    if (paid <= 0n) continue;
    const decimals = event.decimals > 0 && event.decimals <= 18 ? event.decimals : 6;
    total += Number(formatUnits(paid, decimals));
    found = true;
  }
  return found ? total : null;
}

export function portfolioDebtSummary(
  positions: OpenDebtPosition[],
  events: AuditEvent[] = [],
  now = Date.now(),
): PortfolioDebtSummary | null {
  const open = activeDebtPositions(positions);
  if (open.length === 0) return null;

  let totalCollateralUsd = 0;
  let totalDebtUsd = 0;
  let worstHealthFactor: number | null = null;
  let highestLtv: number | null = null;
  let nearestLiquidationPrice: number | null = null;
  let smallestCushion: number | null = null;

  for (const item of open) {
    const debt = debtUsd(item);
    const collateral = collateralUsd(item);
    totalDebtUsd += debt;
    totalCollateralUsd += collateral;
    const ltv = item.snapshot.ltv > 0
      ? item.snapshot.ltv
      : loanToValue(collateral, debt);
    if (ltv !== null && (highestLtv === null || ltv > highestLtv)) highestLtv = ltv;
    if (item.snapshot.healthFactor !== null) {
      if (worstHealthFactor === null || item.snapshot.healthFactor < worstHealthFactor) {
        worstHealthFactor = item.snapshot.healthFactor;
      }
    }
    if (item.snapshot.liquidationPrice > 0) {
      if (nearestLiquidationPrice === null || item.snapshot.liquidationPrice > nearestLiquidationPrice) {
        nearestLiquidationPrice = item.snapshot.liquidationPrice;
      }
      const cushion = distanceToLiquidation(item.venue.priceUsd, item.snapshot.liquidationPrice);
      if (cushion !== null && (smallestCushion === null || cushion < smallestCushion)) {
        smallestCushion = cushion;
      }
    }
  }

  const weighted = weightedBorrowApr(open);
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const yearStart = new Date(now);
  yearStart.setMonth(0, 1);
  yearStart.setHours(0, 0, 0, 0);

  return {
    totalCollateralUsd,
    totalDebtUsd,
    weightedBorrowApr: weighted,
    estimatedMonthlyInterest: weighted === null ? null : totalDebtUsd * weighted / 12,
    worstHealthFactor,
    highestLtv,
    nearestLiquidationPrice,
    smallestCushion,
    interestPaidMonthToDate: interestPaidUsd(events, monthStart.getTime(), now),
    interestPaidYearToDate: interestPaidUsd(events, yearStart.getTime(), now),
  };
}

export function episodeInterestUsd(episode: LoanEpisode | null | undefined, decimals = 6): number {
  if (!episode) return 0;
  return Number(formatUnits(asBig(episode.interestPaid), decimals));
}
