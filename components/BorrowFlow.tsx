'use client';

import { useEffect, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import UsdAmountField from '@/components/UsdAmountField';
import WrongNetworkActions from '@/components/WrongNetworkActions';
import GasNotice from '@/components/GasNotice';
import FeeBreakdown from '@/components/FeeBreakdown';
import CoinbaseTransferButton from '@/components/CoinbaseTransferButton';
import { GAS_UNITS, useGasCheck } from '@/components/useGasCheck';
import { aavePoolAbi, erc20Abi, morphoAbi, oracleAbi } from '@/lib/abi';
import { approvalStep, formatToken, formatUsd, formatUsdExact, tokenAmountUsd, tokenPriceUsd } from '@/lib/amount';
import {
  MORPHO_BLUE,
  chainLabel,
  isChainId,
  isVenueSafe,
  sameAssetOnOtherChain,
  morphoParams,
  protocolLabel,
  venueConfidence,
  venueOnChain,
  venueSpender,
  type Venue,
} from '@/lib/protocol';
import { applySafetyBuffer, morphoCollateralToLoan, morphoDebtAssets, morphoMaxBorrowAssets } from '@/lib/risk';
import { useSendTx } from './useSendTx';

const RATE_MAX_AGE_MS = 3 * 60_000;

export default function BorrowFlow({ quote, fetchedAt, venues = [], onSelect }: { quote: Venue | null; fetchedAt: number; venues?: Venue[]; onSelect?: (id: string) => void }) {
  const { address, chain, isConnected } = useAccount();
  const [supplyAmount, setSupplyAmount] = useState<bigint | null>(null);
  const [borrowAmount, setBorrowAmount] = useState<bigint | null>(null);
  const [supplyEpoch, setSupplyEpoch] = useState(0);
  const [borrowEpoch, setBorrowEpoch] = useState(0);
  const [drop, setDrop] = useState(0);
  const { send, isBusy, isAwaitingWallet, confirmed } = useSendTx();

  const safe = quote !== null && isVenueSafe(quote) && quote.action === 'borrow';
  const spender = safe && quote ? venueSpender(quote) : null;
  const morpho = safe && quote?.protocol === 'morpho' ? quote.morpho : undefined;
  const aave = safe && quote?.protocol === 'aave' ? quote.aave : undefined;
  const enabled = Boolean(address && safe);
  const gas = useGasCheck(quote?.chainId, GAS_UNITS.write);
  const marketChainId = quote?.chainId;
  const otherAsset = quote ? sameAssetOnOtherChain(quote.chainId, quote.assetSymbol) : null;

  const { data: balance, isError: balanceError, refetch: refetchBalance } = useReadContract({
    address: quote?.assetAddress,
    chainId: marketChainId,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled, refetchInterval: 20_000 },
  });
  const { data: otherBalance, refetch: refetchOther } = useReadContract({
    address: otherAsset?.address,
    chainId: otherAsset?.chainId,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address && otherAsset ? [address] : undefined,
    query: { enabled: Boolean(enabled && otherAsset), refetchInterval: 20_000 },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: quote?.assetAddress,
    chainId: marketChainId,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && spender ? [address, spender] : undefined,
    query: { enabled: Boolean(enabled && spender), refetchInterval: 20_000 },
  });
  const { data: position, refetch: refetchPosition } = useReadContract({
    address: MORPHO_BLUE,
    chainId: marketChainId,
    abi: morphoAbi,
    functionName: 'position',
    args: address && morpho ? [morpho.marketId, address] : undefined,
    query: { enabled: Boolean(enabled && morpho), refetchInterval: 20_000 },
  });
  const { data: market, refetch: refetchMarket } = useReadContract({
    address: MORPHO_BLUE,
    chainId: marketChainId,
    abi: morphoAbi,
    functionName: 'market',
    args: morpho ? [morpho.marketId] : undefined,
    query: { enabled: Boolean(enabled && morpho), refetchInterval: 20_000 },
  });
  const { data: oraclePrice, refetch: refetchOracle } = useReadContract({
    address: morpho?.oracle,
    chainId: marketChainId,
    abi: oracleAbi,
    functionName: 'price',
    query: { enabled: Boolean(enabled && morpho), refetchInterval: 20_000 },
  });
  const { data: account, refetch: refetchAccount } = useReadContract({
    address: aave?.pool,
    chainId: marketChainId,
    abi: aavePoolAbi,
    functionName: 'getUserAccountData',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(enabled && aave), refetchInterval: 20_000 },
  });
  const { data: aTokenBalance, refetch: refetchAToken } = useReadContract({
    address: aave?.aToken,
    chainId: marketChainId,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(enabled && aave), refetchInterval: 20_000 },
  });

  function refetchAll() {
    void refetchBalance();
    void refetchOther();
    void refetchAllowance();
    void refetchPosition();
    void refetchMarket();
    void refetchOracle();
    void refetchAccount();
    void refetchAToken();
  }

  useEffect(() => {
    if (!confirmed) return;
    if (confirmed.action === 'supply') {
      setSupplyAmount(null);
      setSupplyEpoch((value) => value + 1);
    }
    if (confirmed.action === 'borrow') {
      setBorrowAmount(null);
      setBorrowEpoch((value) => value + 1);
    }
    refetchAll();
    // refetch identities change every render; the confirmation nonce is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed]);

  if (!quote || !safe || !spender) {
    return <p className="text-sm text-muted-foreground">Choose a borrow market above to continue.</p>;
  }

  const walletBalance = balance ?? 0n;
  const currentAllowance = allowance ?? 0n;
  const price = tokenPriceUsd(quote.assetSymbol, quote.priceUsd);
  const existingCollateral = morpho ? (position?.[2] ?? 0n) : (aTokenBalance ?? 0n);
  const existingDebt = morpho
    ? morphoDebtAssets(position?.[1] ?? 0n, market?.[2] ?? 0n, market?.[3] ?? 0n)
    : 0n;
  const oracle = oraclePrice ?? 0n;
  const onChainBorrowRoom = morpho
    ? applySafetyBuffer(morphoMaxBorrowAssets(existingCollateral, oracle, BigInt(morpho.lltv)))
    : applySafetyBuffer((account?.[2] ?? 0n) / 100n);
  const borrowRoom = onChainBorrowRoom > existingDebt ? onChainBorrowRoom - existingDebt : 0n;
  const collateralValue = morpho ? morphoCollateralToLoan(existingCollateral, oracle) : 0n;
  const ltv = collateralValue > 0n ? Number((existingDebt * 10_000n) / collateralValue) / 100 : 0;
  const stale = Date.now() - fetchedAt > RATE_MAX_AGE_MS;
  const wrongChain = isConnected && chain?.id !== quote.chainId;
  const connectedChainId = chain?.id ?? 0;
  const walletChainId = isChainId(connectedChainId) ? connectedChainId : null;
  const alternate = wrongChain && walletChainId ? venueOnChain(venues, quote, walletChainId) : null;
  const marketMissing = Boolean(morpho && market && market[4] === 0n);
  const oracleReady = !morpho || oracle > 0n;
  const supplyTooBig = supplyAmount !== null && supplyAmount > walletBalance;
  const borrowTooBig = borrowAmount !== null && borrowAmount > borrowRoom;
  const step = approvalStep(currentAllowance, supplyAmount ?? 0n);
  const pendingSupply = supplyAmount !== null && supplyAmount > 0n;

  const confidence = venueConfidence(quote);
  const collateralTokens = Number(formatUnits(existingCollateral, quote.assetDecimals));
  const collateralUsd = tokenAmountUsd(existingCollateral, quote.assetDecimals, price);
  const supplyUsd = supplyAmount && supplyAmount > 0n ? tokenAmountUsd(supplyAmount, quote.assetDecimals, price) : null;
  const estimatedBorrowUsd = supplyUsd !== null ? supplyUsd * quote.maxLtv * 0.9 : null;
  const debtUsd = morpho
    ? Number(formatUnits(existingDebt, quote.loanDecimals))
    : Number(formatUnits(account?.[1] ?? 0n, 8));
  const liquidationPrice = collateralTokens > 0 && debtUsd > 0 ? debtUsd / (collateralTokens * quote.maxLtv) : 0;
  const simulatedPrice = quote.priceUsd * (1 - drop / 100);
  const simulatedLtv = collateralTokens > 0 && simulatedPrice > 0 ? (debtUsd / (collateralTokens * simulatedPrice)) * 100 : 0;

  async function approve(amount: bigint) {
    await send(amount === 0n ? 'reset' : 'approve', {
      address: quote!.assetAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender!, amount],
      chainId: quote!.chainId,
    });
  }

  async function supply() {
    if (!address || !supplyAmount || supplyAmount <= 0n) return;
    const params = morphoParams(quote!);
    if (quote!.protocol === 'morpho' && params) {
      await send('supply', {
        address: MORPHO_BLUE,
        abi: morphoAbi,
        functionName: 'supplyCollateral',
        args: [params, supplyAmount, address, '0x'],
        chainId: quote!.chainId,
      });
      return;
    }
    if (aave) {
      await send('supply', {
        address: aave.pool,
        abi: aavePoolAbi,
        functionName: 'supply',
        args: [quote!.assetAddress, supplyAmount, address, 0],
        chainId: quote!.chainId,
      });
    }
  }

  async function borrow() {
    if (!address || !borrowAmount || borrowAmount <= 0n || borrowAmount > borrowRoom) return;
    const params = morphoParams(quote!);
    if (quote!.protocol === 'morpho' && params) {
      await send('borrow', {
        address: MORPHO_BLUE,
        abi: morphoAbi,
        functionName: 'borrow',
        args: [params, borrowAmount, 0n, address, address],
        chainId: quote!.chainId,
      });
      return;
    }
    if (aave) {
      await send('borrow', {
        address: aave.pool,
        abi: aavePoolAbi,
        functionName: 'borrow',
        args: [quote!.loanAddress, borrowAmount, 2n, 0, address],
        chainId: quote!.chainId,
      });
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">In your wallet · {chainLabel(quote.chainId)}</p>
          {!isConnected ? (
            <p className="text-lg font-bold">Connect a wallet to see {quote.assetSymbol}</p>
          ) : balanceError ? (
            <p className="text-lg font-bold">Could not read {quote.assetSymbol} on {chainLabel(quote.chainId)}</p>
          ) : balance === undefined ? (
            <p className="text-lg font-bold">Reading {quote.assetSymbol}…</p>
          ) : (
            <>
              <p className="text-2xl font-bold tracking-tight">{formatToken(walletBalance, quote.assetDecimals)} {quote.assetSymbol}</p>
              {tokenAmountUsd(walletBalance, quote.assetDecimals, price) !== null && (
                <p className="text-sm text-muted-foreground">{formatUsdExact(tokenAmountUsd(walletBalance, quote.assetDecimals, price) ?? 0)}</p>
              )}
              {walletBalance === 0n && existingCollateral === 0n && (
                <p className="mt-1 text-xs text-muted-foreground">This address has no {quote.assetSymbol} on {chainLabel(quote.chainId)}.</p>
              )}
              {walletBalance === 0n && quote.chainId === 8453 && quote.assetSymbol === 'cbBTC' && (
                <CoinbaseTransferButton className="mt-2 h-9 bg-blue-600 text-xs text-white hover:bg-blue-700" />
              )}
              {walletBalance > 0n && existingCollateral === 0n && (
                <p className="mt-1 text-xs text-muted-foreground">This {quote.assetSymbol} is still in your wallet. Supply it below to borrow against it.</p>
              )}
            </>
          )}
          {otherAsset && otherBalance !== undefined && otherBalance > 0n && (
            <p className="mt-2 text-xs text-muted-foreground">
              You also hold {formatToken(otherBalance, otherAsset.decimals)} {quote.assetSymbol} on {chainLabel(otherAsset.chainId)}. Choose a {chainLabel(otherAsset.chainId)} market to use that balance.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Supplied on {protocolLabel(quote.protocol)}</p><p className="text-lg font-bold">{formatToken(existingCollateral, quote.assetDecimals)} {quote.assetSymbol}</p>{existingCollateral === 0n ? <p className="text-xs text-muted-foreground">Nothing supplied yet</p> : collateralUsd !== null && <p className="text-xs text-muted-foreground">{formatUsdExact(collateralUsd)}</p>}</CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Debt</p><p className="text-lg font-bold text-red-500">{formatUsdExact(debtUsd)}</p>{morpho && <p className="text-xs text-muted-foreground">{formatToken(existingDebt, quote.loanDecimals)} USDC</p>}</CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">Safe to borrow</p><p className="text-lg font-bold">{formatUsdExact(tokenAmountUsd(borrowRoom, quote.loanDecimals, 1) ?? 0)}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-[10px] font-semibold uppercase text-muted-foreground">{protocolLabel(quote.protocol)}</p><p className="text-lg font-bold">{morpho ? `${ltv.toFixed(1)}% LTV` : account && account[1] > 0n ? `HF ${(Number(account[5] / 10n ** 14n) / 10_000).toFixed(2)}` : 'No debt'}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="space-y-2 p-4">
          <p className={`text-xs font-bold ${confidence.level === 'cautious' ? 'text-orange-600 dark:text-orange-400' : 'text-emerald-700 dark:text-emerald-400'}`}>{confidence.label}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{confidence.detail} Borrowing stays capped at 90% of this pool&apos;s maximum LTV.</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <UsdAmountField
            label={`Supply ${quote.assetSymbol}`}
            symbol={quote.assetSymbol}
            decimals={quote.assetDecimals}
            priceUsd={quote.priceUsd}
            balance={balance === undefined ? undefined : walletBalance}
            epoch={supplyEpoch}
            invalid={supplyTooBig}
            onAmount={setSupplyAmount}
          />
          {supplyUsd !== null && estimatedBorrowUsd !== null && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              This supply is about {formatUsdExact(supplyUsd)}. After it confirms, the 90% safety cap on the {Math.round(quote.maxLtv * 100)}% maximum LTV is about {formatUsdExact(estimatedBorrowUsd)} USDC.
            </p>
          )}

          <div className="border-t pt-4">
            <UsdAmountField
              label="Borrow USDC"
              symbol="USDC"
              decimals={quote.loanDecimals}
              priceUsd={1}
              balance={borrowRoom}
              balanceLabel="Safe to borrow"
              epoch={borrowEpoch}
              invalid={borrowTooBig}
              onAmount={setBorrowAmount}
            />
            <p className="mt-2 text-xs text-muted-foreground">The borrow limit uses collateral already supplied, at 90% of this pool&apos;s maximum.</p>
          </div>

          {stale && <p className="text-xs font-medium text-orange-500">Rates are older than 3 minutes. Refresh before sending a transaction.</p>}
          {marketMissing && <p className="text-xs font-medium text-red-500">This Morpho market is not initialized.</p>}
          {!oracleReady && <p className="text-xs font-medium text-orange-500">Waiting for the on-chain oracle before borrow is enabled.</p>}
          {pendingSupply && borrowRoom > 0n && <p className="text-xs text-muted-foreground">Borrow now uses only collateral already supplied. Supply first to raise the limit.</p>}
          {pendingSupply && borrowRoom === 0n && <p className="text-xs text-muted-foreground">Supply first. Borrowing opens once the supply confirms.</p>}
          {borrowAmount !== null && Number(formatUnits(borrowAmount, quote.loanDecimals)) > quote.liquidityUsd && (
            <p className="text-xs font-medium text-orange-500">This borrow is larger than the liquidity available in the selected market.</p>
          )}

          {!isConnected ? (
            <Button className="h-12 w-full" disabled>Connect a wallet to continue</Button>
          ) : wrongChain ? (
            <WrongNetworkActions
              walletName={chain?.name ?? 'another network'}
              marketChainId={quote.chainId}
              alternate={alternate}
              onUseAlternate={onSelect}
            />
          ) : !gas.enough ? (
            <GasNotice chainId={quote.chainId} symbol={quote.assetSymbol} neededEth={gas.neededEth} balanceEth={gas.balanceEth} />
          ) : supplyTooBig ? (
            <Button className="h-12 w-full" disabled>Insufficient {quote.assetSymbol}</Button>
          ) : step === 'reset' ? (
            <Button className="h-12 w-full bg-indigo-600 text-white hover:bg-indigo-700" disabled={isBusy || stale} onClick={() => void approve(0n)}>{isAwaitingWallet ? 'Confirm in wallet…' : isBusy ? 'Confirming…' : 'Reset approval'}</Button>
          ) : step === 'approve' ? (
            <Button className="h-12 w-full bg-indigo-600 text-white hover:bg-indigo-700" disabled={isBusy || stale || !supplyAmount} onClick={() => supplyAmount && void approve(supplyAmount)}>{isAwaitingWallet ? 'Confirm in wallet…' : isBusy ? 'Confirming…' : `Approve ${quote.assetSymbol}`}</Button>
          ) : (
            <div className="flex gap-2">
              <Button className="h-12 flex-1 bg-indigo-600 text-white hover:bg-indigo-700" disabled={isBusy || stale || marketMissing || !supplyAmount || supplyAmount <= 0n} onClick={() => void supply()}>{isBusy ? (isAwaitingWallet ? 'Confirm…' : 'Confirming…') : 'Supply'}</Button>
              <Button className="h-12 flex-1 bg-blue-600 text-white hover:bg-blue-700" disabled={isBusy || stale || marketMissing || !oracleReady || !borrowAmount || borrowAmount <= 0n || borrowTooBig} onClick={() => void borrow()}>{isBusy ? (isAwaitingWallet ? 'Confirm…' : 'Confirming…') : 'Borrow'}</Button>
            </div>
          )}

          {isConnected && (
            <FeeBreakdown
              quote={quote}
              actions={[
                ...(pendingSupply && step !== 'none' ? ['approve'] : []),
                ...(pendingSupply ? ['supply'] : []),
                ...(borrowAmount && borrowAmount > 0n ? ['borrow'] : []),
                ...(!pendingSupply && !(borrowAmount && borrowAmount > 0n) ? ['supply', 'borrow'] : []),
              ]}
              interest={{
                apr: quote.borrowApr,
                principalUsd: debtUsd + (tokenAmountUsd(borrowAmount ?? 0n, quote.loanDecimals, 1) ?? 0),
                label: borrowAmount && borrowAmount > 0n ? 'Interest after this borrow' : 'Interest on current debt',
              }}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">Liquidation price</span>
            <span className="font-bold">{liquidationPrice > 0 ? formatUsd(liquidationPrice) : 'No debt'}</span>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>BTC drop</span><span>-{drop}%</span>
          </div>
          <Slider value={[drop]} max={90} step={1} onValueChange={(value) => setDrop(value[0] ?? 0)} />
          <p className={`text-xs font-semibold ${simulatedLtv >= quote.maxLtv * 100 ? 'text-red-500' : 'text-muted-foreground'}`}>
            At {formatUsd(simulatedPrice)}, LTV would be {simulatedLtv.toFixed(1)}% against a {Math.round(quote.maxLtv * 100)}% maximum.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
