import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs';
import * as path from 'path';
import { env } from '../config/env';

function getS3Client(): S3Client {
  return new S3Client({
    region: env.S3_REGION,
    credentials:
      env.S3_ACCESS_KEY && env.S3_SECRET_KEY
        ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY }
        : undefined,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: !!env.S3_ENDPOINT,
  });
}

export async function uploadFile(
  buffer: Buffer,
  key: string,
  mimeType: string
): Promise<string> {
  if (env.STORAGE_PROVIDER === 's3') {
    if (!env.S3_BUCKET) throw new Error('S3_BUCKET is not configured');
    const client = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      })
    );
    return `s3://${env.S3_BUCKET}/${key}`;
  }

  const localPath = path.join(env.STORAGE_LOCAL_PATH, key);
  await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
  await fs.promises.writeFile(localPath, buffer);
  return `/uploads/${key}`;
}

export async function deleteFile(fileUrl: string): Promise<void> {
  if (env.STORAGE_PROVIDER === 's3' && fileUrl.startsWith('s3://')) {
    const withoutScheme = fileUrl.slice(5);
    const slashIndex = withoutScheme.indexOf('/');
    const bucket = withoutScheme.slice(0, slashIndex);
    const key = withoutScheme.slice(slashIndex + 1);
    const client = getS3Client();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return;
  }

  if (fileUrl.startsWith('/uploads/')) {
    const localPath = path.join(env.STORAGE_LOCAL_PATH, fileUrl.slice('/uploads/'.length));
    await fs.promises.unlink(localPath).catch(() => {});
  }
}

export async function getDownloadUrl(fileUrl: string): Promise<string> {
  if (env.STORAGE_PROVIDER === 's3' && fileUrl.startsWith('s3://')) {
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
