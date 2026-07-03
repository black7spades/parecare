import crypto from 'node:crypto';
import { env } from './env';

/**
 * Authenticated encryption for secret settings stored in the database
 * (API keys, SMTP password, and the like). AES-256-GCM with the key derived
 * from JWT_SECRET, so no new required environment variable is introduced.
 *
 * Note: rotating JWT_SECRET makes previously stored secrets undecryptable.
 * The settings service treats a decrypt failure as "not set" and falls back
 * to the environment value, so this degrades gracefully; re-enter the secret
 * in the settings screen to fix it.
 */

const KEY = crypto.scryptSync(env.JWT_SECRET, 'parecare-settings-v1', 32);

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unrecognised secret payload format');
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
