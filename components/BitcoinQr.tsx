'use client';

import { useEffect, useState } from 'react';

export default function BitcoinQr({ value }: { value: string }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    if (!value.startsWith('bitcoin:') && !value.startsWith('bc1') && !value.startsWith('1')) {
      setSrc('');
      return;
    }
    let cancelled = false;
    void import('qrcode').then(({ toDataURL }) => toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 240,
      color: { dark: '#111111', light: '#ffffff' },
    })).then((url) => {
      if (!cancelled && url.startsWith('data:image/')) setSrc(url);
    }).catch(() => {
      if (!cancelled) setSrc('');
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!src) return <div className="mx-auto aspect-square w-40 animate-pulse rounded-xl bg-white" />;

  return (
    <div className="mx-auto w-40 rounded-xl bg-white p-2">
      {/* Local data URL only. The deposit address is not sent to a QR service. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Bitcoin deposit QR code" width={240} height={240} className="h-auto w-full" />
    </div>
  );
}
