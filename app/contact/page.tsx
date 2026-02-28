'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from "sonner";
import { Send, MessageSquare } from 'lucide-react';

export default function ContactPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    const formData = new FormData(e.currentTarget);

    try {
      // ⚠️ REPLACE THIS URL WITH YOUR ACTUAL FORMSPREE ENDPOINT ⚠️
      const response = await fetch('https://formspree.io/f/mvzbdejq', {
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/json'
        }
      });

      if (response.ok) {
        toast.success("Message sent! Thank you for reaching out.");
        (e.target as HTMLFormElement).reset(); // Clear the form
      } else {
        toast.error("Oops! There was a problem sending your message.");
      }
    } catch (error) {
      toast.error("An error occurred. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      <div className="text-center space-y-4 mb-8">
        <h1 className="text-4xl font-bold tracking-tight">
          Get in <span className="text-blue-600 dark:text-blue-500">Touch</span>
        </h1>
        <p className="text-muted-foreground text-lg">
          Found a bug? Have a suggestion? Just want to say hi? We'd love to hear from you.
        </p>
      </div>

      <Card className="shadow-lg border-muted">
        <CardHeader className="bg-muted/30 border-b border-muted pb-6">
          <CardTitle className="flex items-center gap-2 text-xl">
            <MessageSquare className="w-5 h-5 text-blue-500" />
            Send us a Message
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label htmlFor="name" className="text-sm font-semibold">Name or Alias</label>
                <Input 
                  id="name" 
                  name="name" 
                  placeholder="Satoshi Nakamoto" 
                  required 
                  className="h-12"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-semibold">Email Address <span className="text-muted-foreground font-normal">(Optional)</span></label>
                <Input 
                  id="email" 
                  name="email" 
                  type="email" 
                  placeholder="satoshi@bitcoin.org" 
                  className="h-12"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="message" className="text-sm font-semibold">Message</label>
              {/* Using native textarea with Tailwind classes matching your Input component */}
              <textarea 
                id="message" 
                name="message" 
                required 
                placeholder="How can we help you today?"
                className="flex min-h-[160px] w-full rounded-md border border-input bg-background px-3 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
              ></textarea>
            </div>

            <Button 
              type="submit" 
              className="w-full h-12 font-bold bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Sending Message...' : (
                <>
                  <Send className="w-4 h-4" /> Send Message
                </>
              )}
            </Button>
            
          </form>
        </CardContent>
      </Card>
      
      <p className="text-center text-xs text-muted-foreground">
        Your email address is completely private. We will never share your information.
      </p>

    </div>
  );
}