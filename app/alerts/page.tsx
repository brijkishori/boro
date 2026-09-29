'use client';

import AlertSettings from '@/components/AlertSettings';
import { useLoanBook } from '@/components/useLoanBook';

export default function AlertsPage() {
  const book = useLoanBook();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Alerts</h1>
        <p className="text-sm text-muted-foreground">Choose which loan warnings to email. Enabling an alert does not send a transaction.</p>
      </div>
      {!book.isConnected && <p className="text-sm">Connect a wallet to manage alerts.</p>}
      <AlertSettings loans={book.active} />
    </div>
  );
}
