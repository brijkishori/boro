'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import CustomConnectButton from '@/components/CustomConnectButton';

export default function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <nav className="relative border-b bg-background w-full">
      <div className="flex items-center justify-between p-3 max-w-md mx-auto">
        
        <div className="flex items-center">
          {/* Restored the word "Borrow" here */}
          <Link href="/" className="text-lg font-bold tracking-tight hover:opacity-80 transition-opacity whitespace-nowrap">
            Simple<span className="text-blue-500">BTC</span> Borrow
          </Link>
        </div>

        <div className="flex items-center space-x-2">
          <ThemeToggle />
          <CustomConnectButton /> 
          
          <button 
            className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div className="absolute top-full left-0 w-full bg-background border-b shadow-lg z-50">
          <div className="flex flex-col px-4 py-3 space-y-2 text-sm font-medium text-muted-foreground">
            <Link href="/" onClick={() => setIsMobileMenuOpen(false)} className="hover:text-foreground transition-colors block py-2 border-b border-muted">Home</Link>
            <Link href="/#how-it-works" onClick={() => setIsMobileMenuOpen(false)} className="hover:text-foreground transition-colors block py-2 border-b border-muted">How it Works</Link>
            <Link href="/faq" onClick={() => setIsMobileMenuOpen(false)} className="hover:text-foreground transition-colors block py-2 border-b border-muted">FAQ</Link>
            <Link href="/contact" onClick={() => setIsMobileMenuOpen(false)} className="hover:text-foreground transition-colors block py-2">Contact</Link>
          </div>
        </div>
      )}
    </nav>
  );
}