'use client';

import { useState, useEffect, useRef } from 'react';
import { useAccount, useReadContracts, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQueryClient } from '@tanstack/react-query'; 
import { formatUnits, parseUnits, maxUint256 } from 'viem';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ChevronDown, ChevronUp } from 'lucide-react';

const erc20Abi = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: 'balance', type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: 'remaining', type: 'uint256' }] }
] as const;

const morphoAbi = [
  { name: 'position', type: 'function', stateMutability: 'view', inputs: [{ name: 'id', type: 'bytes32' }, { name: 'user', type: 'address' }], outputs: [{ name: 'supplyShares', type: 'uint256' }, { name: 'borrowShares', type: 'uint128' }, { name: 'collateral', type: 'uint128' }] },
  { name: 'market', type: 'function', stateMutability: 'view', inputs: [{ name: 'id', type: 'bytes32' }], outputs: [{ name: 'totalSupplyAssets', type: 'uint128' }, { name: 'totalSupplyShares', type: 'uint128' }, { name: 'totalBorrowAssets', type: 'uint128' }, { name: 'totalBorrowShares', type: 'uint128' }, { name: 'lastUpdate', type: 'uint128' }, { name: 'fee', type: 'uint128' }] },
  { name: 'repay', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'tuple', components: [{ name: 'loanToken', type: 'address' }, { name: 'collateralToken', type: 'address' }, { name: 'oracle', type: 'address' }, { name: 'irm', type: 'address' }, { name: 'lltv', type: 'uint256' }] }, { name: 'assets', type: 'uint256' }, { name: 'shares', type: 'uint256' }, { name: 'onBehalf', type: 'address' }, { name: 'data', type: 'bytes' }] },
  { name: 'withdrawCollateral', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'tuple', components: [{ name: 'loanToken', type: 'address' }, { name: 'collateralToken', type: 'address' }, { name: 'oracle', type: 'address' }, { name: 'irm', type: 'address' }, { name: 'lltv', type: 'uint256' }] }, { name: 'assets', type: 'uint256' }, { name: 'onBehalf', type: 'address' }, { name: 'receiver', type: 'address' }] }
] as const;

const NETWORK_CONFIG = {
  8453: { USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', cbBTC: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', cbETH: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22' },
  84532: { USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', cbBTC: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', cbETH: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22' }
};

const MORPHO_BLUE_ADDRESS = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';

const safeParseUnits = (value: string, decimals: number) => {
  try { return parseUnits(value || '0', decimals); } catch { return 0n; }
};

export default function RepayFlow() {
  const { address, chain } = useAccount();
  const queryClient = useQueryClient(); 
  const safeAddress = address || '0x0000000000000000000000000000000000000000';
  const chainId = chain?.id === 84532 ? 84532 : 8453;
  const config = NETWORK_CONFIG[chainId as keyof typeof NETWORK_CONFIG];

  const ASSETS = { cbBTC: { address: config.cbBTC, decimals: 8, symbol: 'cbBTC' }, cbETH: { address: config.cbETH, decimals: 18, symbol: 'cbETH' } };
  const [selectedAsset, setSelectedAsset] = useState<keyof typeof ASSETS>('cbBTC');
  
  const [repayAmount, setRepayAmount] = useState<string>('');
  const [withdrawAmount, setWithdrawAmount] = useState<string>('');
  
  const [isMaxRepay, setIsMaxRepay] = useState(false);
  const [isMaxWithdraw, setIsMaxWithdraw] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  const [optimisticZeroDebt, setOptimisticZeroDebt] = useState(false);
  const [optimisticApproval, setOptimisticApproval] = useState(false);
  const [lastAction, setLastAction] = useState<string>('');

  const currentAsset = ASSETS[selectedAsset];

  const [realTimePrices, setRealTimePrices] = useState({ cbBTC: 64000, cbETH: 3100 });
  
  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=coinbase-wrapped-btc,coinbase-wrapped-staked-eth&vs_currencies=usd');
        if (!res.ok) return;
        const data = await res.json();
        if (data && data['coinbase-wrapped-btc']) {
          setRealTimePrices({
            cbBTC: data['coinbase-wrapped-btc']?.usd || realTimePrices.cbBTC,
            cbETH: data['coinbase-wrapped-staked-eth']?.usd || realTimePrices.cbETH
          });
        }
      } catch (e) {}
    };
    fetchPrices();
    const interval = setInterval(fetchPrices, 30000); 
    return () => clearInterval(interval);
  }, [realTimePrices]);

  const currentPrice = selectedAsset === 'cbBTC' ? realTimePrices.cbBTC : realTimePrices.cbETH;

  const [marketParams, setMarketParams] = useState({ id: '0x0', oracle: '0x0', irm: '0x0', lltv: 0n });
  const [isFetchingMarket, setIsFetchingMarket] = useState(false);

  useEffect(() => {
    const fetchMarket = async () => {
      setIsFetchingMarket(true);
      try {
        const res = await fetch('https://blue-api.morpho.org/graphql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: `query { markets(where: { chainId_in: [${chainId}], collateralAssetAddress_in: ["${currentAsset.address}"], loanAssetAddress_in: ["${config.USDC}"] }) { items { uniqueKey lltv oracleAddress irmAddress state { supplyAssets } } } }` })
        });
        if (!res.ok) { setIsFetchingMarket(false); return; }
        const json = await res.json();
        const markets = json?.data?.markets?.items;
        
        if (markets && markets.length > 0) {
          const best = markets.sort((a: any, b: any) => Number(b.state.supplyAssets) - Number(a.state.supplyAssets))[0];
          setMarketParams({ id: best.uniqueKey, oracle: best.oracleAddress, irm: best.irmAddress, lltv: BigInt(best.lltv) });
        }
      } catch (e) {}
      setIsFetchingMarket(false);
    };
    if (currentAsset.address) fetchMarket();
  }, [currentAsset.address, chainId, config.USDC]);

  const safeMarketId = marketParams.id !== '0x0' ? marketParams.id : '0x0000000000000000000000000000000000000000000000000000000000000000';

  const { data: rawContractData, refetch: refetchReads } = useReadContracts({
    contracts: [
      { address: config.USDC as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [safeAddress] },
      { address: config.USDC as `0x${string}`, abi: erc20Abi, functionName: 'allowance', args: [safeAddress, MORPHO_BLUE_ADDRESS] },
      { address: MORPHO_BLUE_ADDRESS as `0x${string}`, abi: morphoAbi, functionName: 'market', args: [safeMarketId as `0x${string}`] }
    ],
    query: { enabled: !!address, refetchInterval: 6000 }
  });

  const { data: rawPositionData, refetch: refetchPosition } = useReadContract({
    address: MORPHO_BLUE_ADDRESS as `0x${string}`, abi: morphoAbi, functionName: 'position',
    args: [safeMarketId as `0x${string}`, safeAddress],
    query: { enabled: marketParams.id !== '0x0' && !!address, refetchInterval: 6000 }
  });

  const prevContractData = useRef<any>(null);
  const prevPositionData = useRef<any>(null);
  if (rawContractData) prevContractData.current = rawContractData;
  if (rawPositionData) prevPositionData.current = rawPositionData;
  
  const contractData = rawContractData || prevContractData.current;
  const positionData = rawPositionData || prevPositionData.current;

  const usdcBalanceRaw = contractData?.[0]?.result !== undefined ? (contractData[0].result as bigint) : 0n;
  const usdcBalance = Number(formatUnits(usdcBalanceRaw, 6));
  const usdcAllowance = contractData?.[1]?.result !== undefined ? (contractData[1].result as bigint) : 0n;

  const marketData = contractData?.[2]?.result as any;
  const totalBorrowAssets = marketData?.[2] || 0n;
  const totalBorrowShares = marketData?.[3] || 0n;

  const borrowShares = optimisticZeroDebt ? 0n : (positionData?.[1] || 0n);

  let exactDebtAssets = 0n;
  if (optimisticZeroDebt) {
    exactDebtAssets = 0n;
  } else if (totalBorrowShares > 0n) {
    const VIRTUAL_SHARES = 1000000n; 
    const VIRTUAL_ASSETS = 1000000n; 
    const numerator = borrowShares * (totalBorrowAssets + VIRTUAL_ASSETS);
    const denominator = totalBorrowShares + VIRTUAL_SHARES;
    exactDebtAssets = (numerator + denominator - 1n) / denominator; 
  }

  const exactDebtUSDC = Number(formatUnits(exactDebtAssets, 6));
  const rawCollateral = positionData?.[2] || 0n;
  const collateralAmount = rawCollateral ? Number(formatUnits(rawCollateral, currentAsset.decimals)) : 0;

  // --- NEW: THE "STICKY MAX" SYNCHRONIZERS ---
  // If the user selected MAX, auto-update the input field when the blockchain data refreshes
  // This prevents the field from going stale or clearing out after an Approval.
  useEffect(() => {
    if (isMaxRepay && exactDebtAssets > 0n) {
      setRepayAmount(formatUnits(exactDebtAssets, 6));
    }
  }, [exactDebtAssets, isMaxRepay]);

  useEffect(() => {
    if (isMaxWithdraw && rawCollateral > 0n) {
      setWithdrawAmount(formatUnits(rawCollateral, currentAsset.decimals));
    }
  }, [rawCollateral, isMaxWithdraw, currentAsset.decimals]);
  // ---------------------------------------------

  const repayAmountRaw = safeParseUnits(repayAmount, 6);
  const withdrawAmountRaw = safeParseUnits(withdrawAmount, currentAsset.decimals);

  const needsApproval = repayAmountRaw > 0n && usdcAllowance < repayAmountRaw && !optimisticApproval;
  
  const isRepayExceedingWallet = isMaxRepay ? exactDebtAssets > usdcBalanceRaw : repayAmountRaw > usdcBalanceRaw;
  const isWithdrawExceedingVault = isMaxWithdraw ? false : withdrawAmountRaw > rawCollateral;

  const { writeContract: write, data: hash, isPending: isWalletPromptOpen, reset: resetTx } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isTxSuccess, isError: isTxError } = useWaitForTransactionReceipt({ hash });
  
  const isTxBusy = isWalletPromptOpen || isConfirming;

  useEffect(() => {
    if (isTxSuccess) {
      if (lastAction === 'approve') {
        setOptimisticApproval(true);
        toast.success("Approval Confirmed! Now click Repay."); 
      }
      else if (lastAction === 'repay') { 
        setRepayAmount(''); 
        if (isMaxRepay || repayAmountRaw >= exactDebtAssets) {
          setOptimisticZeroDebt(true);
          setTimeout(() => setOptimisticZeroDebt(false), 15000); 
        }
        setIsMaxRepay(false); 
        toast.success("Repayment Success! Debt Cleared.");
      }
      else if (lastAction === 'withdraw') { 
        setWithdrawAmount(''); 
        setIsMaxWithdraw(false); 
        toast.success("Withdrawal Successful!");
      }
      
      queryClient.invalidateQueries();
      refetchReads(); refetchPosition();
      setTimeout(() => { queryClient.invalidateQueries(); refetchReads(); refetchPosition(); }, 4000);
      resetTx();
    }

    if (isTxError) {
      toast.error("Transaction reverted or was rejected by the network.");
      resetTx();
    }
  }, [isTxSuccess, isTxError, refetchReads, refetchPosition, resetTx, lastAction, queryClient, isMaxRepay, repayAmountRaw, exactDebtAssets]);

  const handleAction = (type: 'approve' | 'repay' | 'withdraw') => {
    setLastAction(type);
    const market = { loanToken: config.USDC, collateralToken: currentAsset.address, oracle: marketParams.oracle as `0x${string}`, irm: marketParams.irm as `0x${string}`, lltv: marketParams.lltv };
    
    if (type === 'approve') write({ address: config.USDC as `0x${string}`, abi: erc20Abi, functionName: 'approve', args: [MORPHO_BLUE_ADDRESS, maxUint256] });
    else if (type === 'repay') {
      if (isMaxRepay || repayAmountRaw >= exactDebtAssets) write({ address: MORPHO_BLUE_ADDRESS, abi: morphoAbi, functionName: 'repay', args: [market, 0n, borrowShares, safeAddress, '0x'] });
      else write({ address: MORPHO_BLUE_ADDRESS, abi: morphoAbi, functionName: 'repay', args: [market, repayAmountRaw, 0n, safeAddress, '0x'] });
    } 
    else {
      const safeWithdrawAssets = isMaxWithdraw ? rawCollateral : withdrawAmountRaw;
      write({ address: MORPHO_BLUE_ADDRESS, abi: morphoAbi, functionName: 'withdrawCollateral', args: [market, safeWithdrawAssets, safeAddress, safeAddress] });
    }
  };

  return (
    <div className="space-y-4">
      <Card className="shadow border-muted">
        <CardContent className="p-4 space-y-4">
          
          <div className="flex justify-between items-center text-xs font-medium mb-1">
            <span className="text-muted-foreground">Wallet: <span className="text-foreground font-bold">{usdcBalance.toFixed(2)} USDC</span></span>
            <span className="text-muted-foreground">Debt: <span className="text-red-600 dark:text-red-400 font-bold">{exactDebtUSDC.toFixed(4)} USDC</span></span>
          </div>
          
          <div className="flex space-x-2">
            <Input type="number" step="any" placeholder="0.00" value={repayAmount} disabled={exactDebtAssets === 0n} onChange={(e) => { setRepayAmount(e.target.value); setIsMaxRepay(false); }} className={`flex-1 h-12 text-lg font-bold px-3 ${isRepayExceedingWallet ? 'border-red-500' : ''}`} />
            <Button variant="outline" disabled className="w-[80px] h-12 opacity-100 font-bold text-sm">USDC</Button>
          </div>

          <Button variant="outline" size="sm" className="w-full h-8 font-bold bg-muted text-xs" disabled={exactDebtAssets === 0n} onClick={() => { setRepayAmount(exactDebtUSDC.toFixed(6)); setIsMaxRepay(true); }}>
            100% (Clear Debt)
          </Button>

          <div className="pt-2">
            {isRepayExceedingWallet ? (
               <Button className="w-full h-12 text-sm font-bold text-white bg-red-500 cursor-not-allowed" disabled>Need {exactDebtUSDC.toFixed(6)} USDC</Button>
            ) : needsApproval ? (
               <Button className="w-full h-12 text-sm font-bold bg-indigo-600 text-white" disabled={isTxBusy || exactDebtAssets === 0n} onClick={() => handleAction('approve')}>{isTxBusy ? 'Confirming...' : 'Approve USDC'}</Button>
            ) : (
               <Button className="w-full h-12 text-sm font-bold bg-blue-600 text-white" disabled={exactDebtAssets === 0n || !repayAmount || Number(repayAmount) <= 0 || isTxBusy || isFetchingMarket} onClick={() => handleAction('repay')}>
                 {isTxBusy ? 'Wait...' : isMaxRepay ? 'Wipe Clean & Close' : 'Repay Loan'}
               </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow border-muted">
        <CardContent className="p-4 space-y-4">
          
          <div className="flex justify-between items-center mb-1">
            <span className="text-sm font-semibold">2. Withdraw {selectedAsset}</span>
            <span className="text-[10px] font-bold bg-muted px-2 py-1 rounded text-muted-foreground truncate max-w-[180px]">
              Vault: {collateralAmount.toFixed(4)} {selectedAsset} (${(collateralAmount * currentPrice).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})})
            </span>
          </div>
          
          <div className="flex space-x-2">
            <Input type="number" step="any" placeholder="0.00" value={withdrawAmount} disabled={rawCollateral === 0n} onChange={(e) => { setWithdrawAmount(e.target.value); setIsMaxWithdraw(false); }} className={`flex-1 h-12 text-lg font-bold px-3 ${isWithdrawExceedingVault ? 'border-red-500' : ''}`} />
            <Select value={selectedAsset} onValueChange={(val: any) => { setSelectedAsset(val); setWithdrawAmount(''); setIsMaxWithdraw(false); }}>
              <SelectTrigger className="w-[100px] h-12 text-sm font-bold"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="cbBTC">cbBTC</SelectItem><SelectItem value="cbETH">cbETH</SelectItem></SelectContent>
            </Select>
          </div>

          <div className="flex gap-2">
            {[25, 50, 75].map((pct) => (
              <Button key={pct} variant="outline" size="sm" className="flex-1 text-xs h-8 font-bold" disabled={rawCollateral === 0n} onClick={() => { setWithdrawAmount(formatUnits((rawCollateral * BigInt(pct)) / 100n, currentAsset.decimals)); setIsMaxWithdraw(false); }}>{pct}%</Button>
            ))}
            <Button variant="outline" size="sm" className="flex-1 text-xs h-8 font-bold bg-muted" disabled={rawCollateral === 0n} onClick={() => { setWithdrawAmount(formatUnits(rawCollateral, currentAsset.decimals)); setIsMaxWithdraw(true); }}>MAX</Button>
          </div>

          <div className="pt-2">
            {isWithdrawExceedingVault ? (
               <Button className="w-full h-12 text-sm font-bold text-white bg-red-500 cursor-not-allowed" disabled>Exceeds Vault</Button>
            ) : (
               <Button className="w-full h-12 text-sm font-bold bg-indigo-600 text-white" disabled={rawCollateral === 0n || !withdrawAmount || Number(withdrawAmount) <= 0 || isTxBusy || exactDebtAssets > 0n || isFetchingMarket} onClick={() => handleAction('withdraw')}>
                 {exactDebtAssets > 0n ? 'Clear Debt First' : isTxBusy ? 'Wait...' : `Withdraw ${selectedAsset}`}
               </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Button variant="ghost" className="w-full flex items-center justify-center space-x-2 text-muted-foreground text-xs font-semibold py-4" onClick={() => setShowInstructions(!showInstructions)}>
        <span>Unwind Instructions</span>
        {showInstructions ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
      </Button>

      {showInstructions && (
        <Card className="shadow border-muted bg-muted/20 animate-in slide-in-from-top-4 duration-300">
          <CardContent className="p-4 text-xs space-y-3 text-muted-foreground leading-relaxed">
            <p>To safely close your position:</p>
            <ol className="list-decimal list-inside space-y-2 font-medium text-foreground">
              <li><strong>Approve USDC:</strong> Grant permission to pull funds.</li>
              <li><strong>Repay Debt:</strong> Click "100% (Clear Debt)" to perfectly wipe out accumulating interest.</li>
              <li><strong>Withdraw:</strong> Once debt is 0.00, the withdraw button unlocks.</li>
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}