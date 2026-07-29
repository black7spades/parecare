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

/**
 * What being a data warden means, sent to the person who has just been asked.
 *
 * Written for someone who did not volunteer and may not think of themselves
 * as technical. It says why they were picked, what they would actually have
 * to do, that it is one screen and a button, and that they are not being
 * asked to look after anything day to day. The one ask is that they sign in
 * once now, so that both people know it works before it matters.
 */
export async function sendWardenBriefEmail(
  toEmail: string,
  wardenName: string,
  askedByName: string,
  backupsUrl: string
): Promise<void> {
  const cfg = getEmailConfig();
  if (!cfg.smtpHost) {
    // Every other email here quietly skips when there is no email set up.
    // This one must not: a level is earned by the warden having been told,
    // and reporting "sent" when nothing was sent would award it for nothing.
    throw new Error('Email has not been set up for this installation yet, so nothing could be sent.');
  }

  const lines = [
    `Hello ${wardenName},`,
    '',
    `${askedByName} has asked you to be a data warden on their PareCare, which keeps track of someone's care: their medications, appointments, conditions and documents.`,
    '',
    'It means one thing. If something ever happens to that record, or to them, you are able to get everything back. Copies are made automatically every day, so there is nothing for you to look after and nothing to remember.',
    '',
    'There is one screen. It says whether the copies are working, and it has a button to put everything back as it was on a chosen day. You do not need to understand how any of it works, and you cannot break anything by looking.',
    '',
    'The one thing worth doing now, while nothing is wrong:',
    '',
    `  1. Sign in at ${backupsUrl}`,
    '  2. Look at the page for a moment so you know where it is',
    '',
    'That is all. Doing it now means that if it is ever needed, you have already been there once, on an ordinary day, rather than finding it for the first time on a bad one.',
    '',
    'Thank you for saying yes.',
  ];

  const transport = getTransport();
  await transport.sendMail({
    from: cfg.from,
    to: toEmail,
    subject: `${askedByName} has asked you to look after their PareCare records`,
    text: lines.join('\n'),
    html: lines
      .map((l) => (l === '' ? '<br>' : `<p style="margin:0 0 8px">${l.replace(/^ {2}/, '&nbsp;&nbsp;')}</p>`))
      .join(''),
  });
}
