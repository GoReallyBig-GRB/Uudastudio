/**
 * Uuda Studio - Outgoing email
 *
 * One function, sendMail(), so the provider can be swapped later (Gmail SMTP now, Resend or Brevo later)
 * without touching any route.
 *
 * Configuration (environment):
 *   SMTP_USER   Gmail address that sends the mail
 *   SMTP_PASS   Gmail app password (not the account password). Keep it in Secret Manager on Cloud Run.
 *   SMTP_FROM   optional "Uuda Studio <you@gmail.com>"
 *
 * With no SMTP settings:
 *   - production: sending fails with a clear error (a code is never shown anywhere else)
 *   - development: the message is printed to the server console only, never returned by an API route
 */

import nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    secure: (process.env.SMTP_SECURE ?? 'true') !== 'false',
    auth: { user, pass },
  });
  return transporter;
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super('Email is not configured on the server (SMTP_USER and SMTP_PASS).');
  }
}

export async function sendMail(message: MailMessage): Promise<void> {
  const t = getTransporter();
  if (!t) {
    if (process.env.NODE_ENV === 'production') {
      throw new MailNotConfiguredError();
    }
    console.info(`[DEV MAIL] to=${message.to} subject="${message.subject}"\n${message.text}`);
    return;
  }
  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
}

export function adminCodeEmail(code: string): { subject: string; text: string } {
  return {
    subject: 'Your Uuda Studio admin code',
    text:
      `Your admin verification code is ${code}\n\n` +
      'It expires in 10 minutes and can be used once. If you did not try to sign in to the Uuda Studio admin panel, ' +
      'ignore this email and change your Google password.',
  };
}
