// What may be stored: a small allowlist of types, each checked against the file's first bytes, plus safe names.
// SVG and HTML are deliberately not allowed: a stored script that is later served from our domain would run as the app.
const startsWith = (b, ...bytes) => bytes.every((v, i) => b[i] === v);
const ascii = (b, s, at = 0) => [...s].every((ch, i) => b[at + i] === ch.charCodeAt(0));
const SNIFF = {
    'image/png': (b) => startsWith(b, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    'image/jpeg': (b) => startsWith(b, 0xff, 0xd8, 0xff),
    'image/gif': (b) => ascii(b, 'GIF87a') || ascii(b, 'GIF89a'),
    'image/webp': (b) => ascii(b, 'RIFF') && ascii(b, 'WEBP', 8),
    'application/pdf': (b) => ascii(b, '%PDF-'),
    'audio/mpeg': (b) => ascii(b, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
    'text/plain': (b) => { if (b.includes(0)) return false; try { new TextDecoder('utf-8', { fatal: true }).decode(b); return true; } catch { return false; } },
};
export const ALLOWED_TYPES = Object.keys(SNIFF);
export const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'audio/mpeg']);

export function checkFile({ contentType, bytes, maxBytes }) {
    if (typeof contentType !== 'string' || !Object.hasOwn(SNIFF, contentType)) return { ok: false, status: 415, code: 'type_not_allowed' };
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) return { ok: false, status: 400, code: 'empty_file' };
    if (bytes.length > maxBytes) return { ok: false, status: 413, code: 'file_too_large' };
    if (!SNIFF[contentType](bytes)) return { ok: false, status: 415, code: 'content_mismatch' };
    return { ok: true };
}

/** A display name that is safe in a key and a header: base name only, limited characters, bounded length, never empty. */
export function safeName(name) {
    const base = String(name ?? '').split(/[\\/]/).pop().normalize('NFKC').replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^\.+/, '').replace(/\s+/g, ' ').trim().slice(0, 100);
    return base || 'file';
}
