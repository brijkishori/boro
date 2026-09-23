'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { maxUint256 } from 'viem';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import UsdAmountField from '@/components/UsdAmountField';
import WrongNetworkActions from '@/components/WrongNetworkActions';
import GasNotice from '@/components/GasNotice';
import FeeBreakdown from '@/components/FeeBreakdown';
import { GAS_UNITS, useGasCheck } from '@/components/useGasCheck';
import { usePosition } from '@/components/usePosition';
import { adapterFor, approveCall } from '@/lib/adapters';
import { erc20Abi } from '@/lib/abi';
import { approvalStep, formatToken, formatUsd, formatUsdExact, tokenAmountUsd } from '@/lib/amount';
import {
  chainLabel,
  isChainId,
  isVenueSafe,
  venueOnChain,
  venueSpender,
  type Venue,
} from '@/lib/protocol';
import { useSendTx } from './useSendTx';
import { useAudit } from './useAudit';
import { LoanLedger } from './LoanLedger';
import { asBig, episodeKey, findOpenEpisode, formatDuration } from '@/lib/audit';

export default function RepayFlow({ quote, venues = [], onSelect }: { quote: Venue | null; venues?: Venue[]; onSelect?: (id: string) => void }) {
  const { address, chain, isConnected } = useAccount();
  const [repayAmount, setRepayAmount] = useState<bigint | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState<bigint | null>(null);
  const [repayEpoch, setRepayEpoch] = useState(0);
  const [withdrawEpoch, setWithdrawEpoch] = useState(0);
  const [maxRepay, setMaxRepay] = useState(false);
  const [partialPin, setPartialPin] = useState<bigint | undefined>();
  const { send, isBusy, isAwaitingWallet, confirmed } = useSendTx();
  const { episodes, events, seedOpen } = useAudit(address);

  const safe = quote !== null && isVenueSafe(quote) && quote.action === 'borrow';
  const spender = safe && quote ? venueSpender(quote, 'loan') : null;
  const enabled = Boolean(address && safe);
  const gas = useGasCheck(quote?.chainId, GAS_UNITS.write);
  const marketChainId = quote?.chainId;
  const { snapshot, refetch: refetchPosition } = usePosition(safe ? quote : null, address, enabled);

  const { data: usdcBalance, isError: usdcError, refetch: refetchUsdc } = useReadContract({
    address: quote?.loanAddress,
    chainId: marketChainId,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled, refetchInterval: 20_000, placeholderData: (previous) => previous },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: quote?.loanAddress,
    chainId: marketChainId,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && spender ? [address, spender] : undefined,
    query: { enabled: Boolean(enabled && spender), refetchInterval: 20_000, placeholderData: (previous) => previous },
  });
  const lastAllowance = useRef(0n);
  if (typeof allowance === 'bigint') lastAllowance.current = allowance;
  const ledgerKey = quote && address ? episodeKey(address, quote) : '';
  const episode = ledgerKey ? findOpenEpisode(episodes, ledgerKey) : null;
  const closedEpisode = ledgerKey ? episodes.find((item) => item.key === ledgerKey && item.status === 'closed') ?? null : null;
  const lastRepay = events.find((event) => event.action === 'repay' && event.episodeKey === ledgerKey);
  const siblings = quote?.aave
    ? venues.filter((venue) => venue.aave && venue.chainId === quote.chainId && venue.id !== quote.id)
    : [];
  const { data: siblingBalances } = useReadContracts({
    contracts: address
      ? siblings.map((venue) => ({ address: venue.aave!.aToken, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address] as const, chainId: venue.chainId }))
      : [],
    query: { enabled: Boolean(address && siblings.length > 0 && snapshot.collateral === 0n) },
  });
  const heldElsewhere = snapshot.collateral === 0n
    ? siblings.find((_, index) => {
        const value = siblingBalances?.[index]?.result;
        return typeof value === 'bigint' && value > 0n;
      })
    : undefined;

  useEffect(() => {
    if (heldElsewhere && snapshot.ready && snapshot.collateral === 0n && snapshot.debt === 0n && onSelect) {
      onSelect(heldElsewhere.id);
    }
  }, [heldElsewhere, onSelect, snapshot.collateral, snapshot.debt, snapshot.ready]);

  const debt = snapshot.debt;
  const cappedDebt = debt;

  useEffect(() => {
    if (!confirmed) return;
    if (confirmed.action === 'repay') {
      setRepayAmount(null);
      setRepayEpoch((value) => value + 1);
      setMaxRepay(false);
      setPartialPin(undefined);
    }
    if (confirmed.action === 'withdraw') {
      setWithdrawAmount(null);
      setWithdrawEpoch((value) => value + 1);
    }
    void refetchUsdc();
    void refetchAllowance();
    void refetchPosition();
  }, [confirmed, refetchAllowance, refetchPosition, refetchUsdc]);

  useEffect(() => {
    if (!quote || snapshot.debt <= 0n) return;
    seedOpen([{ venue: quote, snapshot }]);
  }, [quote, seedOpen, snapshot]);

  if (!quote || !safe || !spender) {
    return <p className="text-sm text-muted-foreground">Choose the borrow market you want to repay.</p>;
  }

  const wallet = usdcBalance ?? 0n;
  const collateral = snapshot.collateral;
  const closingDebt = maxRepay || (repayAmount !== null && cappedDebt > 0n && repayAmount >= cappedDebt);
  const neededApproval = closingDebt ? cappedDebt : (repayAmount ?? 0n);
  const approveAmount = closingDebt ? maxUint256 : neededApproval;
  const step = approvalStep(typeof allowance === 'bigint' ? allowance : lastAllowance.current, neededApproval);
  const wrongChain = isConnected && chain?.id !== quote.chainId;
  const connectedChainId = chain?.id ?? 0;
  const walletChainId = isChainId(connectedChainId) ? connectedChainId : null;
  const alternate = wrongChain && walletChainId ? venueOnChain(venues, quote, walletChainId) : null;
  const repayTooBig = repayAmount !== null && repayAmount > wallet;
  const shares = snapshot.extra?.shares ?? 0n;
  const shortfall = cappedDebt > wallet ? cappedDebt - wallet : 0n;
  const withdrawMax = snapshot.withdrawMax;
  const hasDebt = snapshot.debt > 0n;
  const withdrawTooBig = withdrawAmount !== null && withdrawAmount > withdrawMax;

  function ledger(amount: bigint, amountKind: 'loan' | 'asset' = 'loan', closing = false) {
    return {
      wallet: address!,
      venue: quote!,
      amount,
      amountUsd: tokenAmountUsd(amount, amountKind === 'loan' ? quote!.loanDecimals : quote!.assetDecimals, amountKind === 'loan' ? 1 : quote!.priceUsd),
      amountKind,
      debt: snapshot.debt,
      collateral: snapshot.collateral,
      healthFactor: snapshot.healthFactor,
      closing,
    };
  }

  async function approve(amount: bigint) {
    await send(amount === 0n ? 'reset' : 'approve', approveCall(quote!, spender!, amount, 'loan'), ledger(neededApproval));
  }

  async function repay() {
    if (!address || !repayAmount || repayAmount <= 0n) return;
    const full = (maxRepay || repayAmount >= cappedDebt) && wallet > cappedDebt + cappedDebt / 10_000n;
    const call = adapterFor(quote!).buildRepay(quote!, address, repayAmount, full, { shares });
    if (call) await send('repay', call, ledger(repayAmount, 'loan', full));
  }

  async function withdraw() {
    if (!address || !withdrawAmount || withdrawAmount <= 0n || withdrawAmount > withdrawMax) return;
    const call = adapterFor(quote!).buildWithdraw(quote!, address, withdrawAmount, 'borrow', { shares });
    if (call) await send('withdraw', call, ledger(withdrawAmount, 'asset'));
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="rounded-lg border bg-muted/40 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">USDC in your wallet · {chainLabel(quote.chainId)}</p>
            {!isConnected ? (
              <p className="text-lg font-bold">Connect a wallet to see USDC</p>
            ) : usdcError ? (
              <p className="text-lg font-bold">Could not read USDC on {chainLabel(quote.chainId)}</p>
            ) : usdcBalance === undefined ? (
              <p className="text-lg font-bold">Reading USDC…</p>
            ) : (
              <>
                <p className="text-2xl font-bold tracking-tight">{formatToken(wallet, quote.loanDecimals)} USDC</p>
                <p className="text-sm text-muted-foreground">{formatUsdExact(tokenAmountUsd(wallet, quote.loanDecimals, 1) ?? 0)}</p>
              </>
            )}
          </div>
          {(cappedDebt > 0n || closedEpisode) && (
            <div className="rounded-lg border px-3 py-2">
              <p className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Principal vs interest</p>
              {cappedDebt > 0n ? (
                <LoanLedger episode={episode} debt={cappedDebt} decimals={quote.loanDecimals} compact />
              ) : closedEpisode ? (
                <p className="text-xs font-semibold">
                  This loan is closed. Interest paid over {formatDuration(closedEpisode.openedAt, closedEpisode.closedAt)}:{' '}
                  {formatToken(asBig(closedEpisode.interestPaid), quote.loanDecimals)} USDC
                </p>
              ) : null}
              {lastRepay?.interestPaid && lastRepay.principalPaid && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Last repay: {formatToken(asBig(lastRepay.interestPaid), quote.loanDecimals)} USDC interest, {formatToken(asBig(lastRepay.principalPaid), quote.loanDecimals)} USDC principal
                  {lastRepay.closing ? ' · loan closed' : ''}
                </p>
              )}
            </div>
          )}
          <UsdAmountField
            label="Repay USDC"
            symbol="USDC"
            decimals={quote.loanDecimals}
            priceUsd={1}
            balance={cappedDebt}
            balanceLabel="Debt"
            percents={[25, 50, 75, 100]}
            percentLabel={(percent) => (percent === 100 ? 'Clear debt' : `${percent}%`)}
            epoch={repayEpoch}
            pinned={maxRepay ? undefined : partialPin}
            invalid={repayTooBig}
            disabled={cappedDebt === 0n}
            onAmount={setRepayAmount}
            onEdit={() => {
              setMaxRepay(false);
              setPartialPin(undefined);
            }}
            onPercent={(percent, slice) => {
              if (percent === 100 && shortfall > 0n) {
                setMaxRepay(false);
                setPartialPin(wallet);
                setRepayAmount(wallet);
                return;
              }
              setPartialPin(undefined);
              setRepayAmount(slice);
              setMaxRepay(percent === 100);
            }}
          />
          {isConnected && usdcBalance !== undefined && cappedDebt > 0n && shortfall > 0n && (
            <p className="text-xs leading-relaxed text-orange-600 dark:text-orange-400">
              Interest has grown the debt to {formatToken(cappedDebt, quote.loanDecimals)} USDC, and the wallet holds {formatToken(wallet, quote.loanDecimals)} USDC.
              {wallet > 0n
                ? ` Clear debt repays all ${formatToken(wallet, quote.loanDecimals)} USDC now and leaves ${formatToken(shortfall, quote.loanDecimals)} USDC owed. Add a little USDC on ${chainLabel(quote.chainId)} to clear it completely.`
                : ` Add USDC on ${chainLabel(quote.chainId)} to repay.`}
            </p>
          )}
          {(quote.protocol === 'aave' || quote.protocol === 'spark') && (
            <p className="text-xs text-muted-foreground">Pool debt {formatUsd(tokenAmountUsd(cappedDebt, quote.loanDecimals, 1) ?? 0)}</p>
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
            <GasNotice chainId={quote.chainId} symbol={'USDC'} neededEth={gas.neededEth} balanceEth={gas.balanceEth} />
          ) : repayTooBig ? (
            <Button className="h-12 w-full" disabled>Not enough USDC</Button>
          ) : step === 'approve' ? (
            <Button className="h-12 w-full bg-indigo-600 text-white" disabled={isBusy || neededApproval === 0n} onClick={() => void approve(approveAmount)}>{isAwaitingWallet ? 'Confirm in wallet…' : isBusy ? 'Confirming…' : 'Approve USDC'}</Button>
          ) : (
            <Button className="h-12 w-full bg-blue-600 text-white" disabled={isBusy || cappedDebt === 0n || !repayAmount || repayAmount <= 0n} onClick={() => void repay()}>
              {isAwaitingWallet ? 'Confirm in wallet…' : isBusy ? 'Confirming…' : maxRepay ? 'Repay full debt' : 'Repay'}
            </Button>
          )}
          {isConnected && (
            <FeeBreakdown
              quote={quote}
              actions={[...(step !== 'none' ? ['approve'] : []), 'repay', 'withdraw']}
              interest={{ apr: quote.borrowApr, principalUsd: tokenAmountUsd(cappedDebt, quote.loanDecimals, 1) ?? 0, label: 'Interest while debt stays open' }}
            />
          )}
          {(quote.protocol === 'aave' || quote.protocol === 'spark') && <p className="text-[11px] leading-relaxed text-muted-foreground">Shared-pool debt is reported for the whole account on this network. The repay amount is capped by that reported debt.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <UsdAmountField
            label={`Withdraw ${quote.assetSymbol}`}
            symbol={quote.assetSymbol}
            decimals={quote.assetDecimals}
            priceUsd={quote.priceUsd}
            balance={withdrawMax}
            balanceLabel={hasDebt ? 'Safe to withdraw' : 'Supplied'}
            epoch={withdrawEpoch}
            invalid={withdrawTooBig}
            disabled={withdrawMax === 0n}
            onAmount={setWithdrawAmount}
          />
          {hasDebt && collateral > 0n && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {formatToken(collateral, quote.assetDecimals)} {quote.assetSymbol} is supplied. While debt is open, the app lets you withdraw only what keeps the loan inside 90% of the pool&apos;s borrowing limit. Repay the debt to withdraw everything.
            </p>
          )}
          <Button className="h-12 w-full bg-indigo-600 text-white" disabled={isBusy || wrongChain || !isConnected || withdrawMax === 0n || !withdrawAmount || withdrawAmount <= 0n || withdrawTooBig} onClick={() => void withdraw()}>
            {isAwaitingWallet ? 'Confirm in wallet…' : isBusy ? 'Confirming…' : withdrawMax === 0n && collateral > 0n ? 'Repay debt to withdraw' : `Withdraw ${quote.assetSymbol}`}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
