'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronDown } from 'lucide-react';

export default function FAQPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  // Updated to use JSX so we can inject the styled logo directly into the text
  const faqs = [
    {
      question: <>What is <strong className="text-foreground">Simple<span className="text-blue-500">BTC</span> Borrow</strong>?</>,
      answer: <><strong className="text-foreground">Simple<span className="text-blue-500">BTC</span> Borrow</strong> compares Morpho Blue and Aave V3 on Ethereum and Base, then sends your transaction to the market you select. Borrow mode highlights the lowest USDC APR. Lend mode highlights the highest BTC supply APY. Direct BTC uses tBTC. cbBTC remains available.</>
    },
    {
      question: "How is my Health Factor calculated?",
      answer: "Your Health Factor is the ratio between the value of your collateral and your outstanding debt. If the value of your collateral drops due to market conditions, your Health Factor decreases. Always keep your Health Factor in the 'Safe' zone to avoid liquidation."
    },
    {
      question: "What happens if I get liquidated?",
      answer: "If your position reaches the Maximum Loan-to-Value (LTV) limit, your Health Factor drops into the 'Liquidated' zone. When this happens, a third-party liquidator can pay off a portion of your debt in exchange for a portion of your collateral (plus a liquidation penalty). It is crucial to monitor your position and supply additional collateral or repay debt if markets become volatile."
    },
    {
      question: "Who controls my funds?",
      answer: <><strong className="text-foreground">Simple<span className="text-blue-500">BTC</span> Borrow</strong> is a non-custodial interface. We do not hold, control, or have access to your assets. Bitcoin balances are read from the public network. Lending and borrowing execute in your wallet against Morpho or Aave.</>
    },
    {
      question: "Are there any fees?",
      answer: "This interface does not charge platform fees. You pay network gas plus the interest rate of the Morpho or Aave market you select."
    },
    {
      question: "How do I close my loan completely?",
      answer: "To close your position, navigate to the Repay tab. First, ensure USDC is approved. Then, use the '100% (Clear Debt)' button to repay your borrowed amount plus all accrued interest. Once your debt is exactly zero, the Withdraw button will unlock, allowing you to pull your original collateral back into your wallet."
    }
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      <div className="text-center space-y-4 mb-12">
        <h1 className="text-4xl font-bold tracking-tight">
          Frequently Asked <span className="text-blue-600 dark:text-blue-500">Questions</span>
        </h1>
        <p className="text-muted-foreground text-lg">
          Everything you need to know about using <strong className="text-foreground">Simple<span className="text-blue-500">BTC</span> Borrow</strong>.
        </p>
      </div>

      <div className="space-y-4">
        {faqs.map((faq, index) => (
          <Card 
            key={index} 
            className={`border transition-all duration-200 overflow-hidden cursor-pointer ${openIndex === index ? 'border-blue-500/50 shadow-md dark:bg-blue-500/5' : 'border-muted hover:border-border'}`}
            onClick={() => toggleFAQ(index)}
          >
            <div className="flex justify-between items-center p-6">
              <h3 className="font-semibold text-lg pr-8">{faq.question}</h3>
              <ChevronDown 
                className={`w-5 h-5 text-muted-foreground transition-transform duration-300 flex-shrink-0 ${openIndex === index ? 'rotate-180 text-blue-500' : ''}`} 
              />
            </div>
            
            <div 
              className={`grid transition-all duration-300 ease-in-out ${openIndex === index ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
            >
              <div className="overflow-hidden">
                <CardContent className="pt-0 pb-6 text-muted-foreground leading-relaxed">
                  {faq.answer}
                </CardContent>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-12 p-6 bg-muted/40 rounded-xl border border-muted text-center space-y-4">
        <h3 className="font-semibold text-foreground">Still have questions?</h3>
        <p className="text-sm text-muted-foreground">
          Protocol documentation lives with Morpho and Aave. This interface only prepares the transaction your wallet signs.
        </p>
        <div className="flex justify-center gap-4">
          <a href="https://docs.morpho.org/" target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-600 dark:text-blue-400 hover:underline">Morpho docs</a>
          <a href="https://aave.com/docs" target="_blank" rel="noreferrer" className="text-sm font-bold text-blue-600 dark:text-blue-400 hover:underline">Aave docs</a>
        </div>
      </div>

    </div>
  );
}