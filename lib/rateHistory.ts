import type { Venue } from '@/lib/protocol';
import { storeJson, storeSetJson } from '@/lib/store';

export type RatePoint = { t: number; borrow: number; supply: number; utilization?: number };

export async function snapshotRates(venues: Venue[]) {
  const hour = Math.floor(Date.now() / 3_600_000);
  const last = await storeJson<number>('rates:lastHour');
  if (last === hour) return;
  for (const venue of venues) {
    const key = `rates:hist:${venue.id}`;
    const points = (await storeJson<RatePoint[]>(key)) ?? [];
    const next: RatePoint = { t: Math.floor(Date.now() / 1000), borrow: venue.borrowApr, supply: venue.supplyApr };
    if (venue.utilization !== undefined) next.utilization = venue.utilization;
    points.push(next);
    await storeSetJson(key, points.slice(-24 * 90));
  }
  await storeSetJson('rates:lastHour', hour);
}
