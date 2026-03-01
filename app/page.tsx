'use client';

import { useState, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import BorrowFlow from '@/components/BorrowFlow';
import RepayFlow from '@/components/RepayFlow';
import TipJar from '@/components/TipJar'; 
import { useAccount, useConnect } from 'wagmi'; 
import sdk from '@farcaster/frame-sdk'; 

export default function Dashboard() {
  const { isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect(); 
  
  const [isSDKLoaded, setIsSDKLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState('borrow');
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
        if (farcasterConnector && !isConnected) connect({ connector: farcasterConnector });
        setTimeout(() => { sdk.actions.ready(); }, 100);
      } catch (err) {
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
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=coinbase-wrapped-btc,coinbase-wrapped-staked-eth&vs_currencies=usd&include_24hr_change=true');
        if (!res.ok) return;
        const data = await res.json();
        
        if (data && data['coinbase-wrapped-btc']) {
           setLivePrices({ cbBTC: data['coinbase-wrapped-btc'].usd, cbETH: data['coinbase-wrapped-staked-eth'].usd });
           setMarketPrices([
             { symbol: 'cbBTC', price: `$${data['coinbase-wrapped-btc'].usd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`, change: `${data['coinbase-wrapped-btc'].usd_24h_change > 0 ? '+' : ''}${data['coinbase-wrapped-btc'].usd_24h_change.toFixed(2)}%` },
             { symbol: 'cbETH', price: `$${data['coinbase-wrapped-staked-eth'].usd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`, change: `${data['coinbase-wrapped-staked-eth'].usd_24h_change > 0 ? '+' : ''}${data['coinbase-wrapped-staked-eth'].usd_24h_change.toFixed(2)}%` },
             { symbol: 'USDC', price: '$1.00', change: '0.00%' },
           ]);
        }
      } catch (error) {}
    };
    fetchPrices();
    const interval = setInterval(fetchPrices, 30000); 
    return () => clearInterval(interval);
  }, []);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center mt-20 space-y-6 px-4">
        {isPending ? (
          <div className="flex flex-col items-center space-y-4">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <h2 className="text-xl font-semibold animate-pulse text-muted-foreground">Connecting...</h2>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-4 text-center">
            <h2 className="text-xl font-semibold">Welcome to SimpleBTC</h2>
            <p className="text-sm text-muted-foreground">Please connect your wallet above.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Mobile Horizontal Ticker for Prices */}
      <div className="flex overflow-x-auto gap-3 pb-2 snap-x hide-scrollbar">
        {marketPrices.map((asset) => (
          <Card key={asset.symbol} className="min-w-[140px] snap-center shrink-0 bg-muted/30 dark:bg-muted/10">
            <CardContent className="p-3">
              <span className="text-xs text-muted-foreground font-medium">{asset.symbol}</span>
              <div className="flex justify-between items-baseline mt-1">
                <span className="text-base font-bold">{asset.price}</span>
                <span className={`text-[10px] font-semibold ml-2 ${asset.change.startsWith('+') ? 'text-green-500' : asset.change === '0.00%' ? 'text-muted-foreground' : 'text-red-500'}`}>
                  {asset.change}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-4 h-12">
          <TabsTrigger value="borrow" className="text-sm font-bold">Borrow</TabsTrigger>
          <TabsTrigger value="repay" className="text-sm font-bold">Repay</TabsTrigger>
        </TabsList>
        
        <div className={activeTab === 'borrow' ? 'block' : 'hidden'}>
          <BorrowFlow hideZeroBalances={true} livePrices={livePrices} />
        </div>
        
        <div className={activeTab === 'repay' ? 'block' : 'hidden'}>
          <RepayFlow />
        </div>
      </Tabs>

      {/* Tightly Compacted Footer */}
      <footer className="mt-8 pt-6 border-t border-muted pb-4 flex flex-col items-center space-y-4">
        <TipJar />
        <p className="text-[10px] text-muted-foreground text-center px-4">
          DeFi involves risk. Not financial advice.<br/>
          © {new Date().getFullYear()} SimpleBTC.
        </p>
      </footer>
    </div>
  );
}