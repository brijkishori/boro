import { sha256 } from 'viem';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function sha256Bytes(data: Uint8Array): Uint8Array {
  const hex = sha256(data).slice(2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function base58Decode(input: string): Uint8Array | null {
  if (input.length < 26 || input.length > 35) return null;
  let zeroCount = 0;
  while (zeroCount < input.length && input[zeroCount] === '1') zeroCount++;
  const size = 64;
  const decoded = new Uint8Array(size);
  for (const char of input) {
    const value = BASE58_ALPHABET.indexOf(char);
    if (value === -1) return null;
    let carry = value;
    for (let i = size - 1; i >= 0; i--) {
      carry += 58 * decoded[i];
      decoded[i] = carry % 256;
      carry = Math.floor(carry / 256);
    }
    if (carry !== 0) return null;
  }
  let start = 0;
  while (start < size && decoded[start] === 0) start++;
  const out = new Uint8Array(zeroCount + (size - start));
  out.set(decoded.subarray(start), zeroCount);
  return out;
}

function isBase58MainnetAddress(address: string): boolean {
  const decoded = base58Decode(address);
  if (!decoded || decoded.length !== 25) return false;
  const version = decoded[0];
  if (version !== 0x00 && version !== 0x05) return false;
  const payload = decoded.subarray(0, 21);
  const checksum = decoded.subarray(21);
  const hash = sha256Bytes(sha256Bytes(payload)).subarray(0, 4);
  for (let i = 0; i < 4; i++) if (hash[i] !== checksum[i]) return false;
  return true;
}

function polymod(values: number[]): number {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) checksum ^= BECH32_GENERATOR[i];
    }
  }
  return checksum;
}

function hrpExpand(hrp: string): number[] {
  const expanded: number[] = [];
  for (const char of hrp) expanded.push(char.charCodeAt(0) >> 5);
  expanded.push(0);
  for (const char of hrp) expanded.push(char.charCodeAt(0) & 31);
  return expanded;
}

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
  const max = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      result.push((acc >> bits) & max);
    }
  }
  if (pad) {
    if (bits > 0) result.push((acc << (to - bits)) & max);
  } else if (bits >= from || ((acc << (to - bits)) & max) !== 0) {
    return null;
  }
  return result;
}

function isBech32MainnetAddress(address: string): boolean {
  if (address.length < 14 || address.length > 90) return false;
  const lower = address.toLowerCase();
  const upper = address.toUpperCase();
  if (address !== lower && address !== upper) return false;
  const normalized = lower;
  const separator = normalized.lastIndexOf('1');
  if (separator < 1 || separator + 7 > normalized.length) return false;
  const hrp = normalized.slice(0, separator);
  if (hrp !== 'bc') return false;
  const data: number[] = [];
  for (const char of normalized.slice(separator + 1)) {
    const value = BECH32_CHARSET.indexOf(char);
    if (value === -1) return false;
    data.push(value);
  }
  if (data.length < 6) return false;
  const witnessVersion = data[0];
  const bech32m = witnessVersion !== 0;
  const checksumConstant = bech32m ? 0x2bc830a3 : 1;
  if (polymod(hrpExpand(hrp).concat(data)) !== checksumConstant) return false;
  const program = convertBits(data.slice(1, -6), 5, 8, false);
  if (!program) return false;
  if (witnessVersion > 16) return false;
  if (program.length < 2 || program.length > 40) return false;
  if (witnessVersion === 0 && program.length !== 20 && program.length !== 32) return false;
  if (witnessVersion === 1 && program.length !== 32) return false;
  return true;
}

export function isBitcoinMainnetAddress(address: string): boolean {
  const trimmed = address.trim();
  if (trimmed.startsWith('bc1') || trimmed.startsWith('BC1')) return isBech32MainnetAddress(trimmed);
  return isBase58MainnetAddress(trimmed);
}
