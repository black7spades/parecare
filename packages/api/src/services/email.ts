import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { getEmailConfig } from '../config/settings';

function getTransport(): nodemailer.Transporter {
  const cfg = getEmailConfig();
  return nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpPort === 465,
    auth:
      cfg.smtpUser && cfg.smtpPass
        ? { user: cfg.smtpUser, pass: cfg.smtpPass }
        : undefined,
  });
}

export async function sendInviteEmail(
  toEmail: string,
  inviterName: string,
  profileNames: string[],
  inviteUrl: string
): Promise<void> {
  const cfg = getEmailConfig();
  if (!cfg.smtpHost) {
    console.warn('SMTP not configured — skipping invite email to', toEmail);
    return;
  }

  const who =
    profileNames.length <= 1
      ? (profileNames[0] ?? 'a care profile')
      : profileNames.length <= 5
        ? profileNames.join(', ')
        : `${profileNames.length} people`;
  const circleWord = profileNames.length > 1 ? 'care circles' : 'care circle';

  const transport = getTransport();
  await transport.sendMail({
    from: cfg.from,
    to: toEmail,
    subject: `${inviterName} has invited you to PareCare`,
    text: [
      `${inviterName} has invited you to join the ${circleWord} for ${who} on PareCare.`,
      '',
      'Accept your invitation:',
      inviteUrl,
      '',
      'If you do not have a PareCare account yet, the link above will create one for you.',
      '',
      'PareCare helps people coordinate care for anyone who needs it, including themselves.',
    ].join('\n'),
    html: `
      <p>${inviterName} has invited you to join the ${circleWord} for <strong>${who}</strong> on PareCare.</p>
      <p><a href="${inviteUrl}">Accept invitation</a></p>
      <p>If you do not have a PareCare account yet, the link above will create one for you.</p>
      <p style="color:#888;font-size:12px">PareCare helps people coordinate care for anyone who needs it, including themselves.</p>
    `,
  });
}

export async function sendReminderEmail(
  toEmail: string,
  displayName: string,
  title: string,
  body: string | null
): Promise<void> {
  const cfg = getEmailConfig();
  if (!cfg.smtpHost) return;

  const transport = getTransport();
  await transport.sendMail({
    from: cfg.from,
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

/**
 * Send a diagnostic email to verify the current SMTP settings. Unlike the
 * fire-and-forget senders above, this throws so the settings screen can show
 * the transport error.
 */
export async function sendTestEmail(toEmail: string): Promise<void> {
  const cfg = getEmailConfig();
  if (!cfg.smtpHost) {
    throw Object.assign(new Error('No SMTP host is configured.'), { status: 400, code: 'EMAIL_NOT_CONFIGURED' });
  }
  const transport = getTransport();
  await transport.sendMail({
    from: cfg.from,
    to: toEmail,
    subject: 'PareCare test email',
    text: 'This is a test email from PareCare. Your SMTP settings are working.',
    html: '<p>This is a test email from PareCare. Your SMTP settings are working.</p>',
  });
}

/**
 * A notification bundle: one email carrying one or many notification
 * lines, each with its deep link. Used for instant urgent alerts and for
 * digests alike.
 */
export async function sendNotificationEmail(
  toEmail: string,
  subject: string,
  lines: Array<{ text: string; url: string }>
): Promise<void> {
  const cfg = getEmailConfig();
  if (!cfg.smtpHost) throw new Error('Email is not configured. Set the SMTP details in the admin settings.');

  const transport = getTransport();
  await transport.sendMail({
    from: cfg.from,
    to: toEmail,
    subject,
    text: lines.map((l) => `- ${l.text}\n  ${l.url}`).join('\n'),
    html: `<ul>${lines.map((l) => `<li>${l.text} <a href="${l.url}">Open</a></li>`).join('')}</ul>`,
  });
}
