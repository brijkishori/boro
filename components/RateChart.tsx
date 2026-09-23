'use client';

import { useEffect, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatApr } from '@/lib/amount';
import type { Venue } from '@/lib/protocol';

type Point = { t: number; borrow: number; supply: number; utilization?: number };

export default function RateChart({ venue }: { venue: Venue }) {
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [points, setPoints] = useState<Point[]>([]);

  useEffect(() => {
    let live = true;
    void fetch(`/api/rates/history?venue=${encodeURIComponent(venue.id)}&range=${range}`)
      .then((response) => response.json() as Promise<{ points?: Point[] }>)
      .then((body) => {
        if (live) setPoints(Array.isArray(body.points) ? body.points : []);
      })
      .catch(() => {
        if (live) setPoints([]);
      });
    return () => {
      live = false;
    };
  }, [range, venue.id]);

  const borrow = points.map((point) => point.borrow).filter((value) => Number.isFinite(value));
  const average = borrow.length > 0 ? borrow.reduce((sum, value) => sum + value, 0) / borrow.length : venue.borrowApr;
  const min = borrow.length > 0 ? Math.min(...borrow) : venue.borrowApr;
  const max = borrow.length > 0 ? Math.max(...borrow) : venue.borrowApr;
  const belowAverage = venue.borrowApr + 0.0005 < average;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {(['7d', '30d', '90d'] as const).map((item) => (
          <button key={item} type="button" className={`rounded-md px-2 py-1 text-[11px] font-semibold ${range === item ? 'bg-muted' : 'text-muted-foreground'}`} onClick={() => setRange(item)}>
            {item}
          </button>
        ))}
      </div>
      {points.length > 1 ? (
        <div className="h-36">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points}>
              <XAxis dataKey="t" hide />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip formatter={(value) => formatApr(Number(value))} labelFormatter={(value) => new Date(Number(value) * 1000).toLocaleDateString()} />
              <Line type="monotone" dataKey="borrow" stroke="#2563eb" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">History appears after the first snapshots, or for Morpho markets with public history.</p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Now {formatApr(venue.borrowApr)} · {range} avg {formatApr(average)} · low {formatApr(min)} · high {formatApr(max)}
        {belowAverage ? ' · Below average' : ''}
        {venue.utilization !== undefined ? ` · Utilization ${(venue.utilization * 100).toFixed(0)}%` : ''}
      </p>
    </div>
  );
}
