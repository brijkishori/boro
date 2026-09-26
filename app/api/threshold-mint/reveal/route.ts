import { encodeFunctionData, getAddress, isAddress } from 'viem';
import { isDepositReceipt, isTbtcMint, tbtcBridgeAbi } from '@/lib/threshold';
import { encodeRevealDeposit, readDepositUtxos, revealedAt } from '@/lib/threshold-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Request must come from this app.' }, { status: 403 });

  let body: { mint?: unknown };
  try {
    body = (await request.json()) as { mint?: unknown };
  } catch {
    return Response.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (!isTbtcMint(body.mint) || !isDepositReceipt(body.mint.receipt) || !isAddress(body.mint.user)) {
    return Response.json({ error: 'Deposit receipt is missing or invalid. Download it before you leave this page.' }, { status: 400 });
  }
  const mint = body.mint;

  try {
    const utxos = await readDepositUtxos(mint.btcAddress);
    const funded = utxos.find((item) => item.value >= mint.minSats);
    if (!funded) {
      return Response.json({ error: 'No Bitcoin has arrived at this deposit address yet.' }, { status: 409 });
    }
    if (await revealedAt(funded)) {
      return Response.json({ error: 'This deposit was already revealed on Ethereum.' }, { status: 409 });
    }
    const tx = await encodeRevealDeposit(getAddress(mint.user), mint.receipt, funded);
    return Response.json({
      to: tx.address,
      data: encodeFunctionData({ abi: tbtcBridgeAbi, functionName: 'revealDeposit', args: tx.args }),
      value: '0',
      chainId: tx.chainId,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not prepare the mint reveal.';
    return Response.json({ error: message }, { status: 502 });
  }
}
