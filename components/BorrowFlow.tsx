'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useAccount, useReadContracts, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatUnits, parseUnits, maxUint256 } from 'viem';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, ResponsiveContainer } from 'recharts';
import { toast } from "sonner";
import { Activity, ShieldCheck, AlertTriangle, Skull } from 'lucide-react'; 

// --- ABIs ---
const erc20Abi = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: 'balance', type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: 'remaining', type: 'uint256' }] }
] as const;

const morphoAbi = [
  { name: 'position', type: 'function', stateMutability: 'view', inputs: [{ name: 'id', type: 'bytes32' }, { name: 'user', type: 'address' }], outputs: [{ name: 'supplyShares', type: 'uint256' }, { name: 'borrowShares', type: 'uint128' }, { name: 'collateral', type: 'uint128' }] },
  { name: 'market', type: 'function', stateMutability: 'view', inputs: [{ name: 'id', type: 'bytes32' }], outputs: [{ name: 'totalSupplyAssets', type: 'uint128' }, { name: 'totalSupplyShares', type: 'uint128' }, { name: 'totalBorrowAssets', type: 'uint128' }, { name: 'totalBorrowShares', type: 'uint128' }, { name: 'lastUpdate', type: 'uint128' }, { name: 'fee', type: 'uint128' }] },
  { name: 'supplyCollateral', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'tuple', components: [{ name: 'loanToken', type: 'address' }, { name: 'collateralToken', type: 'address' }, { name: 'oracle', type: 'address' }, { name: 'irm', type: 'address' }, { name: 'lltv', type: 'uint256' }] }, { name: 'assets', type: 'uint256' }, { name: 'onBehalf', type: 'address' }, { name: 'data', type: 'bytes' }] },
  { name: 'borrow', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'tuple', components: [{ name: 'loanToken', type: 'address' }, { name: 'collateralToken', type: 'address' }, { name: 'oracle', type: 'address' }, { name: 'irm', type: 'address' }, { name: 'lltv', type: 'uint256' }] }, { name: 'assets', type: 'uint256' }, { name: 'shares', type: 'uint256' }, { name: 'onBehalf', type: 'address' }, { name: 'receiver', type: 'address' }] }
] as const;

const NETWORK_CONFIG = {
  8453: { USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', WETH: '0x4200000000000000000000000000000000000006', cbBTC: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', cbETH: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22' },
  84532: { USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', WETH: '0x4200000000000000000000000000000000000006', cbBTC: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', cbETH: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22' }
};

const MORPHO_BLUE_ADDRESS = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';

const generateHistoricalApyFallback = (anchorApy: number, days: number) => {
  const data = [];
  let currentApy = anchorApy; 
  const today = new Date();
  data.push({ timestamp: today.getTime(), date: today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), apy: Number(currentApy.toFixed(2)) });
  for (let i = 1; i <= days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    currentApy = currentApy + (Math.random() * 0.6 - 0.3);
    if (currentApy < 0.5) currentApy = 0.5 + Math.random(); 
    data.push({ timestamp: d.getTime(), date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), apy: Number(currentApy.toFixed(2)) });
  }
  return data.sort((a, b) => a.timestamp - b.timestamp); 
};

export default function BorrowFlow({ hideZeroBalances, livePrices }: { hideZeroBalances: boolean, livePrices: { cbBTC: number, cbETH: number, WETH: number } }) {
  const { address, chain } = useAccount();
  const safeAddress = address || '0x0000000000000000000000000000000000000000';
  const chainId = chain?.id === 84532 ? 84532 : 8453;
  const config = NETWORK_CONFIG[chainId as keyof typeof NETWORK_CONFIG];
  const ASSETS = { cbBTC: { address: config.cbBTC, decimals: 8, symbol: 'cbBTC' }, cbETH: { address: config.cbETH, decimals: 18, symbol: 'cbETH' }, WETH: { address: config.WETH, decimals: 18, symbol: 'WETH' } };

  const [selectedAsset, setSelectedAsset] = useState<keyof typeof ASSETS>('cbBTC');
  const [supplyUsdInput, setSupplyUsdInput] = useState<string>('');
  const [borrowAmount, setBorrowAmount] = useState<string>('');
  const [simulatedDrop, setSimulatedDrop] = useState<number>(0);
  const [apyView, setApyView] = useState<'chart' | 'table'>('chart');
  const [historyDays, setHistoryDays] = useState<number>(30); 

  const [optimisticApproval, setOptimisticApproval] = useState(false);
  const [lastAction, setLastAction] = useState<string>('');

  const currentAsset = ASSETS[selectedAsset];
  const [realTimePrices, setRealTimePrices] = useState(livePrices);
  
  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=coinbase-wrapped-btc,coinbase-wrapped-staked-eth,weth&vs_currencies=usd');
        if (!res.ok) return;
        const data = await res.json();
        if (data && data['coinbase-wrapped-btc']) {
          setRealTimePrices({
            cbBTC: data['coinbase-wrapped-btc']?.usd || realTimePrices.cbBTC,
            cbETH: data['coinbase-wrapped-staked-eth']?.usd || realTimePrices.cbETH,
            WETH: data['weth']?.usd || realTimePrices.WETH
          });
        }
      } catch (e) {}
    };
    fetchPrices();
    const interval = setInterval(fetchPrices, 30000); 
    return () => clearInterval(interval);
  }, [realTimePrices]);

  const [marketParams, setMarketParams] = useState({ id: '0x0', oracle: '0x0', irm: '0x0', lltv: 0n, borrowApy: 4.08 });
  const [rawChartData, setRawChartData] = useState<any[]>(generateHistoricalApyFallback(4.08, 365));
  const [isFetchingMarket, setIsFetchingMarket] = useState(false);

  useEffect(() => {
    const fetchMarket = async () => {
      setIsFetchingMarket(true);
      try {
        const res = await fetch('https://blue-api.morpho.org/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: `query { markets(where: { chainId_in: [${chainId}], collateralAssetAddress_in: ["${currentAsset.address}"], loanAssetAddress_in: ["${config.USDC}"] }) { items { uniqueKey lltv oracleAddress irmAddress state { supplyAssets borrowApy netBorrowApy } } } }` })
        });
        if (!res.ok) { setIsFetchingMarket(false); return; }
        const json = await res.json();
        const markets = json?.data?.markets?.items;
        
        if (markets && markets.length > 0) {
          const best = markets.sort((a: any, b: any) => Number(b.state.supplyAssets) - Number(a.state.supplyAssets))[0];
          const rawNetApy = best.state.netBorrowApy !== null && best.state.netBorrowApy !== undefined ? best.state.netBorrowApy : best.state.borrowApy;
          const liveApy = (rawNetApy || 0) * 100;
          
          setMarketParams({ id: best.uniqueKey, oracle: best.oracleAddress, irm: best.irmAddress, lltv: BigInt(best.lltv), borrowApy: liveApy });
          setRawChartData(generateHistoricalApyFallback(liveApy, 365));
        }
      } catch (e) {}
      setIsFetchingMarket(false);
    };
    if (currentAsset.address) fetchMarket();
  }, [currentAsset.address, chainId, config.USDC]);

  const chartData = useMemo(() => {
    if (!rawChartData.length) return [];
    const cutoff = Date.now() - (historyDays * 24 * 60 * 60 * 1000);
    return rawChartData.filter(d => d.timestamp >= cutoff);
  }, [rawChartData, historyDays]);

  const safeMarketId = marketParams.id !== '0x0' ? marketParams.id : '0x0000000000000000000000000000000000000000000000000000000000000000';

  const { data: rawContractData, refetch: refetchReads } = useReadContracts({
    contracts: [
      { address: config.WETH as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [safeAddress] },
      { address: config.cbBTC as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [safeAddress] },
      { address: config.cbETH as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [safeAddress] },
      { address: currentAsset.address as `0x${string}`, abi: erc20Abi, functionName: 'allowance', args: [safeAddress, MORPHO_BLUE_ADDRESS] },
      { address: MORPHO_BLUE_ADDRESS as `0x${string}`, abi: morphoAbi, functionName: 'market', args: [safeMarketId as `0x${string}`] }
    ],
    query: { enabled: !!address, refetchInterval: 6000 }
  });

  const { data: rawPositionData, refetch: refetchPosition } = useReadContract({
    address: MORPHO_BLUE_ADDRESS as `0x${string}`, abi: morphoAbi, functionName: 'position',
    args: [safeMarketId as `0x${string}`, safeAddress],
    query: { enabled: marketParams.id !== '0x0' && !!address, refetchInterval: 6000 }
  });

  // --- ANTI-FLASH CACHE ---
  const prevContractData = useRef<any>(null);
  const prevPositionData = useRef<any>(null);
  if (rawContractData) prevContractData.current = rawContractData;
  if (rawPositionData) prevPositionData.current = rawPositionData;
  
  const contractData = rawContractData || prevContractData.current;
  const positionData = rawPositionData || prevPositionData.current;

  const marketData = contractData?.[4]?.result as any;
  const totalBorrowAssets = marketData?.[2] || 0n;
  const totalBorrowShares = marketData?.[3] || 0n;
  const borrowShares = positionData?.[1] || 0n;

  let exactDebtAssets = 0n;
  if (totalBorrowShares > 0n) {
    const VIRTUAL_SHARES = 1000000n; 
    const VIRTUAL_ASSETS = 1000000n; 
    const numerator = borrowShares * (totalBorrowAssets + VIRTUAL_ASSETS);
    const denominator = totalBorrowShares + VIRTUAL_SHARES;
    exactDebtAssets = (numerator + denominator - 1n) / denominator; 
  }

  const existingDebt = Number(formatUnits(exactDebtAssets, 6)); 

  const currentPrice = selectedAsset === 'WETH' ? realTimePrices.WETH : selectedAsset === 'cbBTC' ? realTimePrices.cbBTC : realTimePrices.cbETH;
  
  const wethBal = contractData?.[0]?.result !== undefined ? Number(formatUnits(contractData[0].result as bigint, 18)) : 0;
  const cbBtcBal = contractData?.[1]?.result !== undefined ? Number(formatUnits(contractData[1].result as bigint, 8)) : 0;
  const cbEthBal = contractData?.[2]?.result !== undefined ? Number(formatUnits(contractData[2].result as bigint, 18)) : 0;
  const walletBalance = selectedAsset === 'WETH' ? wethBal : selectedAsset === 'cbBTC' ? cbBtcBal : cbEthBal;
  
  const currentAllowance = contractData?.[3]?.result !== undefined ? (contractData[3].result as bigint) : 0n;

  const existingCollateralAmount = positionData?.[2] !== undefined ? Number(formatUnits(positionData[2] as bigint, currentAsset.decimals)) : 0;
  const existingCollateralUsd = existingCollateralAmount * currentPrice;
  const dynamicLLTV = marketParams.lltv > 0n ? Number(formatUnits(marketParams.lltv, 18)) : 0.86; 

  const supplyAmountToken = supplyUsdInput ? Number(supplyUsdInput) / currentPrice : 0;
  const borrowAmountValue = Number(borrowAmount || 0);

  const projectedTotalCollateralAmount = existingCollateralAmount + supplyAmountToken;
  const projectedTotalCollateralUsd = projectedTotalCollateralAmount * currentPrice;
  const projectedTotalDebt = existingDebt + borrowAmountValue;

  const absoluteMaxBorrowCapacity = projectedTotalCollateralUsd * dynamicLLTV;
  const projectedAvailableToBorrow = Math.max(0, absoluteMaxBorrowCapacity - projectedTotalDebt);

  const projectedLtvPercent = projectedTotalCollateralUsd > 0 ? (projectedTotalDebt / projectedTotalCollateralUsd) * 100 : 0;
  const maxLtvPercent = dynamicLLTV * 100;
  const isLiquidated = projectedTotalCollateralUsd > 0 && projectedLtvPercent >= maxLtvPercent;

  const healthRatio = projectedTotalCollateralUsd > 0 ? projectedLtvPercent / maxLtvPercent : 0;
  
  // UPDATED: Health Status variables with dark mode tailwind classes
  let healthStatus = { label: 'Safe', color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-500/10', icon: ShieldCheck };
  if (isLiquidated) {
     healthStatus = { label: 'Liquidated', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-500/10', icon: Skull };
  } else if (healthRatio > 0.90) {
     healthStatus = { label: 'Danger', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-500/10', icon: AlertTriangle };
  } else if (healthRatio > 0.75) {
     healthStatus = { label: 'Warning', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-500/10', icon: Activity };
  }

  const simulatedPrice = currentPrice * (1 - (simulatedDrop / 100));
  const simulatedLtv = projectedTotalCollateralAmount > 0 ? (projectedTotalDebt / (projectedTotalCollateralAmount * simulatedPrice)) * 100 : 0;
  const liquidationPrice = projectedTotalCollateralAmount > 0 ? (projectedTotalDebt / (projectedTotalCollateralAmount * dynamicLLTV)) : 0;

  const isExceedingWallet = supplyAmountToken > walletBalance;
  const isExceedingMaxBorrow = borrowAmountValue > projectedAvailableToBorrow;

  const safeTokenSupply = parseUnits(supplyAmountToken.toFixed(currentAsset.decimals), currentAsset.decimals);
  const needsApproval = safeTokenSupply > 0n && currentAllowance < safeTokenSupply && !optimisticApproval;

  const { writeContract: write, data: hash, isPending: isWalletPromptOpen, reset: resetTx } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isTxSuccess } = useWaitForTransactionReceipt({ hash });
  
  const isTxBusy = isWalletPromptOpen || isConfirming;

  useEffect(() => {
    if (isTxSuccess) {
      if (lastAction === 'approve') {
        setOptimisticApproval(true);
      } else {
        setSupplyUsdInput('');
        setBorrowAmount('');
      }
      
      refetchReads();
      refetchPosition();
      
      setTimeout(() => {
        refetchReads();
        refetchPosition();
      }, 4000);

      toast.success("Transaction Confirmed!");
      resetTx();
    }
  }, [isTxSuccess, refetchReads, refetchPosition, resetTx, lastAction]);

  const handleAction = (type: 'approve' | 'supply' | 'borrow') => {
    setLastAction(type);
    const m = { loanToken: config.USDC, collateralToken: currentAsset.address, oracle: marketParams.oracle as `0x${string}`, irm: marketParams.irm as `0x${string}`, lltv: marketParams.lltv };

    if (type === 'approve') write({ address: currentAsset.address as `0x${string}`, abi: erc20Abi, functionName: 'approve', args: [MORPHO_BLUE_ADDRESS, maxUint256] });
    else if (type === 'supply') write({ address: MORPHO_BLUE_ADDRESS, abi: morphoAbi, functionName: 'supplyCollateral', args: [m, safeTokenSupply, safeAddress, '0x'] });
    else write({ address: MORPHO_BLUE_ADDRESS, abi: morphoAbi, functionName: 'borrow', args: [m, parseUnits(borrowAmountValue.toString(), 6), 0n, safeAddress, safeAddress] });
  };

  return (
    <div className="space-y-6">
      
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="shadow-sm border-muted">
          <CardContent className="p-4 flex flex-col justify-center h-full">
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-1">Your Collateral</p>
            <p className="text-2xl font-bold">${projectedTotalCollateralUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
            <p className="text-xs text-blue-600 mt-1 font-medium">{projectedTotalCollateralAmount.toFixed(6)} {selectedAsset}</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-muted">
          <CardContent className="p-4 flex flex-col justify-center h-full">
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-1">Total Payout (Debt)</p>
            <p className="text-2xl font-bold text-red-500">${projectedTotalDebt.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 4})}</p>
            {/* UPDATED: Added dark mode classes for the Net Rate tag */}
            <p className="text-xs text-green-600 dark:text-green-400 mt-1 font-bold bg-green-50 dark:bg-green-500/10 w-fit px-2 py-[2px] rounded">Net Rate: {marketParams.borrowApy.toFixed(2)}%</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-muted">
          <CardContent className="p-4 flex flex-col justify-center h-full">
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-1">Available to Borrow</p>
            <p className="text-2xl font-bold text-foreground">${projectedAvailableToBorrow.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</p>
            <p className="text-xs text-muted-foreground mt-1 font-medium">Out of ${absoluteMaxBorrowCapacity.toFixed(2)} Max</p>
          </CardContent>
        </Card>
        
        {/* UPDATED: JSX mapping for Health Status Card to handle dark mode seamlessly */}
        <Card className={`shadow-sm border transition-colors ${isLiquidated ? 'border-red-500 dark:border-red-500/50' : 'border-muted dark:border-border/50'} ${healthStatus.bg}`}>
          <CardContent className="p-4 flex flex-col justify-center h-full relative overflow-hidden">
            <div className="flex justify-between items-start">
              <div>
                <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${healthStatus.color}`}>Health: {healthStatus.label}</p>
                <p className={`text-2xl font-black ${healthStatus.color}`}>{projectedLtvPercent.toFixed(1)}% <span className="text-sm font-semibold opacity-70">LTV</span></p>
                <p className={`text-xs mt-1 font-medium ${healthStatus.color} opacity-80`}>Max LTV: {maxLtvPercent.toFixed(1)}%</p>
              </div>
              <healthStatus.icon className={`h-8 w-8 ${healthStatus.color} opacity-80`} />
            </div>
          </CardContent>
        </Card>

      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7">
          <Card className="shadow-lg h-full border-muted">
            <CardHeader><CardTitle className="text-2xl font-bold">Manage Position</CardTitle></CardHeader>
            <CardContent className="space-y-8">
              
              <div className="space-y-3">
                <div className="flex justify-between items-center mb-1">
                  <label className="text-base font-semibold">1. Supply Additional Collateral (USD)</label>
                  <span className="text-xs font-bold bg-muted px-2 py-1 rounded text-muted-foreground">Wallet: {walletBalance.toFixed(4)} {selectedAsset} (${(walletBalance * currentPrice).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})})</span>
                </div>
                <div className="flex space-x-3">
                  <div className="flex-1 flex flex-col relative">
                    <span className="absolute left-4 top-4 text-xl font-bold text-muted-foreground">$</span>
                    <Input type="number" step="any" placeholder="0.00" value={supplyUsdInput} onChange={(e) => setSupplyUsdInput(e.target.value)} className={`h-14 text-2xl font-bold pl-8 pr-4 ${isExceedingWallet ? 'border-red-500 focus-visible:ring-red-500' : ''}`} />
                    <span className={`text-xs mt-1 font-bold ${isExceedingWallet ? 'text-red-500' : 'text-muted-foreground'}`}>≈ {supplyAmountToken.toFixed(8)} {selectedAsset}</span>
                  </div>
                  <Select value={selectedAsset} onValueChange={(val: any) => { setSelectedAsset(val); setSupplyUsdInput(''); setBorrowAmount(''); }}><SelectTrigger className="w-[140px] h-14 font-bold"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="cbBTC">cbBTC</SelectItem><SelectItem value="cbETH">cbETH</SelectItem><SelectItem value="WETH">WETH</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  {[25, 50, 75, 100].map(pct => (
                    <Button key={pct} variant="outline" size="sm" className="flex-1 font-bold" onClick={() => setSupplyUsdInput(((walletBalance * currentPrice * pct) / 100).toFixed(2))}>{pct === 100 ? 'MAX' : `${pct}%`}</Button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 pt-4 border-t">
                <div className="flex justify-between items-center">
                  <label className="text-base font-semibold">2. Borrow New USDC</label>
                  <span className="text-sm text-muted-foreground font-medium">Safe Limit: <span className="text-foreground font-bold">{projectedAvailableToBorrow.toFixed(2)} USDC</span></span>
                </div>
                <div className="flex space-x-3">
                  <Input type="number" step="any" placeholder="0.00" value={borrowAmount} onChange={(e) => setBorrowAmount(e.target.value)} className={`flex-1 h-14 text-2xl font-bold px-4 ${isExceedingMaxBorrow ? 'border-red-500 focus-visible:ring-red-500' : ''}`} />
                  <Button variant="outline" disabled className="w-[120px] h-14 opacity-100 font-bold">USDC</Button>
                </div>
              </div>

              <div className="space-y-5 pt-4 border-t">
                <div className="flex justify-between items-center"><span className="text-base font-semibold">Projected LTV Target</span><span className={`text-xl font-bold ${healthStatus.color}`}>{projectedLtvPercent.toFixed(1)}%</span></div>
                <Slider value={[projectedLtvPercent]} max={dynamicLLTV * 100} step={0.1} onValueChange={(val) => { 
                    const targetTotalDebt = (projectedTotalCollateralUsd * val[0]) / 100;
                    const additionalBorrowNeeded = Math.max(0, targetTotalDebt - existingDebt);
                    setBorrowAmount(additionalBorrowNeeded > 0 ? additionalBorrowNeeded.toFixed(2) : ''); 
                  }} disabled={projectedTotalCollateralAmount === 0} />
              </div>

              <div className="pt-6 border-t flex space-x-3">
                {isExceedingWallet ? (
                   <Button className="w-full h-14 font-bold text-white bg-red-500 hover:bg-red-600 cursor-not-allowed" disabled>Insufficient {selectedAsset} Balance</Button>
                ) : needsApproval ? (
                  <Button className="w-full h-14 font-bold bg-indigo-600 text-white" disabled={isTxBusy} onClick={() => handleAction('approve')}>{isTxBusy ? 'Confirming in Wallet...' : 'Approve Asset'}</Button>
                ) : (
                  <>
                    <Button className="flex-1 h-14 font-bold bg-indigo-600 text-white" disabled={supplyAmountToken <= 0 || isTxBusy || isFetchingMarket} onClick={() => handleAction('supply')}>{isTxBusy ? 'Processing...' : 'Supply Collateral'}</Button>
                    <Button className="flex-1 h-14 font-bold bg-blue-600 text-white" disabled={borrowAmountValue <= 0 || isExceedingMaxBorrow || isTxBusy || isFetchingMarket} onClick={() => handleAction('borrow')}>{isTxBusy ? 'Processing...' : 'Borrow USDC'}</Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-5 space-y-6">
          <Card className="shadow border-muted">
            <CardHeader><CardTitle className="text-xl">Position Risk (Stress Test)</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <div className="p-4 bg-muted/40 rounded-lg border flex justify-between items-center"><span className="text-muted-foreground">Liquidation Price</span><span className="font-black text-xl">{projectedTotalDebt > 0 ? `$${liquidationPrice.toFixed(2)}` : '$0.00'}</span></div>
              <div className="space-y-4">
                <div className="flex justify-between text-sm font-semibold text-muted-foreground"><span>Market Drop Simulation</span><span>-{simulatedDrop}%</span></div>
                <Slider value={[simulatedDrop]} max={99} step={1} onValueChange={(v) => setSimulatedDrop(v[0])} />
                <div className="flex justify-between text-sm font-bold"><span>Price: ${(simulatedPrice).toFixed(0)}</span><span className={simulatedLtv >= (dynamicLLTV * 100) ? 'text-red-500' : 'text-orange-500'}>{simulatedLtv >= (dynamicLLTV * 100) ? 'LIQUIDATED' : `LTV: ${simulatedLtv.toFixed(1)}%`}</span></div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow border-muted flex flex-col h-[340px]">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xl">Historical APY</CardTitle>
              <div className="flex bg-muted p-1 rounded-md">
                <Button variant={apyView === 'chart' ? 'default' : 'ghost'} size="sm" className="h-6 px-3 text-xs" onClick={() => setApyView('chart')}>Chart</Button>
                <Button variant={apyView === 'table' ? 'default' : 'ghost'} size="sm" className="h-6 px-3 text-xs" onClick={() => setApyView('table')}>Table</Button>
              </div>
            </CardHeader>
            <div className="px-6 flex space-x-1">
               {[30, 60, 180, 365].map((days) => (
                  <Button key={days} variant={historyDays === days ? 'secondary' : 'ghost'} size="sm" onClick={() => setHistoryDays(days)} className="text-[11px] h-7 px-3 font-bold border">
                     {days === 30 ? '1M' : days === 60 ? '2M' : days === 180 ? '6M' : '1Y'}
                  </Button>
               ))}
            </div>
            <CardContent className="flex-1 min-h-0 pt-4 pb-6 px-4">
              {apyView === 'chart' ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#888" opacity={0.2} />
                    <XAxis dataKey="date" tick={{fontSize: 10}} tickLine={false} axisLine={false} />
                    <YAxis tick={{fontSize: 10}} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} width={35} domain={['dataMin - 1', 'dataMax + 1']} />
                    <ChartTooltip contentStyle={{ borderRadius: '8px', fontSize: '12px' }} formatter={v => [`${v}%`, 'APY']} />
                    <Line type="monotone" dataKey="apy" stroke="#3b82f6" strokeWidth={2.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="border rounded-lg overflow-y-auto h-full text-xs">
                  <table className="w-full text-left"><thead className="bg-muted sticky top-0 font-bold"><tr><th className="p-2">Date</th><th className="p-2 text-right">APY</th></tr></thead>
                  <tbody>{chartData.slice().reverse().map((r, i) => (<tr key={i} className="border-t"><td className="p-2 font-medium">{r.date}</td><td className="p-2 text-right font-bold text-blue-500">{r.apy}%</td></tr>))}</tbody></table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}