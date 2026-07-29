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

/**
 * The invitation, for someone who may not have an account at all.
 *
 * One link that works whoever they are: it makes their account if they have
 * none, signs them in if they do, and puts them on the one screen they would
 * ever need. Nothing is asked of them beyond following it once.
 */
export async function sendWardenInviteEmail(
  toEmail: string,
  askedByName: string,
  inviteUrl: string
): Promise<void> {
  const cfg = getEmailConfig();
  if (!cfg.smtpHost) {
    throw new Error('Email has not been set up for this installation yet, so nothing could be sent');
  }

  const lines = [
    'Hello,',
    '',
    `${askedByName} has asked you to be a data warden on their PareCare, which keeps track of someone's care: their medications, appointments, conditions and documents.`,
    '',
    'It means one thing. If something ever happens to that record, or to them, you are able to get everything back. Copies are made automatically every day, so there is nothing for you to look after and nothing to remember.',
    '',
    'There is one screen. It says whether the copies are working, and it has a button to put everything back as it was on a chosen day. You do not need to understand how any of it works, and you cannot break anything by looking.',
    '',
    'To say yes, follow this link:',
    '',
    `  ${inviteUrl}`,
    '',
    'It will set you up if you have never used PareCare before, or simply sign you in if you have, and take you straight to that screen. It is worth doing now, while nothing is wrong, so that if it is ever needed you have already been there once on an ordinary day.',
    '',
    'If you would rather not, you can ignore this and nothing happens.',
    '',
    'Thank you for considering it.',
  ];

  const transport = getTransport();
  await transport.sendMail({
    from: cfg.from,
    to: toEmail,
    subject: `${askedByName} has asked you to look after their PareCare records`,
    text: lines.join('\n'),
    html: lines.map((l) => (l === '' ? '<br>' : `<p style="margin:0 0 8px">${l.trim()}</p>`)).join(''),
  });
}

/**
 * A copy for the person who did the asking, so they know exactly what was
 * said and can talk their warden through it. Someone who has just asked a
 * favour of a friend should not have to guess what that friend received.
 */
export async function sendWardenCopyEmail(
  toEmail: string,
  askerName: string,
  wardenEmail: string,
  inviteUrl: string
): Promise<void> {
  const cfg = getEmailConfig();
  if (!cfg.smtpHost) return;

  const lines = [
    `Hello ${askerName},`,
    '',
    `You have asked ${wardenEmail} to be a data warden on your PareCare. This is what they were sent, so you know what they have been told.`,
    '',
    'They were told that copies of everything are made automatically every day, that there is nothing for them to look after, and that if something ever happens to the records or to you, they are able to get everything back from one screen.',
    '',
    'They were given this link, which sets up their account if they need one and takes them to that screen:',
    '',
    `  ${inviteUrl}`,
    '',
    'They have two weeks to follow it. If they get stuck, the link is the only thing they need, and you can send it to them again from the Backups screen.',
    '',
    'You will hear from us again when they have accepted.',
  ];

  const transport = getTransport();
  await transport.sendMail({
    from: cfg.from,
    to: toEmail,
    subject: `What ${wardenEmail} was asked`,
    text: lines.join('\n'),
    html: lines.map((l) => (l === '' ? '<br>' : `<p style="margin:0 0 8px">${l.trim()}</p>`)).join(''),
  });
}

/** Telling the person who asked that their warden has actually said yes. */
export async function sendWardenAcceptedEmail(
  toEmail: string,
  askerName: string,
  wardenName: string,
  wardenEmail: string
): Promise<void> {
  const cfg = getEmailConfig();
  if (!cfg.smtpHost) return;

  const lines = [
    `Hello ${askerName},`,
    '',
    `${wardenName} (${wardenEmail}) has accepted, and is now a data warden on your PareCare.`,
    '',
    'That means if anything ever happens to your records, or to you, they are able to get everything back without needing you. It is one of the few things that genuinely cannot be arranged after the fact, so it is worth knowing it is done.',
    '',
    'Nothing else is needed from either of you.',
  ];

  const transport = getTransport();
  await transport.sendMail({
    from: cfg.from,
    to: toEmail,
    subject: `${wardenName} is now a data warden`,
    text: lines.join('\n'),
    html: lines.map((l) => (l === '' ? '<br>' : `<p style="margin:0 0 8px">${l.trim()}</p>`)).join(''),
  });
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
