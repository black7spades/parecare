import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs';
import * as path from 'path';
import { getStorageConfig } from '../config/settings';

function getS3Client(): S3Client {
  const cfg = getStorageConfig();
  return new S3Client({
    region: cfg.s3Region,
    credentials:
      cfg.s3AccessKey && cfg.s3SecretKey
        ? { accessKeyId: cfg.s3AccessKey, secretAccessKey: cfg.s3SecretKey }
        : undefined,
    endpoint: cfg.s3Endpoint,
    forcePathStyle: !!cfg.s3Endpoint,
  });
}

export async function uploadFile(
  buffer: Buffer,
  key: string,
  mimeType: string
): Promise<string> {
  const cfg = getStorageConfig();
  if (cfg.provider === 's3') {
    if (!cfg.s3Bucket) throw new Error('S3 bucket is not configured');
    const client = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.s3Bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      })
    );
    return `s3://${cfg.s3Bucket}/${key}`;
  }

  const localPath = path.join(cfg.localPath, key);
  await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
  await fs.promises.writeFile(localPath, buffer);
  return `/uploads/${key}`;
}

export async function deleteFile(fileUrl: string): Promise<void> {
  const cfg = getStorageConfig();
  if (cfg.provider === 's3' && fileUrl.startsWith('s3://')) {
    const withoutScheme = fileUrl.slice(5);
    const slashIndex = withoutScheme.indexOf('/');
    const bucket = withoutScheme.slice(0, slashIndex);
    const key = withoutScheme.slice(slashIndex + 1);
    const client = getS3Client();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return;
  }

  if (fileUrl.startsWith('/uploads/')) {
    const localPath = path.join(cfg.localPath, fileUrl.slice('/uploads/'.length));
    await fs.promises.unlink(localPath).catch(() => {});
  }
}

export async function getDownloadUrl(fileUrl: string): Promise<string> {
  if (getStorageConfig().provider === 's3' && fileUrl.startsWith('s3://')) {
    const withoutScheme = fileUrl.slice(5);
    const slashIndex = withoutScheme.indexOf('/');
    const bucket = withoutScheme.slice(0, slashIndex);
    const key = withoutScheme.slice(slashIndex + 1);
    const client = getS3Client();
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: 3600,
    });
  }
  return fileUrl;
}
