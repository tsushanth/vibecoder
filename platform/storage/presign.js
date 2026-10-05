// AWS Signature V4 query-string presigning for S3-compatible storage (Cloudflare R2). No dependencies.
// The URL carries its own expiry; nothing here talks to the network.
import { createHash, createHmac } from 'node:crypto';

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
const hex = (s) => createHash('sha256').update(s).digest('hex');
// RFC 3986 encoding as SigV4 requires (encodeURIComponent leaves !'()* alone).
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encPath = (p) => p.split('/').map(enc).join('/');

/**
 * Returns a presigned URL. `host` is the endpoint host (for R2 path style: `<account>.r2.cloudflarestorage.com`), `path` the
 * full object path starting with "/" (path style: "/bucket/key"). Only the host header (and any `signedHeaders` given) is signed.
 */
export function presignUrl({ method = 'GET', host, path, expiresSec = 300, accessKeyId, secretAccessKey, region = 'auto', service = 's3', now = Date.now(), query = {}, signedHeaders = {} }) {
    if (!host || !path?.startsWith('/') || !accessKeyId || !secretAccessKey) throw new Error('presign: missing parameters');
    if (!Number.isInteger(expiresSec) || expiresSec < 1 || expiresSec > 604800) throw new Error('presign: bad expiry');
    const iso = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const date = iso.slice(0, 8);
    const scope = `${date}/${region}/${service}/aws4_request`;
    const headers = { host, ...Object.fromEntries(Object.entries(signedHeaders).map(([k, v]) => [k.toLowerCase(), String(v).trim()])) };
    const names = Object.keys(headers).sort();
    const params = { ...query, 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${accessKeyId}/${scope}`, 'X-Amz-Date': iso, 'X-Amz-Expires': String(expiresSec), 'X-Amz-SignedHeaders': names.join(';') };
    const canonicalQuery = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join('&');
    const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
    const canonical = [method, encPath(path), canonicalQuery, canonicalHeaders, names.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
    const toSign = ['AWS4-HMAC-SHA256', iso, scope, hex(canonical)].join('\n');
    const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), service), 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
    return `https://${host}${encPath(path)}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
