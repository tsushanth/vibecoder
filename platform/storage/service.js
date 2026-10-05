// Stores and serves end-user files for generated apps. Bytes go to an S3-compatible object store (Cloudflare R2) through
// presigned URLs the proxy creates itself; callers never see credentials, and downloads are short-lived signed URLs.
import { randomUUID } from 'node:crypto';
import { presignUrl } from './presign.js';
import { checkFile, safeName, INLINE_TYPES } from './policy.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createStorageService({ store, r2, fetchImpl = globalThis.fetch, now = () => Date.now(), limits = {}, timeoutMs = 20000 }) {
    const L = { maxFileBytes: 5 * 1024 * 1024, maxAppBytes: 200 * 1024 * 1024, maxAppFiles: 2000, downloadTtlSec: 300, ...limits };
    const objectUrl = (method, key, extra = {}) => presignUrl({ method, host: r2.host, path: `/${r2.bucket}/${key}`, accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey, now: now(), ...extra });
    const call = async (url, init) => {
        const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try { return await fetchImpl(url, { ...init, redirect: 'manual', signal: ctrl.signal }); } finally { clearTimeout(timer); }
    };

    return {
        async upload({ appId, userId, name, contentType, bytes, isPublic = false }) {
            const check = checkFile({ contentType, bytes, maxBytes: L.maxFileBytes });
            if (!check.ok) return check;
            const id = randomUUID();
            const clean = safeName(name);
            const key = `${appId}/${userId}/${id}-${clean}`;
            const res = await store.reserve({ id, appId, userId, objectKey: key, name: clean, contentType, bytes: bytes.length, isPublic, maxAppBytes: L.maxAppBytes, maxAppFiles: L.maxAppFiles });
            if (res.error) return { ok: false, status: 413, code: res.error };
            try {
                const put = await call(objectUrl('PUT', key, { expiresSec: 120, signedHeaders: { 'content-type': contentType } }), { method: 'PUT', headers: { 'content-type': contentType }, body: bytes });
                if (put.status < 200 || put.status >= 300) throw new Error('store refused');
            } catch { await store.release({ appId, id }); return { ok: false, status: 502, code: 'storage_unavailable' }; }
            return { ok: true, file: { id, name: clean, contentType, bytes: bytes.length, isPublic: !!isPublic } };
        },

        /** A short-lived download URL. Private files are only for their owner; public ones for anyone who has the (unguessable) id. */
        async downloadUrl({ appId, userId, id }) {
            if (typeof id !== 'string' || !UUID.test(id)) return { ok: false, status: 404, code: 'not_found' };
            const f = await store.get({ appId, id });
            if (!f || (!f.is_public && f.user_id !== userId)) return { ok: false, status: 404, code: 'not_found' };
            const inline = INLINE_TYPES.has(f.content_type);
            const url = objectUrl('GET', f.object_key, { expiresSec: L.downloadTtlSec, query: { 'response-content-type': f.content_type, 'response-content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${f.name}"` } });
            return { ok: true, url, expiresInSec: L.downloadTtlSec };
        },

        async list({ appId, userId }) { return { ok: true, files: (await store.list({ appId, userId })).map((f) => ({ id: f.id, name: f.name, contentType: f.content_type, bytes: Number(f.bytes), isPublic: f.is_public, createdAt: f.created_at })) }; },

        async remove({ appId, userId, id }) {
            if (typeof id !== 'string' || !UUID.test(id)) return { ok: false, status: 404, code: 'not_found' };
            const key = await store.remove({ appId, id, userId });
            if (!key) return { ok: false, status: 404, code: 'not_found' };
            try { await call(objectUrl('DELETE', key, { expiresSec: 60 }), { method: 'DELETE' }); } catch { /* the row is gone; an orphaned object is harmless and swept later */ }
            return { ok: true };
        },
    };
}
