import '@rainbow-me/rainbowkit/styles.css';
import './globals.css';
import { Providers } from './providers';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Toaster } from "@/components/ui/sonner"; 
import Link from 'next/link'; 
import { GoogleAnalytics } from '@next/third-parties/google'; 
import CustomConnectButton from '@/components/CustomConnectButton';
import type { Metadata } from 'next'; 

// --- NEW DYNAMIC METADATA GENERATOR ---
export async function generateMetadata(): Promise<Metadata> {
  const appUrl = 'https://boro-ruddy.vercel.app';

  return {
    title: 'Simple BTC Borrow',
    description: 'A seamless, transparent borrowing experience.',
    other: {
      'base:app_id': '69a329f10d00a968ea9a3a71', // Your Base App ID is preserved here!
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
          <nav className="flex items-center justify-between p-6 border-b">
            
            <div className="flex items-center space-x-8">
              <Link href="/" className="text-xl font-bold tracking-tight hover:opacity-80 transition-opacity">
                Simple<span className="text-blue-500">BTC</span> Borrow
              </Link>
              
              <div className="hidden md:flex items-center space-x-6 text-sm font-medium text-muted-foreground">
                <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
                <Link href="/#how-it-works" className="hover:text-foreground transition-colors">How it Works</Link>
                <Link href="/faq" className="hover:text-foreground transition-colors">FAQ</Link>
                <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <ThemeToggle />
              <CustomConnectButton /> 
            </div>

          </nav>
          
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