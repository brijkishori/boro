'use client';

import { useEffect, useRef, useState } from 'react';
import { formatUnits } from 'viem';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatToken, formatUsdExact, parseAmount, tokenAmountUsd, tokenPriceUsd, usdToToken } from '@/lib/amount';

type Unit = 'token' | 'usd';

export default function UsdAmountField({
  label,
  symbol,
  decimals,
  priceUsd,
  balance,
  balanceLabel = 'Wallet',
  percents = [25, 50, 75, 100],
  epoch = 0,
  defaultUnit = 'usd',
  pinned,
  invalid = false,
  disabled = false,
  onAmount,
  onEdit,
  onPercent,
  percentLabel,
}: {
  label: string;
  symbol: string;
  decimals: number;
  priceUsd: number;
  balance?: bigint;
  balanceLabel?: string;
  percents?: number[];
  epoch?: number;
  defaultUnit?: Unit;
  pinned?: bigint;
  invalid?: boolean;
  disabled?: boolean;
  onAmount: (amount: bigint | null) => void;
  onEdit?: () => void;
  onPercent?: (percent: number, amount: bigint) => void;
  percentLabel?: (percent: number) => string;
}) {
  const price = tokenPriceUsd(symbol, priceUsd);
  const [unit, setUnit] = useState<Unit>(defaultUnit);
  const [text, setText] = useState('');
  const exact = useRef<bigint | null>(null);
  const pickedUnit = useRef(false);

  useEffect(() => {
    setText('');
    exact.current = null;
  }, [epoch]);

  useEffect(() => {
    if (pickedUnit.current || defaultUnit !== 'usd' || unit === 'usd' || price <= 0) return;
    setUnit('usd');
  }, [defaultUnit, price, unit]);

  useEffect(() => {
    if (unit !== 'usd' || exact.current !== null || text === '' || text === '.' || price <= 0) return;
    onAmount(usdToToken(text, decimals, price));
  }, [decimals, onAmount, price, text, unit]);

  useEffect(() => {
    if (pinned === undefined) return;
    exact.current = pinned;
    const usd = tokenAmountUsd(pinned, decimals, price);
    setText(unit === 'usd' && usd !== null ? usd.toFixed(2) : formatUnits(pinned, decimals));
    onAmount(pinned);
  }, [pinned, unit, decimals, price, onAmount]);

  function resolvedAmount() {
    if (exact.current !== null) return exact.current;
    if (text === '' || text === '.') return null;
    return unit === 'usd' ? usdToToken(text, decimals, price) : parseAmount(text, decimals);
  }

  function show(amount: bigint, nextUnit: Unit) {
    exact.current = amount;
    if (nextUnit === 'usd') {
      const usd = tokenAmountUsd(amount, decimals, price);
      setText(usd === null ? '' : usd.toFixed(2));
      return;
    }
    setText(formatUnits(amount, decimals));
  }

  function edit(next: string) {
    if (disabled) return;
    if (next !== '' && !/^\d*\.?\d*$/.test(next)) return;
    exact.current = null;
    setText(next);
    onEdit?.();
    if (next === '' || next === '.') {
      onAmount(null);
      return;
    }
    onAmount(unit === 'usd' ? usdToToken(next, decimals, price) : parseAmount(next, decimals));
  }

  function chooseUnit(next: Unit) {
    if (next === unit) return;
    if (next === 'usd' && price <= 0) return;
    pickedUnit.current = true;
    const current = resolvedAmount();
    setUnit(next);
    if (current === null) {
      setText('');
      return;
    }
    show(current, next);
    onAmount(current);
  }

  function pick(percent: number) {
    if (balance === undefined) return;
    const slice = (balance * BigInt(percent)) / 100n;
    show(slice, unit);
    if (onPercent) onPercent(percent, slice);
    else onAmount(slice);
  }

  const amount = resolvedAmount();
  const usd = amount === null ? null : tokenAmountUsd(amount, decimals, price);
  const fraction = text.includes('.') ? (text.split('.')[1] ?? '') : '';
  const maxDecimals = unit === 'usd' ? 2 : decimals;
  const tooPrecise = fraction.length > maxDecimals;
  const balanceUsd = balance === undefined ? null : tokenAmountUsd(balance, decimals, price);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{label}</span>
        <div className="grid grid-cols-2 gap-0.5 rounded-md bg-muted p-0.5">
          <button type="button" className={`h-7 rounded px-2 text-[11px] font-bold ${unit === 'token' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} onClick={() => chooseUnit('token')}>{symbol}</button>
          <button type="button" className={`h-7 rounded px-2 text-[11px] font-bold ${unit === 'usd' ? 'bg-background shadow-sm' : 'text-muted-foreground'}`} disabled={price <= 0} onClick={() => chooseUnit('usd')}>USD</button>
        </div>
      </div>
      {balance !== undefined && (
        <p className="text-xs text-muted-foreground">
          {balanceLabel} {formatToken(balance, decimals)} {symbol}
          {balanceUsd !== null ? ` · ${formatUsdExact(balanceUsd)}` : ''}
        </p>
      )}
      <Input
        value={text}
        inputMode="decimal"
        placeholder="0.00"
        disabled={disabled}
        onChange={(event) => edit(event.target.value)}
        className={`h-12 text-lg font-bold ${invalid ? 'border-red-500' : ''}`}
      />
      {tooPrecise ? (
        <p className="text-xs font-medium text-orange-500">Use at most {maxDecimals} decimal places.</p>
      ) : amount !== null && amount > 0n && usd !== null ? (
        <p className="text-xs text-muted-foreground">
          {unit === 'usd'
            ? `Sends ${formatToken(amount, decimals)} ${symbol}, worth ${formatUsdExact(usd)}.`
            : `Worth ${formatUsdExact(usd)}.`}
          {symbol !== 'USDC' ? ` Price ${formatUsdExact(price)} per ${symbol}.` : ''}
        </p>
      ) : price <= 0 ? (
        <p className="text-xs text-muted-foreground">The dollar value appears when the BTC price loads.</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {unit === 'usd' ? `Type a dollar amount. It converts to ${symbol}.` : `Type ${symbol}, or switch to USD.`}
        </p>
      )}
      {percents.length > 0 && (
        <div className="flex gap-2">
          {percents.map((percent) => (
            <Button
              key={percent}
              type="button"
              variant="outline"
              size="sm"
              className="h-8 flex-1 text-xs font-bold"
              disabled={disabled || balance === undefined || balance === 0n}
              onClick={() => pick(percent)}
            >
              {percentLabel ? percentLabel(percent) : percent === 100 ? 'MAX' : `${percent}%`}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
