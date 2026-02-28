'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider, darkTheme, lightTheme } from '@rainbow-me/rainbowkit';
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';
import { config } from '@/lib/config';

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <NextThemesProvider attribute="class" defaultTheme="system" enableSystem>
          <RainbowWrapper>{children}</RainbowWrapper>
        </NextThemesProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

// Wrapper to sync RainbowKit theme with Next-Themes
function RainbowWrapper({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();
  // 1. Add a mounted state
  const [mounted, setMounted] = React.useState(false);

  // 2. Set mounted to true once the client has successfully hydrated
  React.useEffect(() => {
    setMounted(true);
  }, []);
  
  return (
    <RainbowKitProvider 
      // 3. Force it to match the server's light theme until mounted, then apply dark mode safely
      theme={mounted && resolvedTheme === 'dark' ? darkTheme() : lightTheme()}
    >
      {children}
    </RainbowKitProvider>
  );
}