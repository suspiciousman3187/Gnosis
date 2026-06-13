import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const ENDPOINT  = process.env.R2_ENDPOINT;
const ACCESS    = process.env.R2_ACCESS_KEY_ID;
const SECRET    = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET    = process.env.R2_BUCKET ?? 'shared-reports';

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  if (!ENDPOINT || !ACCESS || !SECRET) {
    throw new Error('R2 env not configured: set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY');
  }
  _client = new S3Client({
    region: 'auto',
    endpoint: ENDPOINT,
    credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return _client;
}

export function r2Bucket(): string { return BUCKET; }

export async function r2Head(key: string): Promise<{ size: number; etag: string | null } | null> {
  try {
    const res = await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return { size: res.ContentLength ?? 0, etag: res.ETag ?? null };
  } catch (e) {
    const code = (e as { name?: string; $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (code === 404) return null;
    throw e;
  }
}

export async function r2GetBuffer(key: string): Promise<ArrayBuffer> {
  const res = await client().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`R2 object empty: ${key}`);
  return res.Body.transformToByteArray().then(u8 => u8.buffer as ArrayBuffer);
}

export async function r2PresignPut(key: string, opts: { ttlSeconds: number; contentType?: string; maxBytes?: number }): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: opts.contentType ?? 'application/gzip',
    ContentLength: opts.maxBytes,
  });
  return getSignedUrl(client(), cmd, { expiresIn: opts.ttlSeconds, unhoistableHeaders: new Set(['content-length']) });
}

export async function r2Delete(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function r2DeleteMany(keys: string[]): Promise<{ deleted: number; errors: string[] }> {
  if (keys.length === 0) return { deleted: 0, errors: [] };
  const errors: string[] = [];
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    const res = await client().send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: chunk.map(Key => ({ Key })), Quiet: true },
    }));
    deleted += chunk.length - (res.Errors?.length ?? 0);
    for (const err of res.Errors ?? []) errors.push(`${err.Key}: ${err.Message}`);
  }
  return { deleted, errors };
}

export async function r2List(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res = await client().send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: token,
    }));
    for (const o of res.Contents ?? []) if (o.Key) out.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}
