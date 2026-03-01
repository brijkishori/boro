// lib/constants.ts

export const MORPHO_ADDRESS = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// Supported Collateral Tokens
export const ASSETS = {
  cbBTC: {
    symbol: "cbBTC",
    address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf" as const,
    decimals: 8,
    marketParams: {
      loanToken: USDC_ADDRESS,
      collateralToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      oracle: "0x...", // cbBTC Oracle
      irm: "0x...",    // IRM
      lltv: 0n,
    }
  },
  cbETH: {
    symbol: "cbETH",
    address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22" as const, // Base cbETH address
    decimals: 18,
    marketParams: {
      loanToken: USDC_ADDRESS,
      collateralToken: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
      oracle: "0x...", // cbETH Oracle
      irm: "0x...",    // IRM
      lltv: 0n,
    }
  }
};

export const erc20Abi = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)"
] as const;

export const morphoAbi = [
  "function borrow(tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver)",
  "function repay(tuple(address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, bytes data)"
] as const;