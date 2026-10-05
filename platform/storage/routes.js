// HTTP mapping for storage: every operation needs a signed-in user of the app. Errors are short codes only.
export const STORAGE_OPS = ['upload', 'list', 'url', 'delete'];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export async function handleStorage({ op, bearer, query, contentType, body, json, appId, auth, storage }) {
    if (!storage || !auth) return { status: 503, body: { error: 'storage_unavailable' } };
    const session = await auth.verifySession({ appId, token: bearer });
    if (!session.ok) return { status: 401, body: { error: 'unauthorized' } };
    const userId = session.user.id;
    const out = (r, ok) => (r.ok ? { status: 200, body: ok(r) } : { status: r.status ?? 500, body: { error: r.code ?? 'error' } });
    if (op === 'upload') return out(await storage.upload({ appId, userId, name: query.get('name'), contentType: String(contentType || '').split(';')[0].trim().toLowerCase(), bytes: body, isPublic: query.get('public') === '1' }), (r) => ({ file: r.file }));
    if (op === 'list') return out(await storage.list({ appId, userId }), (r) => ({ files: r.files }));
    if (op === 'url') return out(await storage.downloadUrl({ appId, userId, id: json?.id }), (r) => ({ url: r.url, expiresInSec: r.expiresInSec }));
    if (op === 'delete') return out(await storage.remove({ appId, userId, id: json?.id }), () => ({ ok: true }));
    return { status: 404, body: { error: 'not_found' } };
}
