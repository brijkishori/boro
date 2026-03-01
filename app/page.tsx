'use client';

import { useState, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import BorrowFlow from '@/components/BorrowFlow';
import RepayFlow from '@/components/RepayFlow';
import TipJar from '@/components/TipJar'; 
import { useAccount, useConnect } from 'wagmi'; 
import sdk from '@farcaster/frame-sdk'; 
import Link from 'next/link';

export default function Dashboard() {
  const { isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect(); 
  
  const [isSDKLoaded, setIsSDKLoaded] = useState(false);
  const [hideZeroBalances, setHideZeroBalances] = useState(true);
  
  const [activeTab, setActiveTab] = useState('borrow');
  // Removed WETH from defaults
  const [livePrices, setLivePrices] = useState({ cbBTC: 64000, cbETH: 3100 });

  const [marketPrices, setMarketPrices] = useState([
    { symbol: 'cbBTC', price: 'Loading...', change: '0.00%' },
    { symbol: 'cbETH', price: 'Loading...', change: '0.00%' },
    { symbol: 'USDC', price: '$1.00', change: '0.00%' },
  ]);

  useEffect(() => {
    const initFrame = async () => {
      try {
        const farcasterConnector = connectors.find((c) => c.id === 'farcaster');
        if (farcasterConnector && !isConnected) {
          connect({ connector: farcasterConnector });
        }
        setTimeout(() => { sdk.actions.ready(); }, 100);
      } catch (err) {
        console.warn("Farcaster SDK not detected or error initializing:", err);
        sdk.actions.ready(); 
      }
    };

    if (sdk && !isSDKLoaded) {
      initFrame();
      setIsSDKLoaded(true);
    }
  }, [isSDKLoaded, connectors, isConnected, connect]);

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        // Removed WETH from the Coingecko API URL
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=coinbase-wrapped-btc,coinbase-wrapped-staked-eth&vs_currencies=usd&include_24hr_change=true');
        if (!res.ok) return;
        const data = await res.json();
        
        if (data && data['coinbase-wrapped-btc']) {
           setLivePrices({
             cbBTC: data['coinbase-wrapped-btc'].usd,
             cbETH: data['coinbase-wrapped-staked-eth'].usd
           });

           setMarketPrices([
             { 
               symbol: 'cbBTC', 
               price: `$${data['coinbase-wrapped-btc'].usd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`, 
               change: `${data['coinbase-wrapped-btc'].usd_24h_change > 0 ? '+' : ''}${data['coinbase-wrapped-btc'].usd_24h_change.toFixed(2)}%` 
             },
             { 
               symbol: 'cbETH', 
               price: `$${data['coinbase-wrapped-staked-eth'].usd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`, 
               change: `${data['coinbase-wrapped-staked-eth'].usd_24h_change > 0 ? '+' : ''}${data['coinbase-wrapped-staked-eth'].usd_24h_change.toFixed(2)}%` 
             },
             { symbol: 'USDC', price: '$1.00', change: '0.00%' },
           ]);
        }
      } catch (error) {
        // Silenced fallback
      }
    };

    fetchPrices();
    const interval = setInterval(fetchPrices, 30000); 
    return () => clearInterval(interval);
  }, []);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center mt-32 space-y-6">
        {isPending ? (
          <div className="flex flex-col items-center space-y-4">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <h2 className="text-xl font-semibold animate-pulse text-muted-foreground">Connecting to Wallet...</h2>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-4 text-center">
            <h2 className="text-2xl font-semibold">Welcome to SimpleBTC Borrow</h2>
            <p className="text-muted-foreground max-w-md">
              Please connect your wallet using the button in the top navigation bar to view live markets.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8 px-4 sm:px-0">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {marketPrices.map((asset) => (
          <Card key={asset.symbol} className="bg-muted/30 dark:bg-muted/10">
            <CardContent className="p-4 flex flex-col justify-center">
              <span className="text-sm text-muted-foreground font-medium">{asset.symbol}</span>
              <div className="flex justify-between items-baseline mt-1">
                <span className="text-xl font-bold">{asset.price}</span>
                <span className={`text-xs font-semibold ${asset.change.startsWith('+') ? 'text-green-500' : asset.change === '0.00%' ? 'text-muted-foreground' : 'text-red-500'}`}>
                  {asset.change}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold">Manage Position</h1>
        <div className="flex items-center space-x-2">
          <Switch id="zero-balances" checked={hideZeroBalances} onCheckedChange={setHideZeroBalances} />
          <Label htmlFor="zero-balances" className="text-base">Hide zero balances</Label>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-8 h-12">
          <TabsTrigger value="borrow" className="text-base">Borrow</TabsTrigger>
          <TabsTrigger value="repay" className="text-base">Repay</TabsTrigger>
        </TabsList>
        
        <div className={activeTab === 'borrow' ? 'block' : 'hidden'}>
          <BorrowFlow hideZeroBalances={hideZeroBalances} livePrices={livePrices} />
        </div>
        
        <div className={activeTab === 'repay' ? 'block' : 'hidden'}>
          <RepayFlow />
        </div>
      </Tabs>

      {/* HOW IT WORKS SECTION */}
      <section id="how-it-works" className="mt-20 pt-10 border-t border-muted">
        <h2 className="text-2xl font-bold mb-8 text-center">
          How to Use Simple<span className="text-blue-500">BTC</span> Borrow
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="p-5 rounded-xl border bg-card text-card-foreground shadow-sm hover:shadow-md transition-shadow">
            <div className="h-8 w-8 bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center font-bold mb-4">1</div>
            <h3 className="font-semibold mb-2">Connect to Base</h3>
            <p className="text-sm text-muted-foreground">Connect your preferred wallet. The app will securely map to the Base network to ensure low gas fees.</p>
          </div>
          <div className="p-5 rounded-xl border bg-card text-card-foreground shadow-sm hover:shadow-md transition-shadow">
            <div className="h-8 w-8 bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center font-bold mb-4">2</div>
            <h3 className="font-semibold mb-2">Supply Collateral</h3>
            <p className="text-sm text-muted-foreground">Select a market and supply assets (like cbBTC or cbETH). Your collateral instantly begins earning a passive supply APY.</p>
          </div>
          <div className="p-5 rounded-xl border bg-card text-card-foreground shadow-sm hover:shadow-md transition-shadow">
            <div className="h-8 w-8 bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center font-bold mb-4">3</div>
            <h3 className="font-semibold mb-2">Borrow Assets</h3>
            <p className="text-sm text-muted-foreground">Switch to the Borrow tab to take out a USDC loan against your collateral. Always keep an eye on your Health Factor!</p>
          </div>
          <div className="p-5 rounded-xl border bg-card text-card-foreground shadow-sm hover:shadow-md transition-shadow">
            <div className="h-8 w-8 bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center font-bold mb-4">4</div>
            <h3 className="font-semibold mb-2">Repay & Withdraw</h3>
            <p className="text-sm text-muted-foreground">Clear your debt using the exact 100% Repay button, then withdraw your original collateral back to your wallet.</p>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="mt-16 pt-8 border-t border-muted pb-8 space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-center text-sm text-muted-foreground gap-6">
          <p className="font-semibold text-foreground">
            Simple<span className="text-blue-500">BTC</span> Borrow Portal
          </p>
          <div className="flex-1 flex justify-center w-full md:w-auto">
            <TipJar />
          </div>
          <Link href="/terms" className="hover:text-foreground transition-colors font-medium">
            Terms of Service
          </Link>
          <div className="flex space-x-6">
            <a href="https://morpho.org/" target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors font-medium">Powered by Morpho</a>
          </div>
        </div>
        <div className="p-4 bg-muted/30 dark:bg-muted/10 rounded-lg text-xs text-muted-foreground leading-relaxed">
          <p className="font-bold mb-1 text-foreground">Legal Disclaimer & Risk Warning</p>
          <p>
            This interface is a decentralized application (dApp) portal provided "as is" and is not a custodial wallet, exchange, or financial service. We do not hold, control, or have access to your funds, private keys, or the underlying Morpho Blue smart contracts. Interacting with decentralized finance (DeFi) protocols involves significant technical and financial risks, including but not limited to smart contract vulnerabilities, severe market volatility, and total loss of funds through liquidation. By connecting your wallet and executing transactions, you acknowledge that you are interacting directly with the Base blockchain at your own absolute risk.
          </p>
        </div>
        <p className="text-xs text-muted-foreground text-center">
          © {new Date().getFullYear()} Simple<span className="text-blue-500">BTC</span> Borrow. All rights reserved.
        </p>
      </footer>
    </div>
  );
}