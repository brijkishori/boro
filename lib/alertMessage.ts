import { getAddress } from 'viem';

export function personalAlertMessage(address: string, email: string, nonce: string, expires: number) {
  return `SimpleBTC loan alerts wallet=${getAddress(address)} email=${email} nonce=${nonce} expires=${expires}`;
}

export function alertTypedData(address: string, email: string, nonce: string, expires: number, chainId: number) {
  return {
    domain: { name: 'SimpleBTC Borrow', version: '1', chainId },
    types: {
      Subscribe: [
        { name: 'wallet', type: 'address' },
        { name: 'email', type: 'string' },
        { name: 'nonce', type: 'string' },
        { name: 'expires', type: 'uint256' },
      ],
    },
    primaryType: 'Subscribe' as const,
    message: {
      wallet: getAddress(address),
      email,
      nonce,
      expires: BigInt(expires),
    },
  };
}
