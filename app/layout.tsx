import '@rainbow-me/rainbowkit/styles.css';
import './globals.css';
import { Providers } from './providers';
import { Toaster } from "@/components/ui/sonner"; 
import { GoogleAnalytics } from '@next/third-parties/google'; 
import Navbar from '@/components/Navbar';
import type { Metadata } from 'next'; 

// --- NEW DYNAMIC METADATA GENERATOR ---
export async function generateMetadata(): Promise<Metadata> {
  const appUrl = 'https://boro-ruddy.vercel.app';

  return {
    title: 'Simple BTC Borrow',
    description: 'A seamless, transparent borrowing experience.',
    other: {
      'base:app_id': '69a329f10d00a968ea9a3a71', 
      'fc:miniapp': JSON.stringify({
        version: 'next',
        imageUrl: `${appUrl}/icon.png`,
        button: {
          title: 'Launch App',
          action: {
            type: 'launch_miniapp',
            name: 'BORO',
            url: appUrl,
            splashImageUrl: `${appUrl}/icon.png`,
            splashBackgroundColor: '#ffffff',
          },
        },
      }),
    },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground font-sans antialiased">
        <Providers>
          
          <Navbar />
          
          <main className="container mx-auto max-w-5xl py-10">
            {children}
          </main>
          <Toaster position="bottom-right" theme="system" /> 
        </Providers>

        <GoogleAnalytics gaId="G-5N0BHRH5E1" />
      </body>
    </html>
  );
}