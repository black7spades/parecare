import nodemailer from 'nodemailer';
import { env } from '../config/env';

function getTransport(): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
  });
}

export async function sendInviteEmail(
  toEmail: string,
  inviterName: string,
  profileName: string,
  inviteUrl: string
): Promise<void> {
  if (!env.SMTP_HOST) {
    console.warn('SMTP not configured — skipping invite email to', toEmail);
    return;
  }

  const transport = getTransport();
  await transport.sendMail({
    from: env.EMAIL_FROM,
    to: toEmail,
    subject: `${inviterName} has invited you to PareCare`,
    text: [
      `${inviterName} has invited you to join the care circle for ${profileName} on PareCare.`,
      '',
      'Accept your invitation:',
      inviteUrl,
      '',
      'PareCare helps families coordinate the care of ageing parents.',
    ].join('\n'),
    html: `
      <p>${inviterName} has invited you to join the care circle for <strong>${profileName}</strong> on PareCare.</p>
      <p><a href="${inviteUrl}">Accept invitation</a></p>
      <p style="color:#888;font-size:12px">PareCare helps families coordinate the care of ageing parents.</p>
    `,
  });
}

export async function sendReminderEmail(
  toEmail: string,
  displayName: string,
  title: string,
  body: string | null
): Promise<void> {
  if (!env.SMTP_HOST) return;

  const transport = getTransport();
  await transport.sendMail({
    from: env.EMAIL_FROM,
    to: toEmail,
    subject: `Reminder: ${title}`,
    text: [title, body ?? '', '', 'View in PareCare: ' + env.APP_URL].join('\n'),
    html: `
      <p>Hi ${displayName},</p>
      <p><strong>${title}</strong></p>
      ${body ? `<p>${body}</p>` : ''}
      <p><a href="${env.APP_URL}">View in PareCare</a></p>
    `,
  });
}
