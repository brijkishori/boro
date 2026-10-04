'use client';
import { useMemo } from 'react';
import { useAccount } from 'wagmi';
import { episodeForVenue, useAudit } from '@/components/useAudit';
import { useAllPositions, type OpenPosition } from '@/components/useAllPositions';
import { useRates } from '@/components/useRates';
import { loanRateHistory } from '@/lib/finance/openingApr';
import { episodeKey, reconcileSeedOnlyOpenEpisodes } from '@/lib/audit';
import { buildActiveLoanView, type ActiveLoanView } from '@/lib/finance/loanView';
import { activeDebtPositions, zeroDebtMarkets } from '@/lib/finance/portfolio';
import { normalizeCompoundLoanBookPositions } from '@/lib/finance/compoundPositions';
export function useLoanBook() {
  const { address, isConnected } = useAccount();
  const rates = useRates();
  const venues = rates.payload?.venues ?? [];
  const positions = useAllPositions(venues, address);
  const rawAudit = useAudit(address);
  const borrowMarkets = normalizeCompoundLoanBookPositions(
    positions.positions.filter((item) => item.venue.action === 'borrow' && (item.snapshot.debt > 0n || item.snapshot.collateral > 0n)),
  );
  const active = activeDebtPositions(borrowMarkets);
  const idle = zeroDebtMarkets(borrowMarkets);
  const reconciledEpisodes = useMemo(() => {
    if (!address) return rawAudit.episodes;
    const verifiedIds = new Set(positions.verifiedVenueIds);
    const liveKeys = borrowMarkets
      .filter((item) => item.verified === true && item.snapshot.debt > 0n)
      .map((item) => episodeKey(address, item.venue));
    const verifiedKeys = venues
      .filter((venue) => venue.action === 'borrow' && verifiedIds.has(venue.id))
      .map((venue) => episodeKey(address, venue));
    return reconcileSeedOnlyOpenEpisodes(rawAudit.episodes, rawAudit.events, liveKeys, verifiedKeys);
  }, [address, borrowMarkets, positions.verifiedVenueIds, rawAudit.episodes, rawAudit.events, venues]);
  const audit = { ...rawAudit, episodes: reconciledEpisodes };
  const views = useMemo(() => active.map((position) => {
    const episode = episodeForVenue(reconciledEpisodes, address, position.venue);
    return loanView(position, rawAudit.events, episode?.key ?? null, episode);
  }), [active, address, rawAudit.events, reconciledEpisodes]);
  return { address, isConnected, ...rates, venues, positions, audit, borrowMarkets, active, idle, views };
}
function loanView(position: OpenPosition, events: ReturnType<typeof useAudit>['events'], lifecycleId: string | null, episode: ReturnType<typeof episodeForVenue>) {
  const history = loanRateHistory(events, lifecycleId ?? '');
  const { venue, snapshot } = position;
  return buildActiveLoanView({
    id: venue.id,
    lifecycleId,
    protocol: venue.protocol,
    chainId: venue.chainId,
    assetSymbol: venue.assetSymbol,
    loanSymbol: venue.loanSymbol,
    assetDecimals: venue.assetDecimals,
    loanDecimals: venue.loanDecimals,
    collateral: snapshot.collateral,
    debt: snapshot.debt,
    priceUsd: venue.priceUsd,
    ltv: snapshot.ltv,
    healthFactor: snapshot.healthFactor,
    liquidationPrice: snapshot.liquidationPrice,
    liquidationThreshold: venue.collateralRisk?.liquidationLtv ?? venue.collateralRisk?.liquidationThreshold ?? venue.maxLtv,
    currentApr: venue.borrowApr,
    openingApr: history.opening?.normalizedBorrowApr ?? null,
    episode,
    fetchedAt: position.observedAt,
    positionReadFailed: !snapshot.ready,
  });
}
export type { ActiveLoanView };
