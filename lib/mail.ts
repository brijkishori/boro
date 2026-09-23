import { createTransport } from 'nodemailer';

export function mailConfigured() {
  return Boolean(process.env.GMAIL_USER?.trim() && process.env.GMAIL_APP_PASSWORD?.trim());
}

function smtpUser(value: string) {
  return value.trim().replace(/\+[^@]+@/, '@');
}

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  if (!mailConfigured()) throw new Error('Gmail SMTP is not configured');
  const user = smtpUser(process.env.GMAIL_USER!);
  const from = process.env.ALERT_FROM_EMAIL?.trim() || user;
  const transport = createTransport({
    service: 'gmail',
    auth: { user, pass: process.env.GMAIL_APP_PASSWORD!.replace(/\s+/g, '') },
  });
  await transport.sendMail({ from: from.includes('@') ? from : user, to, subject, text, html });
}
