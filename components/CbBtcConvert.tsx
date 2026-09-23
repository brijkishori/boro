'use client';

import { useAccount, useReadContracts } from 'wagmi';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import CoinbaseTransferButton from '@/components/CoinbaseTransferButton';
import { erc20Abi } from '@/lib/abi';
import { formatToken } from '@/lib/amount';
import { CHAINS, chainLabel, type ChainId } from '@/lib/protocol';

const COINBASE_URL = 'https://www.coinbase.com/cbbtc';
const HELP_URL = 'https://help.coinbase.com/coinbase/trading-and-funding/sending-or-receiving-cryptocurrency/coinbase-wrapped-btc';

function token(chainId: ChainId, symbol: string) {
  const match = CHAINS[chainId].btc.find((item) => item.symbol === symbol);
  if (!match) throw new Error(`Missing ${symbol} on chain ${chainId}`);
  return match;
}

function uniswapUrl(chain: 'base' | 'ethereum', input: string, output: string) {
  return `https://app.uniswap.org/swap?chain=${chain}&inputCurrency=${input}&outputCurrency=${output}`;
}

const BASE_CBBTC = token(8453, 'cbBTC');
const BASE_TBTC = token(8453, 'tBTC');
const ETH_CBBTC = token(1, 'cbBTC');
const ETH_TBTC = token(1, 'tBTC');
const ETH_WBTC = token(1, 'WBTC');

export default function CbBtcConvert() {
  const { address, isConnected } = useAccount();
  const { data } = useReadContracts({
    contracts: address
      ? [
          { address: BASE_CBBTC.address, abi: erc20Abi, functionName: 'balanceOf', args: [address], chainId: 8453 },
          { address: ETH_CBBTC.address, abi: erc20Abi, functionName: 'balanceOf', args: [address], chainId: 1 },
          { address: BASE_TBTC.address, abi: erc20Abi, functionName: 'balanceOf', args: [address], chainId: 8453 },
          { address: ETH_TBTC.address, abi: erc20Abi, functionName: 'balanceOf', args: [address], chainId: 1 },
          { address: ETH_WBTC.address, abi: erc20Abi, functionName: 'balanceOf', args: [address], chainId: 1 },
        ]
      : [],
    query: { enabled: Boolean(address), refetchInterval: 20_000 },
  });

  const balance = (index: number, decimals: number) => {
    const value = data?.[index]?.result;
    return typeof value === 'bigint' ? formatToken(value, decimals) : '—';
  };
  const raw = (index: number) => {
    const value = data?.[index]?.result;
    return typeof value === 'bigint' ? value : 0n;
  };

  async function copyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    toast.success('Wallet address copied');
  }

  const swaps = [
    { label: 'Base tBTC', amount: balance(2, BASE_TBTC.decimals), held: raw(2) > 0n, href: uniswapUrl('base', BASE_TBTC.address, BASE_CBBTC.address) },
    { label: 'Ethereum tBTC', amount: balance(3, ETH_TBTC.decimals), held: raw(3) > 0n, href: uniswapUrl('ethereum', ETH_TBTC.address, ETH_CBBTC.address) },
    { label: 'Ethereum WBTC', amount: balance(4, ETH_WBTC.decimals), held: raw(4) > 0n, href: uniswapUrl('ethereum', ETH_WBTC.address, ETH_CBBTC.address) },
  ];

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">Get cbBTC</p>
          <p className="text-sm font-bold">Convert Bitcoin to cbBTC at Coinbase, 1:1</p>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Native BTC stays on Bitcoin until you send it from a Coinbase account to this wallet on Base or Ethereum. Coinbase delivers cbBTC 1:1. This app never creates a Bitcoin deposit address and never holds the BTC.
        </p>
        {!isConnected || !address ? (
          <p className="text-xs font-medium">Connect the wallet that should receive cbBTC.</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 text-[11px]">{address}</code>
              <Button type="button" size="sm" variant="outline" onClick={() => void copyAddress()}>Copy</Button>
            </div>
            <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
              <li>Deposit BTC from your Bitcoin wallet into your own Coinbase account.</li>
              <li>In Coinbase, open Transfer, then Send crypto, then Bitcoin.</li>
              <li>Choose Base, paste this address, and send. Ethereum works too and uses the same address. Base is the cheaper network.</li>
              <li>cbBTC shows up on the network you chose. Send and receive is unavailable in Canada, Georgia, and Japan.</li>
            </ol>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border p-2">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">{chainLabel(8453)} cbBTC</p>
                <p className="font-bold">{balance(0, BASE_CBBTC.decimals)}</p>
              </div>
              <div className="rounded-lg border p-2">
                <p className="text-[10px] font-semibold uppercase text-muted-foreground">{chainLabel(1)} cbBTC</p>
                <p className="font-bold">{balance(1, ETH_CBBTC.decimals)}</p>
              </div>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {isConnected && <CoinbaseTransferButton className="h-8 bg-blue-600 px-3 text-xs text-white hover:bg-blue-700" />}
          <Button asChild size="sm" variant="outline">
            <a href={COINBASE_URL} target="_blank" rel="noreferrer">Open Coinbase cbBTC</a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={HELP_URL} target="_blank" rel="noreferrer">Conversion steps</a>
          </Button>
        </div>
        <div className="space-y-2 border-t pt-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Need tBTC instead? Use Get tBTC above to swap cbBTC or WBTC in this app. The links below still swap into cbBTC on Uniswap.
          </p>
          <div className="flex flex-wrap gap-2">
            {swaps.map((swap) => (
              <Button key={swap.label} asChild size="sm" variant="outline">
                <a href={swap.href} target="_blank" rel="noreferrer">
                  {swap.label}{isConnected && swap.held ? ` · ${swap.amount}` : ''}
                </a>
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
