'use client';

import { useEffect, useState } from 'react';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { formatUnits, maxUint256 } from 'viem';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import UsdAmountField from '@/components/UsdAmountField';
import WrongNetworkActions from '@/components/WrongNetworkActions';
import GasNotice from '@/components/GasNotice';
import FeeBreakdown from '@/components/FeeBreakdown';
import { GAS_UNITS, useGasCheck } from '@/components/useGasCheck';
import { aavePoolAbi, erc20Abi, morphoAbi, oracleAbi } from '@/lib/abi';
import { approvalStep, formatToken, formatUsd, formatUsdExact, tokenAmountUsd } from '@/lib/amount';
import {
  MORPHO_BLUE,
  chainLabel,
  isChainId,
  isVenueSafe,
  morphoParams,
  venueOnChain,
  venueSpender,
  type Venue,
} from '@/lib/protocol';
import { aaveSafeWithdraw, morphoDebtAssets, morphoSafeWithdraw, withRepayBuffer } from '@/lib/risk';
import { useSendTx } from './useSendTx';

export default function RepayFlow({ quote, venues = [], onSelect }: { quote: Venue | null; venues?: Venue[]; onSelect?: (id: string) => void }) {
  const { address, chain, isConnected } = useAccount();
  const [repayAmount, setRepayAmount] = useState<bigint | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState<bigint | null>(null);
  const [repayEpoch, setRepayEpoch] = useState(0);
  const [withdrawEpoch, setWithdrawEpoch] = useState(0);
  const [maxRepay, setMaxRepay] = useState(false);
  const [partialPin, setPartialPin] = useState<bigint | undefined>();
  const { send, isBusy, isAwaitingWallet, confirmed } = useSendTx();

  const safe = quote !== null && isVenueSafe(quote) && quote.action === 'borrow';
  const spender = safe && quote ? venueSpender(quote) : null;
  const morpho = safe && quote?.protocol === 'morpho' ? quote.morpho : undefined;
  const aave = safe && quote?.protocol === 'aave' ? quote.aave : undefined;
  const enabled = Boolean(address && safe);
  const gas = useGasCheck(quote?.chainId, GAS_UNITS.write);
  const marketChainId = quote?.chainId;

  const { data: usdcBalance, isError: usdcError, refetch: refetchUsdc } = useReadContract({
    address: quote?.loanAddress,
    chainId: marketChainId,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled, refetchInterval: 20_000 },
  });
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: quote?.loanAddress,
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
  const { data: oraclePrice } = useReadContract({
    address: morpho?.oracle,
    chainId: marketChainId,
    abi: oracleAbi,
    functionName: 'price',
    query: { enabled: Boolean(enabled && morpho), refetchInterval: 20_000 },
  });
  const { data: variableDebt, refetch: refetchDebt } = useReadContract({
    address: aave?.variableDebtToken,
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
  const { data: collateralBalance, refetch: refetchCollateral } = useReadContract({
    address: aave?.aToken,
    chainId: marketChainId,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(enabled && aave), refetchInterval: 20_000 },
  });

  const siblings = aave && quote
    ? venues.filter((venue) => venue.protocol === 'aave' && venue.chainId === quote.chainId && venue.id !== quote.id && venue.aave)
    : [];
  const { data: siblingBalances } = useReadContracts({
    contracts: address
      ? siblings.map((venue) => ({ address: venue.aave!.aToken, abi: erc20Abi, functionName: 'balanceOf' as const, args: [address] as const, chainId: venue.chainId }))
      : [],
    query: { enabled: Boolean(address && siblings.length > 0 && collateralBalance === 0n) },
  });
  const heldElsewhere = collateralBalance === 0n
    ? siblings.find((_, index) => {
        const value = siblingBalances?.[index]?.result;
        return typeof value === 'bigint' && value > 0n;
      })
    : undefined;

  useEffect(() => {
    if (heldElsewhere && onSelect) onSelect(heldElsewhere.id);
  }, [heldElsewhere, onSelect]);

  const debt = morpho
    ? morphoDebtAssets(position?.[1] ?? 0n, market?.[2] ?? 0n, market?.[3] ?? 0n)
    : (variableDebt ?? 0n);
  const debtCap = account ? (account[1] / 100n) * 105n / 100n : debt;
  const cappedDebt = aave && debt > debtCap ? debtCap : debt;

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
    void refetchMarket();
    void refetchDebt();
    void refetchAccount();
    void refetchCollateral();
  }, [confirmed, refetchAccount, refetchAllowance, refetchCollateral, refetchDebt, refetchMarket, refetchPosition, refetchUsdc]);

  if (!quote || !safe || !spender) {
    return <p className="text-sm text-muted-foreground">Choose the borrow market you want to repay.</p>;
  }

  const wallet = usdcBalance ?? 0n;
  const collateral = morpho ? (position?.[2] ?? 0n) : (collateralBalance ?? 0n);
  const neededApproval = maxRepay || (repayAmount !== null && repayAmount >= cappedDebt) ? withRepayBuffer(cappedDebt) : (repayAmount ?? 0n);
  const step = approvalStep(allowance ?? 0n, neededApproval);
  const wrongChain = isConnected && chain?.id !== quote.chainId;
  const connectedChainId = chain?.id ?? 0;
  const walletChainId = isChainId(connectedChainId) ? connectedChainId : null;
  const alternate = wrongChain && walletChainId ? venueOnChain(venues, quote, walletChainId) : null;
  const repayTooBig = repayAmount !== null && repayAmount > wallet;
  const shares = position?.[1] ?? 0n;
  const shortfall = cappedDebt > wallet ? cappedDebt - wallet : 0n;
  const withdrawMax = morpho
    ? morphoSafeWithdraw(collateral, debt, oraclePrice ?? 0n, BigInt(morpho.lltv))
    : aaveSafeWithdraw(collateral, quote.assetDecimals, quote.priceUsd, account?.[0] ?? 0n, account?.[1] ?? 0n, account?.[4] ?? 0n);
  const hasDebt = morpho ? shares > 0n : Boolean(account && account[1] > 0n);
  const withdrawTooBig = withdrawAmount !== null && withdrawAmount > withdrawMax;

  async function approve(amount: bigint) {
    await send(amount === 0n ? 'reset' : 'approve', {
      address: quote!.loanAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender!, amount],
      chainId: quote!.chainId,
    });
  }

  async function repay() {
    if (!address) return;
    const params = morphoParams(quote!);
    if (morpho && params) {
      const full = maxRepay || (repayAmount !== null && repayAmount >= cappedDebt);
      await send('repay', {
        address: MORPHO_BLUE,
        abi: morphoAbi,
        functionName: 'repay',
        args: [params, full ? 0n : (repayAmount ?? 0n), full ? shares : 0n, address, '0x'],
        chainId: quote!.chainId,
      });
      return;
    }
    if (aave && repayAmount && repayAmount > 0n) {
      const full = (maxRepay || repayAmount >= cappedDebt) && wallet > cappedDebt + cappedDebt / 10_000n;
      const amount = full ? maxUint256 : repayAmount;
      await send('repay', {
        address: aave.pool,
        abi: aavePoolAbi,
        functionName: 'repay',
        args: [quote!.loanAddress, amount, 2n, address],
        chainId: quote!.chainId,
      });
    }
  }

  async function withdraw() {
    if (!address) return;
    const params = morphoParams(quote!);
    if (morpho && params && withdrawAmount && withdrawAmount > 0n && withdrawAmount <= withdrawMax) {
      await send('withdraw', {
        address: MORPHO_BLUE,
        abi: morphoAbi,
        functionName: 'withdrawCollateral',
        args: [params, withdrawAmount, address, address],
        chainId: quote!.chainId,
      });
      return;
    }
    if (aave && withdrawAmount && withdrawAmount > 0n && withdrawAmount <= withdrawMax) {
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
            pinned={maxRepay ? cappedDebt : partialPin}
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
          {aave && (
            <p className="text-xs text-muted-foreground">Pool debt {formatUsd(Number(formatUnits(account?.[1] ?? 0n, 8)))}</p>
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
          ) : step === 'reset' ? (
            <Button className="h-12 w-full bg-indigo-600 text-white" disabled={isBusy} onClick={() => void approve(0n)}>{isAwaitingWallet ? 'Confirm in wallet…' : isBusy ? 'Confirming…' : 'Reset USDC approval'}</Button>
          ) : step === 'approve' ? (
            <Button className="h-12 w-full bg-indigo-600 text-white" disabled={isBusy || neededApproval === 0n} onClick={() => void approve(neededApproval)}>{isAwaitingWallet ? 'Confirm in wallet…' : isBusy ? 'Confirming…' : 'Approve USDC'}</Button>
          ) : (
            <Button className="h-12 w-full bg-blue-600 text-white" disabled={isBusy || cappedDebt === 0n || !repayAmount || repayAmount <= 0n || (Boolean(aave) && !account)} onClick={() => void repay()}>
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
          {aave && <p className="text-[11px] leading-relaxed text-muted-foreground">Aave debt is shared by the whole pool. The repay amount is capped by the pool&apos;s reported debt.</p>}
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
