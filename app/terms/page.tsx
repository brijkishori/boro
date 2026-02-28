'use client';

import { Card, CardContent } from '@/components/ui/card';
import { ShieldAlert } from 'lucide-react';

export default function TermsOfService() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      <div className="text-center space-y-4 mb-8">
        <h1 className="text-4xl font-bold tracking-tight">
          Terms of <span className="text-blue-600 dark:text-blue-500">Service</span>
        </h1>
        <p className="text-muted-foreground text-lg">
          Last Updated: {new Date().toLocaleDateString()}
        </p>
      </div>

      <Card className="shadow-lg border-muted">
        <CardContent className="pt-8 space-y-8 text-sm leading-relaxed text-muted-foreground">
          
          <div className="flex items-start gap-4 p-4 bg-blue-50 dark:bg-blue-500/10 rounded-lg text-blue-900 dark:text-blue-200">
            <ShieldAlert className="w-6 h-6 flex-shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
            <p className="font-medium">
              By accessing or using the <strong className="text-foreground">Simple<span className="text-blue-500">BTC</span> Borrow</strong> interface, you signify that you have read, understand, and agree to be bound by these Terms of Service in their entirety. If you do not agree, you are not authorized to access or use our interface.
            </p>
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground">1. Non-Custodial & Decentralized Nature</h2>
            <p>
              <strong className="text-foreground">Simple<span className="text-blue-500">BTC</span> Borrow</strong> is a strictly non-custodial, open-source user interface (the "Interface") that facilitates interaction with the decentralized Morpho Blue smart contracts on the Base network. We do not have access to your private keys, funds, or assets at any time. All transactions are executed directly between your cryptographic wallet and the blockchain.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground">2. Assumption of Risk</h2>
            <p>
              Using decentralized finance (DeFi) protocols involves significant risks, including but not limited to:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li><strong>Smart Contract Risk:</strong> Vulnerabilities or bugs in the Morpho Blue protocol or underlying blockchain networks.</li>
              <li><strong>Market Volatility:</strong> Cryptographic assets are highly volatile. Severe price drops may result in the automatic liquidation of your collateral.</li>
              <li><strong>Regulatory Risk:</strong> Changes in laws or regulations may impact the legality or functionality of DeFi applications in your jurisdiction.</li>
            </ul>
            <p>
              You assume total responsibility and risk for your use of the Interface.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground">3. No Financial Advice or Brokerage</h2>
            <p>
              <strong className="text-foreground">Simple<span className="text-blue-500">BTC</span> Borrow</strong> is not a bank, broker, dealer, or financial institution. The Interface does not provide financial, investment, legal, or tax advice. Any market data or pricing information displayed is provided "as is" for informational purposes only and should not be relied upon as definitive.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground">4. Limitation of Liability</h2>
            <p>
              To the fullest extent permitted by applicable law, in no event will the creators, contributors, or operators of <strong className="text-foreground">Simple<span className="text-blue-500">BTC</span> Borrow</strong> be liable for any indirect, incidental, special, consequential, or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses, resulting from (a) your access to or use of or inability to access or use the Interface; (b) any conduct or content of any third party on the Interface; or (c) unauthorized access, use, or alteration of your transmissions or content.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-foreground">5. Compliance with Local Laws</h2>
            <p>
              It is your sole responsibility to ensure that your use of the Interface complies with all applicable laws and regulations in your jurisdiction. You agree not to use the Interface for any illegal activities, including but not limited to money laundering, terrorism financing, or evading sanctions.
            </p>
          </section>

        </CardContent>
      </Card>
      
    </div>
  );
}