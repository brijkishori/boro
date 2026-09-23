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
import { usePosition } from '@/components/usePosition';
import { adapterFor, approveCall, isolateCall } from '@/lib/adapters';
import { erc20Abi } from '@/lib/abi';
import { approvalStep, formatApr, formatToken, formatUsdExact, tokenAmountUsd, tokenPriceUsd } from '@/lib/amount';
import {
  chainLabel,
  isChainId,
  isVenueSafe,
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
  const enabled = Boolean(address && safe);
  const { snapshot, refetch: refetchPosition } = usePosition(safe ? quote : null, address, enabled);
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
  }, [confirmed, refetchAllowance, refetchBalance, refetchPosition]);

  if (!quote || !safe || !spender) {
    return <p className="text-sm text-muted-foreground">Choose a lend market above. Lending earns supply APY.</p>;
  }

  const walletBalance = balance ?? 0n;
  const price = tokenPriceUsd(quote.assetSymbol, quote.priceUsd);
  const suppliedBalance = snapshot.collateral;
  const supplyShares = snapshot.extra?.shares ?? 0n;
  const step = approvalStep(allowance ?? 0n, amount ?? 0n);
  const stale = Date.now() - fetchedAt > RATE_MAX_AGE_MS;
  const wrongChain = isConnected && chain?.id !== quote.chainId;
  const connectedChainId = chain?.id ?? 0;
  const walletChainId = isChainId(connectedChainId) ? connectedChainId : null;
  const alternate = wrongChain && walletChainId ? venueOnChain(venues, quote, walletChainId) : null;
  const tooBig = amount !== null && amount > walletBalance;
  const hasDebt = snapshot.debt > 0n;
  const withdrawTooBig = withdrawAmount !== null && withdrawAmount > snapshot.withdrawMax;
  const canIsolate = (quote.protocol === 'aave' || quote.protocol === 'spark') && suppliedBalance > 0n;

  function ledger(value: bigint) {
    return {
      wallet: address!,
      venue: quote!,
      amount: value,
      amountUsd: tokenAmountUsd(value, quote!.assetDecimals, price),
      amountKind: 'asset' as const,
      debt: snapshot.debt,
      collateral: snapshot.collateral,
      healthFactor: snapshot.healthFactor,
    };
  }

  async function approve(value: bigint) {
    await send(value === 0n ? 'reset' : 'approve', approveCall(quote!, spender!, value), ledger(value));
  }

  async function supply() {
    if (!address || !amount || amount <= 0n) return;
    const call = adapterFor(quote!).buildSupply(quote!, address, amount, 'lend');
    if (call) await send('supply', call, ledger(amount));
  }

  async function withdraw() {
    if (!address) return;
    const amountOut = withdrawAmount && withdrawAmount > 0n ? withdrawAmount : suppliedBalance;
    const call = adapterFor(quote!).buildWithdraw(quote!, address, amountOut, 'lend', { shares: supplyShares });
    if (call) await send('withdraw', call, ledger(amountOut));
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

        {canIsolate && isolateCall(quote) && (
          <Button variant="outline" className="h-10 w-full" disabled={isBusy} onClick={() => void send('isolate', isolateCall(quote)!, ledger(0n))}>
            Keep this deposit out of collateral
          </Button>
        )}

        <div className="space-y-2 border-t pt-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold">Withdraw</span>
            <span className="text-xs text-muted-foreground">
              Supplied {formatToken(suppliedBalance, quote.assetDecimals)}{price > 0 ? ` · ${formatUsdExact(tokenAmountUsd(suppliedBalance, quote.assetDecimals, price) ?? 0)}` : ''}
            </span>
          </div>
          <UsdAmountField
            label={`Withdraw ${quote.assetSymbol}`}
            symbol={quote.assetSymbol}
            decimals={quote.assetDecimals}
            priceUsd={quote.priceUsd}
            balance={snapshot.withdrawMax}
            balanceLabel="Safe to withdraw"
            epoch={withdrawEpoch}
            invalid={withdrawTooBig}
            onAmount={setWithdrawAmount}
          />
          {hasDebt && <p className="text-xs text-orange-500">This pool still has debt. Only the amount that keeps the loan inside the 90% safety cap can be withdrawn.</p>}
          <Button variant="outline" className="h-11 w-full" disabled={isBusy || wrongChain || !isConnected || suppliedBalance === 0n || !withdrawAmount || withdrawAmount <= 0n || withdrawTooBig} onClick={() => void withdraw()}>
            Withdraw
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
