'use client';

import { useState, useEffect } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function CustomConnectButton() {
  const [showTerms, setShowTerms] = useState(false);
  const [hasAgreed, setHasAgreed] = useState(false);
  
  // This holds the RainbowKit function so we can trigger it AFTER they accept
  const [pendingConnect, setPendingConnect] = useState<(() => void) | null>(null);
  
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleAccept = () => {
    localStorage.setItem('simplebtc_terms_accepted', 'true');
    setShowTerms(false);
    // Trigger the actual wallet connection popup!
    if (pendingConnect) pendingConnect(); 
  };

  const handleDecline = () => {
    setShowTerms(false);
  };

  return (
    <>
      <ConnectButton.Custom>
        {({
          account,
          chain,
          openAccountModal,
          openChainModal,
          openConnectModal,
          authenticationStatus,
          mounted: rkMounted,
        }) => {
          const ready = mounted && rkMounted && authenticationStatus !== 'loading';
          const connected =
            ready &&
            account &&
            chain &&
            (!authenticationStatus || authenticationStatus === 'authenticated');

          if (!ready) {
            return <Button variant="outline" disabled className="h-10">Loading...</Button>;
          }

          // DISCONNECTED STATE: Our Custom Button
          if (!connected) {
            return (
              <Button
                onClick={() => {
                  const accepted = localStorage.getItem('simplebtc_terms_accepted');
                  if (accepted) {
                    // If they already accepted in the past, just open the wallet
                    openConnectModal();
                  } else {
                    // If not, save the connect function and show the modal
                    setPendingConnect(() => openConnectModal);
                    setShowTerms(true);
                  }
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold h-10"
              >
                Connect Wallet
              </Button>
            );
          }

          // CONNECTED STATE: Standard RainbowKit Dropdowns
          return (
            <div className="flex items-center gap-3">
              <Button
                onClick={openChainModal}
                variant="outline"
                className="h-10 font-bold flex items-center gap-2"
              >
                {chain.hasIcon && (
                  <div className="w-5 h-5 rounded-full overflow-hidden bg-muted">
                    {chain.iconUrl && (
                      <img alt={chain.name ?? 'Chain icon'} src={chain.iconUrl} className="w-5 h-5" />
                    )}
                  </div>
                )}
                <span className="hidden sm:inline">{chain.name}</span>
              </Button>

              <Button onClick={openAccountModal} variant="outline" className="h-10 font-bold">
                {account.displayName}
              </Button>
            </div>
          );
        }}
      </ConnectButton.Custom>

      {/* THE INTERCEPTOR MODAL */}
      {showTerms && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <Card className="w-full max-w-lg shadow-2xl border-muted animate-in fade-in zoom-in-95 duration-200 dark:bg-zinc-950">
            <CardHeader className="border-b bg-muted/30 pb-4">
              <CardTitle className="text-2xl font-bold tracking-tight">
                Welcome to Simple<span className="text-blue-500">BTC</span> Borrow
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-4 text-sm text-muted-foreground">
              <p>
                Before you can connect your wallet, you must review and accept our Terms of Service.
              </p>
              
              <div className="bg-muted/40 p-4 rounded-md h-32 overflow-y-auto border border-border text-xs leading-relaxed space-y-2 text-foreground">
                <p><strong>1. Non-Custodial:</strong> This is a UI only. We do not hold or control your funds.</p>
                <p><strong>2. Assumption of Risk:</strong> You are strictly responsible for monitoring your Health Factor and managing liquidation risks.</p>
                <p><strong>3. Not Financial Advice:</strong> You are acting entirely at your own risk. This interface is not a registered financial institution.</p>
                <p>Please read the full Terms of Service for complete legal details.</p>
              </div>
              
              <div className="flex items-start space-x-3 pt-4">
                <input 
                  type="checkbox" 
                  id="terms-checkbox" 
                  className="w-5 h-5 mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  checked={hasAgreed}
                  onChange={(e) => setHasAgreed(e.target.checked)}
                />
                <label htmlFor="terms-checkbox" className="font-medium text-foreground cursor-pointer leading-tight">
                  I have read, understand, and explicitly agree to be bound by the <Link href="/terms" target="_blank" className="text-blue-500 hover:underline">Terms of Service</Link>.
                </label>
              </div>
            </CardContent>
            <CardFooter className="flex justify-end space-x-3 border-t bg-muted/10 pt-4">
              <Button variant="ghost" onClick={handleDecline}>Cancel</Button>
              <Button 
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold" 
                disabled={!hasAgreed} 
                onClick={handleAccept}
              >
                Accept & Connect
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </>
  );
}