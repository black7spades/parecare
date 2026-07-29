import * as fs from 'node:fs';
import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getBackupConfig } from '../config/settings';

/**
 * Keeping copies in object storage, for people who already have somewhere
 * they trust.
 *
 * One set of details covers Backblaze B2, Wasabi, Cloudflare R2, MinIO,
 * DigitalOcean Spaces and Amazon itself, because they all speak the same
 * protocol. That is why this sits behind an Advanced heading rather than
 * being offered first: it is the option for someone who already knows they
 * want it, and everyone else is better served by the two buttons above it.
 */

const PREFIX = 'parecare-backups/';

export function s3Configured(): boolean {
  const cfg = getBackupConfig();
  return !!cfg.s3Bucket && !!cfg.s3AccessKey && !!cfg.s3SecretKey;
}

export function s3Account(): string | undefined {
  const cfg = getBackupConfig();
  if (!cfg.s3Bucket) return undefined;
  return cfg.s3Endpoint ? `${cfg.s3Bucket} at ${cfg.s3Endpoint}` : cfg.s3Bucket;
}

function client(): S3Client {
  const cfg = getBackupConfig();
  return new S3Client({
    region: cfg.s3Region,
    credentials: { accessKeyId: cfg.s3AccessKey!, secretAccessKey: cfg.s3SecretKey! },
    endpoint: cfg.s3Endpoint,
    // Anything that is not Amazon itself expects the bucket in the path.
    forcePathStyle: !!cfg.s3Endpoint,
  });
}

/**
 * Prove the details work before anyone relies on them. Storage that quietly
 * rejects every copy looks exactly like storage that is working, right up
 * until the day it is needed.
 */
export async function testS3(): Promise<{ ok: boolean; message: string }> {
  if (!s3Configured()) {
    return { ok: false, message: 'Fill in the bucket, the access key and the secret key first.' };
  }
  try {
    await client().send(new HeadBucketCommand({ Bucket: getBackupConfig().s3Bucket! }));
    return { ok: true, message: 'Connected. Copies will be kept there from now on.' };
  } catch (err) {
    return {
      ok: false,
      message: `Those details did not work: ${(err as Error).message}. Check the bucket name, the keys and the address.`,
    };
  }
}

export async function sendToS3(
  filePath: string,
  filename: string
): Promise<{ ok: boolean; ref?: string; message: string }> {
  if (!s3Configured()) {
    return { ok: false, message: 'Storage for copies is not set up.' };
  }
  const key = `${PREFIX}${filename}`;
  try {
    await client().send(
      new PutObjectCommand({
        Bucket: getBackupConfig().s3Bucket!,
        Key: key,
        // Streamed with the length given, so a large copy is never read into
        // memory just to be sent.
        Body: fs.createReadStream(filePath),
        ContentLength: fs.statSync(filePath).size,
        ContentType: 'application/gzip',
      })
    );
    return { ok: true, ref: key, message: 'A copy has been kept in your storage.' };
  } catch (err) {
    return { ok: false, message: `The copy could not be sent to your storage: ${(err as Error).message}` };
  }
}

export async function removeFromS3(ref: string): Promise<void> {
  if (!s3Configured()) return;
  await client()
    .send(new DeleteObjectCommand({ Bucket: getBackupConfig().s3Bucket!, Key: ref }))
    .catch(() => {});
}
