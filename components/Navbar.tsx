'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import CustomConnectButton from '@/components/CustomConnectButton';

export default function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <nav className="relative border-b bg-background">
      <div className="flex items-center justify-between p-6">
        
        {/* Left Side: Logo & Desktop Links */}
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

        {/* Right Side: Toggles, Wallet & Mobile Menu Icon */}
        <div className="flex items-center space-x-4">
          <ThemeToggle />
          <CustomConnectButton /> 
          
          {/* Mobile Menu Toggle Button */}
          <button 
            className="md:hidden p-2 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile Dropdown Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 w-full bg-background border-b shadow-lg z-50">
          <div className="flex flex-col px-6 py-4 space-y-4 text-sm font-medium text-muted-foreground">
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