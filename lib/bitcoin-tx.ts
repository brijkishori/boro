function compactSize(bytes: Uint8Array, offset: number): { value: number; next: number } {
  const first = bytes[offset];
  if (first === undefined) throw new Error('Bitcoin transaction is truncated.');
  if (first < 0xfd) return { value: first, next: offset + 1 };
  if (first === 0xfd) {
    if (offset + 3 > bytes.length) throw new Error('Bitcoin transaction is truncated.');
    return { value: bytes[offset + 1] + bytes[offset + 2] * 256, next: offset + 3 };
  }
  if (first === 0xfe) {
    if (offset + 5 > bytes.length) throw new Error('Bitcoin transaction is truncated.');
    return {
      value: bytes[offset + 1] + bytes[offset + 2] * 256 + bytes[offset + 3] * 65536 + bytes[offset + 4] * 16777216,
      next: offset + 5,
    };
  }
  throw new Error('Bitcoin transaction is larger than this app will parse.');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) throw new Error('Bitcoin transaction hex is invalid.');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export type BitcoinTxVectors = {
  version: `0x${string}`;
  inputs: `0x${string}`;
  outputs: `0x${string}`;
  locktime: `0x${string}`;
};

/** Splits a raw Bitcoin tx the way Threshold’s Bridge.revealDeposit expects. */
export function extractBitcoinTxVectors(transactionHex: string): BitcoinTxVectors {
  const bytes = hexToBytes(transactionHex);
  if (bytes.length < 10) throw new Error('Bitcoin transaction is too short.');
  const version = bytes.subarray(0, 4);
  let offset = 4;
  let inputCount = 0;
  const segwit = bytes[4] === 0x00 && bytes[5] === 0x01;
  if (segwit) offset = 6;
  const inputStart = offset;
  const inputsHeader = compactSize(bytes, offset);
  inputCount = inputsHeader.value;
  offset = inputsHeader.next;
  for (let i = 0; i < inputCount; i++) {
    offset += 36;
    const script = compactSize(bytes, offset);
    offset = script.next + script.value + 4;
  }
  const inputEnd = offset;
  const outputStart = offset;
  const outputsHeader = compactSize(bytes, offset);
  offset = outputsHeader.next;
  for (let i = 0; i < outputsHeader.value; i++) {
    offset += 8;
    const script = compactSize(bytes, offset);
    offset = script.next + script.value;
  }
  const outputEnd = offset;
  if (segwit) {
    for (let i = 0; i < inputCount; i++) {
      const items = compactSize(bytes, offset);
      offset = items.next;
      for (let j = 0; j < items.value; j++) {
        const item = compactSize(bytes, offset);
        offset = item.next + item.value;
      }
    }
  }
  if (offset + 4 > bytes.length) throw new Error('Bitcoin transaction is truncated.');
  return {
    version: bytesToHex(version),
    inputs: bytesToHex(bytes.subarray(inputStart, inputEnd)),
    outputs: bytesToHex(bytes.subarray(outputStart, outputEnd)),
    locktime: bytesToHex(bytes.subarray(offset, offset + 4)),
  };
}
