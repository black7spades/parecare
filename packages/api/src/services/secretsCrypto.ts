import crypto from 'crypto';
import { env } from '../config/env';

/**
 * Encryption for the few things PareCare stores that are credentials rather
 * than care records: the Wi-Fi password on an address, and the logins kept in
 * the secrets vault. These are written encrypted so a database dump, a backup
 * or a stray query does not spill them in the clear.
 *
 * AES-256-GCM, a fresh random nonce per value, with the authentication tag
 * kept alongside so tampering is detected on read. The stored form is
 * `v1:<nonce>:<tag>:<ciphertext>`, all base64.
 *
 * The key comes from SECRETS_ENCRYPTION_KEY when set. Otherwise it is derived
 * from JWT_SECRET, so a self-hosted deployment works without extra setup;
 * rotating JWT_SECRET then makes stored credentials unreadable, which is why
 * setting a dedicated key is worth it.
 */

const PREFIX = 'v1';
const SALT = 'parecare-secrets-v1';

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const source = env.SECRETS_ENCRYPTION_KEY ?? env.JWT_SECRET;
  cachedKey = crypto.scryptSync(source, SALT, 32);
  return cachedKey;
}

/** True when a stored value is already in the encrypted envelope form. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${PREFIX}:`) && value.split(':').length === 4;
}

/**
 * Encrypt a credential for storage. Null, undefined and the empty string pass
 * straight through as null, so "cleared" stays cleared rather than becoming
 * an encrypted empty string.
 */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain == null) return null;
  const value = String(plain);
  if (value === '') return null;
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), nonce);
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, nonce.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

/**
 * Decrypt a stored credential. A value that is not in the envelope form is
 * returned as-is, so anything written before encryption was introduced still
 * reads back rather than throwing. A value that fails its authentication tag
 * (a wrong or rotated key, or tampering) returns null instead of throwing, so
 * one unreadable row cannot take down a whole listing.
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored == null || stored === '') return null;
  if (!isEncrypted(stored)) return stored;
  const [, nonceB64, tagB64, dataB64] = stored.split(':');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(nonceB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
