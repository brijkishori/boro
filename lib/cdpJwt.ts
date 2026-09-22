import { createPrivateKey, randomBytes, sign, type KeyObject } from 'node:crypto';

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

function loadKey(secret: string): { key: KeyObject; alg: 'ES256' | 'EdDSA' } {
  const trimmed = secret.replace(/\\n/g, '\n').trim();
  if (trimmed.includes('BEGIN')) {
    return { key: createPrivateKey(trimmed), alg: 'ES256' };
  }
  const raw = Buffer.from(trimmed, 'base64');
  if (raw.length !== 64 && raw.length !== 32) throw new Error('Unsupported CDP key format');
  const seed = raw.subarray(0, 32);
  return {
    key: createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' }),
    alg: 'EdDSA',
  };
}

export function cdpJwt({ keyId, secret, method, host, path, ttlSeconds = 120 }: {
  keyId: string;
  secret: string;
  method: string;
  host: string;
  path: string;
  ttlSeconds?: number;
}) {
  const { key, alg } = loadKey(secret);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg, kid: keyId, typ: 'JWT', nonce: randomBytes(16).toString('hex') };
  const payload = {
    sub: keyId,
    iss: 'cdp',
    aud: ['cdp_service'],
    nbf: now,
    exp: now + ttlSeconds,
    uris: [`${method} ${host}${path}`],
  };
  const input = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = alg === 'EdDSA'
    ? sign(null, Buffer.from(input), key)
    : sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' });
  return `${input}.${base64url(signature)}`;
}
