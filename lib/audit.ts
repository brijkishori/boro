import type { Address } from 'viem';
import { formatUnits } from 'viem';
import type { ProtocolId, Venue } from '@/lib/protocol';
import { chainLabel, isChainId, protocolLabel } from '@/lib/protocol';

export const AUDIT_ACTIONS = ['approve', 'reset', 'supply', 'borrow', 'repay', 'withdraw', 'isolate', 'seed', 'swap'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditEvent = {
  hash: string;
  wallet: string;
  chainId: number;
  action: AuditAction;
  at: number;
  protocol: string;
  venueId: string;
  episodeKey: string;
  assetSymbol: string;
  loanSymbol: string;
  amount: string;
  amountUsd: number | null;
  decimals: number;
  borrowApr: number | null;
  supplyApr: number | null;
  priceUsd: number | null;
  healthFactor: number | null;
  collateral: string;
  debt: string;
  feeWei: string;
  ethUsd: number | null;
  closing?: boolean;
  interestPaid?: string;
  principalPaid?: string;
  principalRemaining?: string;
  interestRemaining?: string;
};

export type LoanEpisode = {
  key: string;
  wallet: string;
  protocol: string;
  chainId: number;
  venueId: string;
  assetSymbol: string;
  label: string;
  openedAt: number;
  closedAt: number | null;
  status: 'open' | 'closed';
  principalBorrowed: string;
  principalRemaining: string;
  principalRepaid: string;
  interestPaid: string;
  totalRepaid: string;
  weightedApr: number;
  lastApr: number;
};

export type AuditDocument = {
  v: 1;
  events: AuditEvent[];
};

export type LiveSplit = {
  debt: bigint;
  principalRemaining: bigint;
  interestRemaining: bigint;
  interestPaid: bigint;
  interestSoFar: bigint;
  principalBorrowed: bigint;
  tracked: boolean;
};

export type AuditVenue = Pick<
  Venue,
  | 'id'
  | 'protocol'
  | 'chainId'
  | 'action'
  | 'assetSymbol'
  | 'loanSymbol'
  | 'loanAddress'
  | 'assetDecimals'
  | 'loanDecimals'
  | 'borrowApr'
  | 'supplyApr'
  | 'priceUsd'
>;

export type AuditTxInput = {
  hash: string;
  wallet: string;
  action: AuditAction;
  at: number;
  chainId: number;
  venue: AuditVenue;
  amount: bigint;
  amountUsd?: number | null;
  amountKind?: 'loan' | 'asset';
  debt?: bigint;
  collateral?: bigint;
  healthFactor?: number | null;
  closing?: boolean;
  feeWei?: bigint;
  ethUsd?: number | null;
};

const LOCAL_PREFIX = 'boro:audit:v1:';
const FEE_MIGRATE_KEY = 'boro:audit:fees-migrated:v1';
const FEE_STORE_KEY = 'boro:fees:v1';
export const MAX_AUDIT_EVENTS = 500;
export const AUDIT_ACTIONS_SET = new Set<string>(AUDIT_ACTIONS);

const listeners = new Set<() => void>();
const memory = new Map<string, AuditEvent[]>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function subscribeAudit(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function auditStoreKey(wallet: string) {
  return `audit:${wallet.toLowerCase()}`;
}

export function emptyDocument(): AuditDocument {
  return { v: 1, events: [] };
}

export function episodeKey(wallet: string, venue: AuditVenue) {
  const owner = wallet.toLowerCase();
  if (venue.protocol === 'aave' || venue.protocol === 'spark' || venue.protocol === 'compound') {
    return `${owner}:${venue.protocol}:${venue.chainId}:${venue.loanAddress.toLowerCase()}`;
  }
  return `${owner}:${venue.id}`;
}

export function episodeLabel(protocol: string, assetSymbol: string, chainId: number) {
  const proto = isProtocol(protocol) ? protocolLabel(protocol) : protocol || 'Market';
  const chain = isChainId(chainId) ? chainLabel(chainId) : 'Unknown';
  return `${proto} · ${assetSymbol || 'USDC'} · ${chain}`;
}

function isProtocol(value: string): value is ProtocolId {
  return value === 'morpho' || value === 'aave' || value === 'compound' || value === 'spark' || value === 'moonwell';
}

export function asBig(value: string | undefined): bigint {
  if (!value || !/^\d+$/.test(value)) return 0n;
  return BigInt(value);
}

export function splitRepay(principalRemaining: bigint, debtBefore: bigint, repaid: bigint) {
  const accrued = debtBefore > principalRemaining ? debtBefore - principalRemaining : 0n;
  const interestPaid = repaid < accrued ? repaid : accrued;
  const principalPaid = repaid > interestPaid ? repaid - interestPaid : 0n;
  const nextPrincipal = principalRemaining > principalPaid ? principalRemaining - principalPaid : 0n;
  const debtAfter = debtBefore > repaid ? debtBefore - repaid : 0n;
  const interestRemaining = debtAfter > nextPrincipal ? debtAfter - nextPrincipal : 0n;
  return { interestPaid, principalPaid, principalRemaining: nextPrincipal, interestRemaining };
}

export function liveSplit(episode: LoanEpisode | null | undefined, onChainDebt: bigint): LiveSplit {
  if (!episode) {
    return {
      debt: onChainDebt,
      principalRemaining: onChainDebt,
      interestRemaining: 0n,
      interestPaid: 0n,
      interestSoFar: 0n,
      principalBorrowed: onChainDebt,
      tracked: false,
    };
  }
  const storedPrincipal = asBig(episode.principalRemaining);
  const principalRemaining = storedPrincipal > onChainDebt ? onChainDebt : storedPrincipal;
  const interestRemaining = onChainDebt > storedPrincipal ? onChainDebt - storedPrincipal : 0n;
  const interestPaid = asBig(episode.interestPaid);
  return {
    debt: onChainDebt,
    principalRemaining,
    interestRemaining,
    interestPaid,
    interestSoFar: interestPaid + interestRemaining,
    principalBorrowed: asBig(episode.principalBorrowed),
    tracked: true,
  };
}

function newEpisode(event: AuditEvent, principal: bigint): LoanEpisode {
  return {
    key: event.episodeKey,
    wallet: event.wallet,
    protocol: event.protocol,
    chainId: event.chainId,
    venueId: event.venueId,
    assetSymbol: event.assetSymbol,
    label: episodeLabel(event.protocol, event.assetSymbol, event.chainId),
    openedAt: event.at,
    closedAt: null,
    status: 'open',
    principalBorrowed: principal.toString(),
    principalRemaining: principal.toString(),
    principalRepaid: '0',
    interestPaid: '0',
    totalRepaid: '0',
    weightedApr: event.borrowApr ?? 0,
    lastApr: event.borrowApr ?? 0,
  };
}

export function rebuildEpisodes(events: AuditEvent[]): LoanEpisode[] {
  const open = new Map<string, LoanEpisode>();
  const closed: LoanEpisode[] = [];
  const ordered = [...events].sort((left, right) => left.at - right.at || left.hash.localeCompare(right.hash));
  for (const event of ordered) {
    if (!event.episodeKey) continue;
    if (event.action !== 'borrow' && event.action !== 'repay' && event.action !== 'seed') continue;
    let episode = open.get(event.episodeKey);
    if (!episode && (event.action === 'borrow' || event.action === 'seed')) {
      episode = newEpisode(event, asBig(event.amount));
      open.set(event.episodeKey, episode);
      continue;
    }
    if (!episode) continue;
    if (event.action === 'borrow') {
      const added = asBig(event.amount);
      const prev = asBig(episode.principalBorrowed);
      const next = prev + added;
      const apr = event.borrowApr ?? episode.lastApr;
      episode.weightedApr = next > 0n ? (Number(prev) * episode.weightedApr + Number(added) * apr) / Number(next) : apr;
      episode.lastApr = apr;
      episode.principalBorrowed = next.toString();
      episode.principalRemaining = (asBig(episode.principalRemaining) + added).toString();
      continue;
    }
    if (event.action !== 'repay') continue;
    const split = event.interestPaid !== undefined && event.principalPaid !== undefined
      ? {
          interestPaid: asBig(event.interestPaid),
          principalPaid: asBig(event.principalPaid),
          principalRemaining: asBig(event.principalRemaining ?? '0'),
        }
      : splitRepay(asBig(episode.principalRemaining), asBig(event.debt), asBig(event.amount));
    episode.interestPaid = (asBig(episode.interestPaid) + split.interestPaid).toString();
    episode.principalRepaid = (asBig(episode.principalRepaid) + split.principalPaid).toString();
    episode.totalRepaid = (asBig(episode.totalRepaid) + asBig(event.amount)).toString();
    episode.principalRemaining = split.principalRemaining.toString();
    if (event.closing || split.principalRemaining === 0n) {
      episode.status = 'closed';
      episode.closedAt = event.at;
      episode.principalRemaining = '0';
      closed.push(episode);
      open.delete(event.episodeKey);
    }
  }
  return [...open.values(), ...closed].sort((left, right) => right.openedAt - left.openedAt);
}

export function findOpenEpisode(episodes: LoanEpisode[], key: string) {
  return episodes.find((episode) => episode.key === key && episode.status === 'open') ?? null;
}

export function mergeEvents(...lists: AuditEvent[][]): AuditEvent[] {
  const byHash = new Map<string, AuditEvent>();
  for (const list of lists) {
    for (const event of list) {
      if (!isAuditEvent(event)) continue;
      if (!byHash.has(event.hash)) byHash.set(event.hash, event);
    }
  }
  return [...byHash.values()]
    .sort((left, right) => right.at - left.at || right.hash.localeCompare(left.hash))
    .slice(0, MAX_AUDIT_EVENTS);
}

export function isAuditEvent(value: unknown): value is AuditEvent {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<AuditEvent>;
  return typeof row.hash === 'string'
    && row.hash.length > 0
    && typeof row.wallet === 'string'
    && typeof row.action === 'string'
    && AUDIT_ACTIONS_SET.has(row.action)
    && typeof row.at === 'number'
    && Number.isFinite(row.at)
    && typeof row.amount === 'string'
    && /^\d+$/.test(row.amount);
}

export function sanitizeDocument(value: unknown): AuditDocument {
  if (!value || typeof value !== 'object') return emptyDocument();
  const events = (value as { events?: unknown }).events;
  return { v: 1, events: mergeEvents(Array.isArray(events) ? events as AuditEvent[] : []) };
}

export function readLocalEvents(wallet: string): AuditEvent[] {
  const key = wallet.toLowerCase();
  const cached = memory.get(key);
  if (cached) return cached;
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(`${LOCAL_PREFIX}${key}`) ?? '[]');
    const events = mergeEvents(Array.isArray(parsed) ? parsed as AuditEvent[] : []);
    memory.set(key, events);
    return events;
  } catch {
    memory.set(key, []);
    return [];
  }
}

export function writeLocalEvents(wallet: string, events: AuditEvent[]) {
  const key = wallet.toLowerCase();
  const next = mergeEvents(events);
  memory.set(key, next);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(`${LOCAL_PREFIX}${key}`, JSON.stringify(next));
    } catch {
      // Storage can be full or blocked; the in-memory list still updates.
    }
  }
  emit();
  return next;
}

export function appendLocalEvents(wallet: string, incoming: AuditEvent[]) {
  return writeLocalEvents(wallet, [...readLocalEvents(wallet), ...incoming]);
}

type FeeRow = { hash: string; chainId: number; action: string; feeWei: string; ethUsd: number | null; at: number };

export function migrateFeeRows(wallet: string): AuditEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const done: unknown = JSON.parse(window.localStorage.getItem(FEE_MIGRATE_KEY) ?? '[]');
    const migrated = new Set(Array.isArray(done) ? done.filter((row): row is string => typeof row === 'string') : []);
    const key = wallet.toLowerCase();
    if (migrated.has(key)) return [];
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FEE_STORE_KEY) ?? '[]');
    const rows = Array.isArray(parsed) ? parsed as FeeRow[] : [];
    const events: AuditEvent[] = rows
      .filter((row) => typeof row?.hash === 'string' && typeof row?.feeWei === 'string')
      .map((row) => ({
        hash: row.hash,
        wallet: key,
        chainId: typeof row.chainId === 'number' ? row.chainId : 0,
        action: AUDIT_ACTIONS_SET.has(row.action) ? row.action as AuditAction : 'approve',
        at: typeof row.at === 'number' ? row.at : Date.now(),
        protocol: '',
        venueId: '',
        episodeKey: '',
        assetSymbol: '',
        loanSymbol: 'USDC',
        amount: '0',
        amountUsd: null,
        decimals: 6,
        borrowApr: null,
        supplyApr: null,
        priceUsd: null,
        healthFactor: null,
        collateral: '0',
        debt: '0',
        feeWei: row.feeWei,
        ethUsd: row.ethUsd ?? null,
      }));
    migrated.add(key);
    window.localStorage.setItem(FEE_MIGRATE_KEY, JSON.stringify([...migrated]));
    if (events.length === 0) return [];
    return appendLocalEvents(wallet, events);
  } catch {
    return [];
  }
}

export function buildAuditEvent(input: AuditTxInput): AuditEvent {
  const wallet = input.wallet.toLowerCase();
  const loanAction = input.action === 'borrow' || input.action === 'repay' || input.action === 'seed' || input.amountKind === 'loan';
  const decimals = loanAction ? input.venue.loanDecimals : input.venue.assetDecimals;
  const key = loanAction || input.action === 'supply' || input.action === 'withdraw'
    ? episodeKey(wallet, input.venue)
    : '';
  const event: AuditEvent = {
    hash: input.hash,
    wallet,
    chainId: input.chainId,
    action: input.action,
    at: input.at,
    protocol: input.venue.protocol,
    venueId: input.venue.id,
    episodeKey: key,
    assetSymbol: input.venue.assetSymbol,
    loanSymbol: input.venue.loanSymbol,
    amount: input.amount.toString(),
    amountUsd: input.amountUsd ?? null,
    decimals,
    borrowApr: input.venue.borrowApr,
    supplyApr: input.venue.supplyApr,
    priceUsd: input.venue.priceUsd,
    healthFactor: input.healthFactor ?? null,
    collateral: (input.collateral ?? 0n).toString(),
    debt: (input.debt ?? 0n).toString(),
    feeWei: (input.feeWei ?? 0n).toString(),
    ethUsd: input.ethUsd ?? null,
    closing: input.closing || undefined,
  };
  if (input.action === 'repay' && key) {
    const episode = findOpenEpisode(rebuildEpisodes(readLocalEvents(wallet)), key);
    const split = splitRepay(episode ? asBig(episode.principalRemaining) : input.debt ?? 0n, input.debt ?? 0n, input.amount);
    event.interestPaid = split.interestPaid.toString();
    event.principalPaid = split.principalPaid.toString();
    event.principalRemaining = split.principalRemaining.toString();
    event.interestRemaining = split.interestRemaining.toString();
    if (input.closing || split.principalRemaining === 0n) event.closing = true;
  }
  return event;
}

export function buildSeedEvent(wallet: string, venue: AuditVenue, debt: bigint, at = Date.now(), hash?: string): AuditEvent {
  return buildAuditEvent({
    hash: hash ?? `seed:${episodeKey(wallet, venue)}`,
    wallet,
    action: 'seed',
    at,
    chainId: venue.chainId,
    venue,
    amount: debt,
    amountUsd: Number(formatUnits(debt, venue.loanDecimals)),
    debt,
  });
}

export function persistAuditEvent(event: AuditEvent) {
  appendLocalEvents(event.wallet, [event]);
  if (typeof window === 'undefined') return;
  void fetch('/api/audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: event.wallet, events: [event] }),
  }).catch(() => {
    // Redis can be briefly down; the local cache still has the row.
  });
}

export async function fetchRemoteEvents(wallet: string): Promise<{ events: AuditEvent[]; durable: boolean }> {
  const response = await fetch(`/api/audit?address=${encodeURIComponent(wallet)}`, { cache: 'no-store' });
  if (!response.ok) return { events: [], durable: false };
  const body = (await response.json()) as { events?: unknown; durable?: unknown };
  return {
    events: Array.isArray(body.events) ? body.events.filter(isAuditEvent) : [],
    durable: body.durable === true,
  };
}

export function auditCsv(events: AuditEvent[], episodes: LoanEpisode[]) {
  const header = [
    'time',
    'wallet',
    'action',
    'protocol',
    'chain',
    'market',
    'amount',
    'amountUsd',
    'interestPaid',
    'principalPaid',
    'principalRemaining',
    'interestRemaining',
    'borrowApr',
    'tx',
    'feeWei',
    'episodeStatus',
  ];
  const episodeByKey = new Map(episodes.map((episode) => [episode.key, episode]));
  const lines = [header.join(',')];
  for (const event of [...events].sort((left, right) => left.at - right.at)) {
    const episode = event.episodeKey ? episodeByKey.get(event.episodeKey) : undefined;
    const decimals = event.decimals || 6;
    lines.push([
      new Date(event.at).toISOString(),
      event.wallet,
      event.action,
      event.protocol,
      isChainId(event.chainId) ? chainLabel(event.chainId) : String(event.chainId),
      episode?.label ?? event.venueId,
      formatUnits(asBig(event.amount), decimals),
      event.amountUsd ?? '',
      event.interestPaid ? formatUnits(asBig(event.interestPaid), decimals) : '',
      event.principalPaid ? formatUnits(asBig(event.principalPaid), decimals) : '',
      event.principalRemaining ? formatUnits(asBig(event.principalRemaining), decimals) : '',
      event.interestRemaining ? formatUnits(asBig(event.interestRemaining), decimals) : '',
      event.borrowApr ?? '',
      event.hash.startsWith('0x') ? event.hash : '',
      event.feeWei,
      episode?.status ?? '',
    ].map(csvCell).join(','));
  }
  return lines.join('\n');
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function formatDuration(openedAt: number, closedAt: number | null, now = Date.now()) {
  const ms = Math.max(0, (closedAt ?? now) - openedAt);
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

export function usdFromAmount(amount: bigint, decimals: number, priceUsd = 1) {
  if (!(priceUsd > 0)) return 0;
  return Number(formatUnits(amount, decimals)) * priceUsd;
}

export function isWallet(value: string): value is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}
