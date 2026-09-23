export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const memory = new Map<string, string>();

function redis() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  if (!/^https:\/\//i.test(url) || /…|\.{3}/.test(url) || token === '…' || token === '...') return null;
  return { url: url.replace(/\/$/, ''), token };
}

async function command<T>(args: unknown[]): Promise<T | null> {
  const remote = redis();
  if (!remote) return null;
  const response = await fetch(`${remote.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${remote.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([args]),
    signal: AbortSignal.timeout(8_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`redis ${response.status}`);
  const body = (await response.json()) as { result?: T }[];
  return body[0]?.result ?? null;
}

export async function storeGet(key: string): Promise<string | null> {
  const remote = await command<string | null>(['GET', key]);
  if (remote !== null) return remote;
  return memory.get(key) ?? null;
}

export async function storeSet(key: string, value: string, ttlSeconds?: number) {
  memory.set(key, value);
  if (ttlSeconds) {
    await command(['SET', key, value, 'EX', ttlSeconds]);
  } else {
    await command(['SET', key, value]);
  }
}

export async function storeDel(key: string) {
  memory.delete(key);
  await command(['DEL', key]);
}

export async function storeJson<T extends Json>(key: string): Promise<T | null> {
  const raw = await storeGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function storeSetJson(key: string, value: Json, ttlSeconds?: number) {
  await storeSet(key, JSON.stringify(value), ttlSeconds);
}

export async function storeSadd(key: string, member: string) {
  const list = new Set((await storeJson<string[]>(key)) ?? []);
  list.add(member);
  await storeSetJson(key, [...list]);
  await command(['SADD', key, member]);
}

export async function storeSmembers(key: string): Promise<string[]> {
  const remote = await command<string[]>(['SMEMBERS', key]);
  if (remote) return remote;
  return (await storeJson<string[]>(key)) ?? [];
}

export function storeConfigured() {
  return Boolean(redis() || process.env.NODE_ENV !== 'production');
}

export function storeRemoteConfigured() {
  return Boolean(redis());
}
