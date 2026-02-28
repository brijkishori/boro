'use client';

import { useState, useEffect } from 'react';
import { useSendTransaction, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Heart } from 'lucide-react';

// ⚠️ REPLACE THIS WITH YOUR ACTUAL BASE WALLET ADDRESS ⚠️
const CREATOR_ADDRESS = '0xA6f97cD0f030E8eB8201c6c2406fe9BFBacE7300';

export default function TipJar() {
  const [isOpen, setIsOpen] = useState(false);
  const [amount, setAmount] = useState('0.001');

  // Wagmi hooks for sending standard native ETH transactions
  const { sendTransaction, data: hash, isPending, reset } = useSendTransaction();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      toast.success("Thank you so much for the tip! 💙");
      setIsOpen(false);
      reset(); // Resets the hook state for future tips
    }
  }, [isSuccess, reset]);

  const handleTip = () => {
    sendTransaction({
      to: CREATOR_ADDRESS,
      value: parseEther(amount),
    });
  };

  // Default collapsed state
  if (!isOpen) {
    return (
      <Button 
        variant="outline" 
        size="sm" 
        onClick={() => setIsOpen(true)} 
        className="flex items-center gap-2 font-medium border-pink-200 dark:border-pink-500/30 hover:border-pink-300 hover:bg-pink-50 dark:hover:bg-pink-500/10 transition-colors"
      >
        <Heart className="w-4 h-4 text-pink-500" />
        Support the Creator
      </Button>
    );
  }

  // Expanded state with dark mode UI polish
  return (
    <div className="flex flex-wrap items-center gap-2 bg-muted/40 dark:bg-muted/10 p-2 rounded-lg border border-pink-100 dark:border-pink-500/30 shadow-sm transition-all">
      <span className="text-xs font-bold text-muted-foreground ml-1">Tip (ETH):</span>
      
      <div className="flex gap-1">
        {['0.001', '0.005', '0.01'].map((val) => (
          <Button
            key={val}
            variant={amount === val ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAmount(val)}
            className={`h-8 px-2 text-xs font-bold ${amount === val ? 'bg-pink-500 hover:bg-pink-600 text-white' : 'dark:border-border/50'}`}
          >
            {val}
          </Button>
        ))}
      </div>

      <Button
        size="sm"
        className="h-8 bg-blue-600 hover:bg-blue-700 text-white font-bold ml-1"
        disabled={isPending || isConfirming}
        onClick={handleTip}
      >
        {isPending ? 'Confirming...' : isConfirming ? 'Sending...' : 'Send Tip'}
      </Button>
      
      <Button 
        variant="ghost" 
        size="sm" 
        className="h-8 px-2 text-xs font-medium text-muted-foreground hover:text-foreground" 
        onClick={() => setIsOpen(false)}
        disabled={isPending || isConfirming}
      >
        Cancel
      </Button>
    </div>
  );
}