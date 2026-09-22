'use client';

import { useEffect, useState } from 'react';
import { isScannableUri } from '@/lib/wallets';

export default function WalletQr({ uri }: { uri: string }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    if (!isScannableUri(uri)) {
      setSrc('');
      return;
    }
    let cancelled = false;
    void import('qrcode').then(({ toDataURL }) => toDataURL(uri, {
      errorCorrectionLevel: 'Q',
      margin: 4,
      width: 320,
      color: { dark: '#111111', light: '#ffffff' },
    })).then((url) => {
      if (!cancelled && url.startsWith('data:image/')) setSrc(url);
    }).catch(() => {
      if (!cancelled) setSrc('');
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  if (!src) return <div className="h-80 w-80 animate-pulse rounded-2xl bg-white" />;

  return (
    <div className="rounded-2xl bg-white p-3">
      {/* Local data URL only. The pairing secret is not sent to a QR service or shown as text. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Wallet connection QR code" width={320} height={320} className="h-80 w-80" />
    </div>
  );
}
