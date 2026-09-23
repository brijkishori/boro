import '@rainbow-me/rainbowkit/styles.css';
import './globals.css';
import { Providers } from './providers';
import { Toaster } from "@/components/ui/sonner"; 
import { GoogleAnalytics } from '@next/third-parties/google'; 
import Navbar from '@/components/Navbar';
import type { Metadata, Viewport } from 'next';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#121214' },
  ],
}; 

export async function generateMetadata(): Promise<Metadata> {
  const appUrl = 'https://boro-ruddy.vercel.app';

  return {
    title: 'Simple BTC Borrow',
    description: 'A seamless, transparent borrowing experience.',
    other: {
      /*'base:app_id': '69a329f10d00a968ea9a3a71',*/
		'base:app_id': '69cc9ee01aacdcc17b25514d',
	  
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
      {/* Added overflow-x-hidden to strictly kill horizontal scrolling */}
      <body className="min-h-dvh overflow-x-hidden bg-background font-sans text-foreground antialiased">
        <Providers>
          <Navbar />
          <main className="mx-auto w-full max-w-3xl overflow-x-hidden px-3 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            {children}
          </main>
          <Toaster position="bottom-center" theme="system" /> 
        </Providers>

        <GoogleAnalytics gaId="G-5N0BHRH5E1" />
      </body>
    </html>
  );
}