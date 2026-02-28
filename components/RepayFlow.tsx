'use client';

import { useState, useEffect, useRef } from 'react';
import { useAccount, useReadContracts, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { formatUnits, parseUnits, maxUint256 } from 'viem';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

// --- ABIs ---
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
  8453: { USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', WETH: '0x4200000000000000000000000000000000000006', cbBTC: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', cbETH: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22' },
  84532: { USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', WETH: '0x4200000000000000000000000000000000000006', cbBTC: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', cbETH: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22' }
};

const MORPHO_BLUE_ADDRESS = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb';

export default function RepayFlow() {
  const { address, chain } = useAccount();
  const safeAddress = address || '0x0000000000000000000000000000000000000000';
  const chainId = chain?.id === 84532 ? 84532 : 8453;
  const config = NETWORK_CONFIG[chainId as keyof typeof NETWORK_CONFIG];

  const ASSETS = { cbBTC: { address: config.cbBTC, decimals: 8, symbol: 'cbBTC' }, cbETH: { address: config.cbETH, decimals: 18, symbol: 'cbETH' }, WETH: { address: config.WETH, decimals: 18, symbol: 'WETH' } };
  const [selectedAsset, setSelectedAsset] = useState<keyof typeof ASSETS>('cbBTC');
  
  const [repayAmount, setRepayAmount] = useState<string>('');
  const [withdrawAmount, setWithdrawAmount] = useState<string>('');
  
  const [isMaxRepay, setIsMaxRepay] = useState(false);
  const [isMaxWithdraw, setIsMaxWithdraw] = useState(false);

  const [optimisticApproval, setOptimisticApproval] = useState(false);
  const [lastAction, setLastAction] = useState<string>('');

  const currentAsset = ASSETS[selectedAsset];

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

  // We re-added a gentle 6-second poll to keep tabs synced natively
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

  // --- ANTI-FLASH CACHE ---
  // If the 6-second poll gets blocked by the RPC, this perfectly maintains the UI using the last known data
  const prevContractData = useRef<any>(null);
  const prevPositionData = useRef<any>(null);
  if (rawContractData) prevContractData.current = rawContractData;
  if (rawPositionData) prevPositionData.current = rawPositionData;
  
  const contractData = rawContractData || prevContractData.current;
  const positionData = rawPositionData || prevPositionData.current;

  // Safely extract USDC balance
  const usdcBalance = contractData?.[0]?.result !== undefined ? Number(formatUnits(contractData[0].result as bigint, 6)) : 0;
  const usdcAllowance = contractData?.[1]?.result !== undefined ? (contractData[1].result as bigint) : 0n;

  const marketData = contractData?.[2]?.result as any;
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

  const exactDebtUSDC = Number(formatUnits(exactDebtAssets, 6));
  const rawCollateral = positionData?.[2] || 0n;
  const collateralAmount = positionData?.[2] ? Number(formatUnits(positionData[2], currentAsset.decimals)) : 0;

  const repayAmountRaw = parseUnits(repayAmount || '0', 6);
  const needsApproval = repayAmountRaw > 0n && usdcAllowance < repayAmountRaw && !optimisticApproval;
  const isRepayExceedingWallet = Number(repayAmount || 0) > usdcBalance;
  const isWithdrawExceedingVault = Number(withdrawAmount || 0) > collateralAmount;

  const { writeContract: write, data: hash, isPending: isWalletPromptOpen, reset: resetTx } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isTxSuccess } = useWaitForTransactionReceipt({ hash });
  
  const isTxBusy = isWalletPromptOpen || isConfirming;

  useEffect(() => {
    if (isTxSuccess) {
      if (lastAction === 'approve') {
        setOptimisticApproval(true);
      } else if (lastAction === 'repay') {
        setRepayAmount('');
        setIsMaxRepay(false);
      } else if (lastAction === 'withdraw') {
        setWithdrawAmount('');
        setIsMaxWithdraw(false);
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

  const handleAction = (type: 'approve' | 'repay' | 'withdraw') => {
    setLastAction(type);
    const market = { loanToken: config.USDC, collateralToken: currentAsset.address, oracle: marketParams.oracle as `0x${string}`, irm: marketParams.irm as `0x${string}`, lltv: marketParams.lltv };
    
    if (type === 'approve') {
      write({ address: config.USDC as `0x${string}`, abi: erc20Abi, functionName: 'approve', args: [MORPHO_BLUE_ADDRESS, maxUint256] });
    } 
    else if (type === 'repay') {
      if (isMaxRepay || repayAmountRaw >= exactDebtAssets) {
        write({ address: MORPHO_BLUE_ADDRESS, abi: morphoAbi, functionName: 'repay', args: [market, 0n, borrowShares, safeAddress, '0x'] });
      } else {
        write({ address: MORPHO_BLUE_ADDRESS, abi: morphoAbi, functionName: 'repay', args: [market, repayAmountRaw, 0n, safeAddress, '0x'] });
      }
    } 
    else {
      const safeWithdrawAssets = isMaxWithdraw ? rawCollateral : parseUnits(withdrawAmount || '0', currentAsset.decimals);
      write({ address: MORPHO_BLUE_ADDRESS, abi: morphoAbi, functionName: 'withdrawCollateral', args: [market, safeWithdrawAssets, safeAddress, safeAddress] });
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-7 space-y-6">
        
        <Card className="shadow-lg border-muted">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">1. Repay USDC Loan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex justify-between items-center text-sm font-medium">
              <span className="text-muted-foreground">Wallet Balance: <span className="text-foreground font-bold">{usdcBalance.toFixed(2)} USDC</span></span>
              {/* UPDATED: Active Debt text color softened for dark mode */}
              <span className="text-muted-foreground">Active Debt: <span className="text-red-600 dark:text-red-400 font-bold">{exactDebtUSDC.toFixed(6)} USDC</span></span>
            </div>
            
            <div className="flex space-x-3">
              <Input 
                type="number" 
                step="any" 
                placeholder="0.00" 
                value={repayAmount} 
                disabled={exactDebtAssets === 0n}
                onChange={(e) => { setRepayAmount(e.target.value); setIsMaxRepay(false); }} 
                className={`flex-1 h-14 text-2xl font-bold px-4 ${isRepayExceedingWallet ? 'border-red-500 focus-visible:ring-red-500' : ''}`} 
              />
              <Button variant="outline" disabled className="w-[120px] h-14 opacity-100 font-bold">USDC</Button>
            </div>

            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                className="flex-1 font-bold bg-muted" 
                disabled={exactDebtAssets === 0n}
                onClick={() => { setRepayAmount(exactDebtUSDC.toFixed(6)); setIsMaxRepay(true); }}
              >
                100% (Clear Debt)
              </Button>
            </div>

            <div className="pt-2 border-t">
              {isRepayExceedingWallet ? (
                 <Button className="w-full h-12 font-bold text-white bg-red-500 hover:bg-red-600 cursor-not-allowed" disabled>
                   Insufficient USDC Balance
                 </Button>
              ) : needsApproval ? (
                 <Button className="w-full h-12 font-bold bg-indigo-600 text-white" disabled={isTxBusy || exactDebtAssets === 0n} onClick={() => handleAction('approve')}>
                   {isTxBusy ? 'Confirming in Wallet...' : 'Approve USDC'}
                 </Button>
              ) : (
                 <Button 
                   className="w-full h-12 font-bold bg-blue-600 text-white" 
                   disabled={exactDebtAssets === 0n || !repayAmount || Number(repayAmount) <= 0 || isTxBusy || isFetchingMarket} 
                   onClick={() => handleAction('repay')}
                 >
                   {isTxBusy ? 'Processing...' : isMaxRepay ? 'Wipe Clean & Close Loan' : 'Repay Loan'}
                 </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-lg border-muted">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">2. Withdraw Collateral</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex justify-between items-center text-sm font-medium">
              <span className="text-muted-foreground">Currently in Vault:</span>
              {/* UPDATED: Added dark mode classes for the Vault badge */}
              <span className="text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 px-2 py-1 rounded font-bold">{collateralAmount.toFixed(6)} {selectedAsset}</span>
            </div>
            
            <div className="flex space-x-3">
              <Input 
                type="number" 
                step="any" 
                placeholder="0.00" 
                value={withdrawAmount} 
                disabled={rawCollateral === 0n}
                onChange={(e) => { setWithdrawAmount(e.target.value); setIsMaxWithdraw(false); }} 
                className={`flex-1 h-14 text-2xl font-bold px-4 ${isWithdrawExceedingVault ? 'border-red-500 focus-visible:ring-red-500' : ''}`} 
              />
              <Select value={selectedAsset} onValueChange={(val: any) => { setSelectedAsset(val); setWithdrawAmount(''); setIsMaxWithdraw(false); }}>
                <SelectTrigger className="w-[140px] h-14 font-bold"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cbBTC">cbBTC</SelectItem>
                  <SelectItem value="cbETH">cbETH</SelectItem>
                  <SelectItem value="WETH">WETH</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              {[25, 50, 75].map((pct) => (
                <Button key={pct} variant="outline" size="sm" className="flex-1 font-bold" disabled={rawCollateral === 0n} onClick={() => { setWithdrawAmount(((collateralAmount * pct) / 100).toFixed(8)); setIsMaxWithdraw(false); }}>{pct}%</Button>
              ))}
              <Button variant="outline" size="sm" className="flex-1 font-bold bg-muted" disabled={rawCollateral === 0n} onClick={() => { setWithdrawAmount(collateralAmount.toFixed(8)); setIsMaxWithdraw(true); }}>MAX</Button>
            </div>

            <div className="pt-2 border-t">
              {isWithdrawExceedingVault ? (
                 <Button className="w-full h-12 font-bold text-white bg-red-500 hover:bg-red-600 cursor-not-allowed" disabled>
                   Exceeds Vault Balance
                 </Button>
              ) : (
                 <Button className="w-full h-12 font-bold bg-indigo-600 text-white" disabled={rawCollateral === 0n || !withdrawAmount || Number(withdrawAmount) <= 0 || isTxBusy || exactDebtAssets > 0n || isFetchingMarket} onClick={() => handleAction('withdraw')}>
                   {exactDebtAssets > 0n ? 'Clear Debt First' : isTxBusy ? 'Processing...' : `Withdraw ${selectedAsset}`}
                 </Button>
              )}
            </div>
          </CardContent>
        </Card>

      </div>

      <div className="lg:col-span-5 space-y-6">
        <Card className="shadow border-muted bg-muted/20 dark:bg-muted/10 h-full">
          <CardHeader>
            <CardTitle className="text-xl">Unwind Instructions</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-4 text-muted-foreground leading-relaxed">
            <p>To safely close your position, execute the unwind process in order:</p>
            <ol className="list-decimal list-inside space-y-3 font-medium text-foreground">
              <li><strong>Approve USDC:</strong> Grant Morpho permission to pull repayment funds. (You only need to do this once).</li>
              <li><strong>Repay Debt:</strong> Pay back the USDC you borrowed. Click the <em>"100% (Clear Debt)"</em> button to perfectly wipe out all accumulating interest automatically.</li>
              <li><strong>Withdraw Collateral:</strong> Once your debt is precisely 0.00, the final button will unlock so you can retrieve your locked collateral back into your wallet.</li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}