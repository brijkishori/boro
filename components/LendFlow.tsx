'use client';

import { useEffect, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import UsdAmountField from '@/components/UsdAmountField';
import WrongNetworkActions from '@/components/WrongNetworkActions';
import GasNotice from '@/components/GasNotice';
import FeeBreakdown from '@/components/FeeBreakdown';
import { GAS_UNITS, useGasCheck } from '@/components/useGasCheck';
import { aavePoolAbi, erc20Abi, morphoAbi } from '@/lib/abi';
import { approvalStep, formatApr, formatToken, formatUsdExact, tokenAmountUsd, tokenPriceUsd } from '@/lib/amount';
import {
  MORPHO_BLUE,
  chainLabel,
  isChainId,
  isVenueSafe,
  morphoParams,
  protocolLabel,
  sameAssetOnOtherChain,
  venueOnChain,
  venueSpender,
  type Venue,
} from '@/lib/protocol';
import { useSendTx } from './useSendTx';

const RATE_MAX_AGE_MS = 3 * 60_000;

export default function LendFlow({ quote, fetchedAt, venues = [], onSelect }: { quote: Venue | null; fetchedAt: number; venues?: Venue[]; onSelect?: (id: string) => void }) {
  const { address, chain, isConnected } = useAccount();
  const [amount, setAmount] = useState<bigint | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState<bigint | null>(null);
  const [supplyEpoch, setSupplyEpoch] = useState(0);
  const [withdrawEpoch, setWithdrawEpoch] = useState(0);
  const { send, isBusy, isAwaitingWallet, confirmed } = useSendTx();

  const safe = quote !== null && isVenueSafe(quote) && quote.action === 'lend';
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
  const { data: otherBalance } = useReadContract({
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
  const { data: supplied, refetch: refetchSupplied } = useReadContract({
    address: aave?.aToken,
    chainId: marketChainId,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(enabled && aave), refetchInterval: 20_000 },
  });
  const { data: account, refetch: refetchAccount } = useReadContract({
    address: aave?.pool,
    chainId: marketChainId,
    abi: aavePoolAbi,
    functionName: 'getUserAccountData',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(enabled && aave), refetchInterval: 20_000 },
  });

  useEffect(() => {
    if (!confirmed) return;
    if (confirmed.action === 'supply') {
      setAmount(null);
      setSupplyEpoch((value) => value + 1);
    }
    if (confirmed.action === 'withdraw') {
      setWithdrawAmount(null);
      setWithdrawEpoch((value) => value + 1);
    }
    void refetchBalance();
    void refetchAllowance();
    void refetchPosition();
    void refetchSupplied();
    void refetchAccount();
  }, [confirmed, refetchAccount, refetchAllowance, refetchBalance, refetchPosition, refetchSupplied]);

  if (!quote || !safe || !spender) {
    return <p className="text-sm text-muted-foreground">Choose a lend market above. Lending earns supply APY.</p>;
  }

  const walletBalance = balance ?? 0n;
  const price = tokenPriceUsd(quote.assetSymbol, quote.priceUsd);
  const suppliedBalance = aave ? (supplied ?? 0n) : 0n;
  const supplyShares = position?.[0] ?? 0n;
  const step = approvalStep(allowance ?? 0n, amount ?? 0n);
  const stale = Date.now() - fetchedAt > RATE_MAX_AGE_MS;
  const wrongChain = isConnected && chain?.id !== quote.chainId;
  const connectedChainId = chain?.id ?? 0;
  const walletChainId = isChainId(connectedChainId) ? connectedChainId : null;
  const alternate = wrongChain && walletChainId ? venueOnChain(venues, quote, walletChainId) : null;
  const tooBig = amount !== null && amount > walletBalance;
  const aaveHasDebt = Boolean(aave && account && account[1] > 0n);
  const withdrawTooBig = Boolean(aave && withdrawAmount && withdrawAmount > suppliedBalance);

  async function approve(value: bigint) {
    await send(value === 0n ? 'reset' : 'approve', {
      address: quote!.assetAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender!, value],
      chainId: quote!.chainId,
    });
  }

  async function supply() {
    if (!address || !amount || amount <= 0n) return;
    const params = morphoParams(quote!);
    if (morpho && params) {
      await send('supply', {
        address: MORPHO_BLUE,
        abi: morphoAbi,
        functionName: 'supply',
        args: [params, amount, 0n, address, '0x'],
        chainId: quote!.chainId,
      });
      return;
    }
    if (aave) {
      await send('supply', {
        address: aave.pool,
        abi: aavePoolAbi,
        functionName: 'supply',
        args: [quote!.assetAddress, amount, address, 0],
        chainId: quote!.chainId,
      });
    }
  }

  async function withdraw() {
    if (!address) return;
    const params = morphoParams(quote!);
    if (morpho && params && supplyShares > 0n) {
      const assets = withdrawAmount && withdrawAmount > 0n ? withdrawAmount : 0n;
      const shares = assets === 0n ? supplyShares : 0n;
      await send('withdraw', {
        address: MORPHO_BLUE,
        abi: morphoAbi,
        functionName: 'withdraw',
        args: [params, assets, shares, address, address],
        chainId: quote!.chainId,
      });
      return;
    }
    if (aave && withdrawAmount && withdrawAmount > 0n && !aaveHasDebt) {
      await send('withdraw', {
        address: aave.pool,
        abi: aavePoolAbi,
        functionName: 'withdraw',
        args: [quote!.assetAddress, withdrawAmount, address],
        chainId: quote!.chainId,
      });
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Lend {quote.assetSymbol} on {protocolLabel(quote.protocol)}</p>
            <p className="text-xs text-muted-foreground">You earn {formatApr(quote.supplyApr)}. Borrowers of this asset pay {formatApr(quote.borrowApr)}.</p>
          </div>
        </div>
          <div className="rounded-lg border bg-muted/40 px-3 py-3">
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
              </>
            )}
            {otherAsset && otherBalance !== undefined && otherBalance > 0n && (
              <p className="mt-2 text-xs text-muted-foreground">
                You also hold {formatToken(otherBalance, otherAsset.decimals)} {quote.assetSymbol} on {chainLabel(otherAsset.chainId)}.
              </p>
            )}
          </div>
          <UsdAmountField
          label={`Lend ${quote.assetSymbol}`}
          symbol={quote.assetSymbol}
          decimals={quote.assetDecimals}
          priceUsd={quote.priceUsd}
          balance={balance === undefined ? undefined : walletBalance}
          percents={[25, 50, 100]}
          epoch={supplyEpoch}
          invalid={tooBig}
          onAmount={setAmount}
        />
        {stale && <p className="text-xs font-medium text-orange-500">Rates are older than 3 minutes. Refresh before lending.</p>}
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
        ) : tooBig ? (
          <Button className="h-12 w-full" disabled>Insufficient {quote.assetSymbol}</Button>
        ) : step === 'reset' ? (
          <Button className="h-12 w-full bg-indigo-600 text-white" disabled={isBusy || stale} onClick={() => void approve(0n)}>{isAwaitingWallet ? 'Confirm in wallet…' : isBusy ? 'Confirming…' : 'Reset approval'}</Button>
        ) : step === 'approve' ? (
          <Button className="h-12 w-full bg-indigo-600 text-white" disabled={isBusy || stale || !amount} onClick={() => amount && void approve(amount)}>{isAwaitingWallet ? 'Confirm in wallet…' : isBusy ? 'Confirming…' : `Approve ${quote.assetSymbol}`}</Button>
        ) : (
          <Button className="h-12 w-full bg-blue-600 text-white hover:bg-blue-700" disabled={isBusy || stale || !amount || amount <= 0n} onClick={() => void supply()}>
            {isAwaitingWallet ? 'Confirm in wallet…' : isBusy ? 'Confirming…' : 'Lend'}
          </Button>
        )}
        {isConnected && <FeeBreakdown quote={quote} actions={[...(step !== 'none' ? ['approve'] : []), 'supply', 'withdraw']} />}

        {aave && suppliedBalance > 0n && (
          <Button variant="outline" className="h-10 w-full" disabled={isBusy} onClick={() => void send('isolate', {
            address: aave.pool,
            abi: aavePoolAbi,
            functionName: 'setUserUseReserveAsCollateral',
            args: [quote.assetAddress, false],
            chainId: quote.chainId,
          })}>
            Keep this deposit out of collateral
          </Button>
        )}

        <div className="space-y-2 border-t pt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">Withdraw</span>
            <span className="text-xs text-muted-foreground">
              {aave ? `Supplied ${formatToken(suppliedBalance, quote.assetDecimals)}${price > 0 ? ` · ${formatUsdExact(tokenAmountUsd(suppliedBalance, quote.assetDecimals, price) ?? 0)}` : ''}` : supplyShares > 0n ? 'Morpho supply is open' : 'No supply yet'}
            </span>
          </div>
          {aave && (
            <UsdAmountField
              label={`Withdraw ${quote.assetSymbol}`}
              symbol={quote.assetSymbol}
              decimals={quote.assetDecimals}
              priceUsd={quote.priceUsd}
              balance={suppliedBalance}
              balanceLabel="Supplied"
              epoch={withdrawEpoch}
              invalid={withdrawTooBig}
              onAmount={setWithdrawAmount}
            />
          )}
          {aaveHasDebt && <p className="text-xs text-orange-500">This Aave pool still has debt. Repay it before withdrawing collateral-backed BTC.</p>}
          <Button variant="outline" className="h-11 w-full" disabled={isBusy || wrongChain || !isConnected || (Boolean(aave) && (aaveHasDebt || !withdrawAmount || withdrawAmount <= 0n || withdrawTooBig)) || (Boolean(morpho) && supplyShares === 0n)} onClick={() => void withdraw()}>
            {morpho && !withdrawAmount ? 'Withdraw full Morpho supply' : 'Withdraw'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
