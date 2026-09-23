'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { useAccount, useDisconnect } from 'wagmi';
import { ThemeToggle } from '@/components/ThemeToggle';
import CustomConnectButton from '@/components/CustomConnectButton';
import WalletBalances from '@/components/WalletBalances';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/loans', label: 'Loans' },
  { href: '/#how-it-works', label: 'How it Works' },
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Contact' },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const { isConnected } = useAccount();
  const { disconnect, disconnectAsync } = useDisconnect();

  return (
    <nav className="sticky top-0 z-40 w-full border-b bg-background/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-3xl min-w-0 items-center justify-between gap-2 px-3 py-2">
        <Link href="/" className="min-w-0 shrink text-base font-bold tracking-tight hover:opacity-80 sm:text-lg">
          <span className="sm:hidden">Simple<span className="text-blue-500">BTC</span></span>
          <span className="hidden sm:inline">Simple<span className="text-blue-500">BTC</span> Borrow</span>
        </Link>

        <div className="hidden items-center gap-4 text-sm font-medium text-muted-foreground md:flex">
          {LINKS.slice(0, 3).map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex min-w-0 items-center gap-1.5">
          <ThemeToggle />
          <CustomConnectButton />
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-b bg-background shadow-lg md:hidden">
          <div className="mx-auto flex max-w-3xl flex-col px-4 py-2 text-sm font-medium text-muted-foreground">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="block border-b border-muted py-3 hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
            {isConnected && (
              <button
                type="button"
                className="py-3 text-left hover:text-foreground"
                onClick={() => {
                  setOpen(false);
                  void disconnectAsync().catch(() => disconnect());
                }}
              >
                Disconnect wallet
              </button>
            )}
          </div>
        </div>
      )}
      <WalletBalances />
    </nav>
  );
}
