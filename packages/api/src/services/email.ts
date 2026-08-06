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
 * A composed alert email: one or more titled sections, each a short list of
 * lines with a deep link and an optional second action such as a reorder link.
 * This is what a watch sends: an immediate alert is one section, a digest
 * bundles several (supply, appointments, a medication record) into one email.
 */
export interface AlertSection {
  title: string;
  lines: Array<{ text: string; url: string; actionText?: string; actionUrl?: string }>;
}

export async function sendAlertEmail(toEmail: string, subject: string, sections: AlertSection[]): Promise<void> {
  const cfg = getEmailConfig();
  if (!cfg.smtpHost) throw new Error('Email is not configured. Set the SMTP details in the admin settings.');

  const text = sections
    .map((s) => [
      s.title,
      ...s.lines.map((l) => `  - ${l.text}\n    ${l.url}${l.actionText && l.actionUrl ? `\n    ${l.actionText}: ${l.actionUrl}` : ''}`),
    ].join('\n'))
    .join('\n\n');

  const html = sections
    .map((s) => `
      <h3 style="margin:16px 0 6px;font-size:15px">${s.title}</h3>
      <ul style="margin:0;padding-left:18px">
        ${s.lines
          .map(
            (l) => `<li style="margin:0 0 6px">${l.text} <a href="${l.url}">Open</a>${
              l.actionText && l.actionUrl ? ` · <a href="${l.actionUrl}">${l.actionText}</a>` : ''
            }</li>`
          )
          .join('')}
      </ul>`)
    .join('');

  const transport = getTransport();
  await transport.sendMail({ from: cfg.from, to: toEmail, subject, text, html });
}

/**
 * The link back in, for somebody who cannot get to their records.
 *
 * Short, because a person who has forgotten a password is already annoyed,
 * and every extra sentence is one more thing between them and being back.
 * It says plainly what to do if they did not ask for it, since an unexpected
 * reset email is alarming and the right answer is almost always "nothing".
 */
export async function sendPasswordResetEmail(
  toEmail: string,
  displayName: string,
  url: string,
  minutes: number
): Promise<void> {
  const cfg = getEmailConfig();
  if (!cfg.smtpHost) {
    throw new Error('Email has not been set up for this installation yet, so nothing could be sent');
  }

  const lines = [
    `Hello ${displayName},`,
    '',
    'Follow this link to choose a new password:',
    '',
    `  ${url}`,
    '',
    `It works once, and it stops working after ${minutes} minutes. Ask for another whenever you need one.`,
    '',
    'Choosing a new password also signs out anything already signed in as you, on every device.',
    '',
    'If you did not ask for this, you can ignore it. Your password has not changed, and nobody can use this link without your inbox.',
  ];

  const transport = getTransport();
  await transport.sendMail({
    from: cfg.from,
    to: toEmail,
    subject: 'Choose a new PareCare password',
    text: lines.join('\n'),
    html: lines.map((l) => (l === '' ? '<br>' : `<p style="margin:0 0 8px">${l.trim()}</p>`)).join(''),
  });
}

/**
 * For somebody who asked to reset a password they do not have, because they
 * sign in with Google or Facebook. Sending them a reset link would set a
 * password they would never use and leave them no closer to getting in.
 */
export async function sendOAuthReminderEmail(
  toEmail: string,
  displayName: string,
  provider: string
): Promise<void> {
  const cfg = getEmailConfig();
  if (!cfg.smtpHost) return;

  const nice = provider === 'facebook' ? 'Facebook' : 'Google';
  const lines = [
    `Hello ${displayName},`,
    '',
    `Somebody asked to reset the password on this PareCare account, but this account does not have one: you sign in with ${nice}.`,
    '',
    `Go to the sign-in page and press the ${nice} button instead. There is no password to remember or to change.`,
    '',
    'If you did not ask for this, you can ignore it. Nothing has changed.',
  ];

  const transport = getTransport();
  await transport.sendMail({
    from: cfg.from,
    to: toEmail,
    subject: `You sign in to PareCare with ${nice}`,
    text: lines.join('\n'),
    html: lines.map((l) => (l === '' ? '<br>' : `<p style="margin:0 0 8px">${l.trim()}</p>`)).join(''),
  });
}
