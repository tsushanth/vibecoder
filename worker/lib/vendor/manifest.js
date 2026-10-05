// Validates the connector manifest a generated app declares. The manifest is untrusted input.
import { validatePay } from '../pay/catalog.js';
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
const FIELD = /^[A-Za-z0-9_-]{1,64}$/;
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'content-type', 'transfer-encoding', 'connection', 'cookie', 'set-cookie', 'origin', 'referer', 'x-forwarded-for', 'x-forwarded-host']);
const INTERNAL = ['.internal', '.local', '.localhost', '.lan', '.home', '.corp'];
export const MAX_CONNECTORS = 20;

function pathProblem(p) {
    if (typeof p !== 'string' || !p.startsWith('/')) return 'must start with /';
    if (/[?#\\]/.test(p) || p.split('/').some((s) => s === '..' || s === '.')) return 'must not contain ?, #, backslash or dot segments';
    const star = p.indexOf('*');
    if (star !== -1 && star !== p.length - 1) return 'a * is only allowed at the very end';
    return null;
}

export function validateManifest(m, { allowHeaders = false } = {}) {
    const problems = [];
    const hasPay = !!m && typeof m === 'object' && m.pay !== undefined;
    if (hasPay) problems.push(...validatePay(m.pay).problems.map((p) => `pay: ${p}`));
    if (!m || typeof m !== 'object' || (!hasPay && (!m.connectors || typeof m.connectors !== 'object' || Array.isArray(m.connectors)))
        || (hasPay && m.connectors !== undefined && (!m.connectors || typeof m.connectors !== 'object' || Array.isArray(m.connectors)))) {
        return { ok: false, problems: ['manifest must be an object with a connectors object'] };
    }
    const entries = Object.entries(m.connectors || {});
    if (!entries.length && !hasPay) problems.push('manifest declares no connectors');
    if (entries.length > MAX_CONNECTORS) problems.push(`too many connectors (max ${MAX_CONNECTORS})`);
    for (const [name, c] of entries) {
        const at = `connector "${String(name).slice(0, 40)}"`;
        if (!NAME.test(name)) problems.push(`${at}: invalid connector name (lowercase letters, digits, - and _, max 32)`);
        if (!c || typeof c !== 'object') { problems.push(`${at}: must be an object`); continue; }
        const host = typeof c.host === 'string' ? c.host.toLowerCase() : '';
        if (!HOST.test(host) || INTERNAL.some((s) => host.endsWith(s)) || host === 'localhost') problems.push(`${at}: invalid host (a public hostname only: no scheme, port, path or IP)`);
        if (!Array.isArray(c.paths) || !c.paths.length) problems.push(`${at}: paths must be a non-empty list`);
        else for (const p of c.paths) { const e = pathProblem(p); if (e) problems.push(`${at}: path ${JSON.stringify(String(p).slice(0, 60))} ${e}`); }
        if (!Array.isArray(c.methods) || !c.methods.length || c.methods.some((x) => !METHODS.has(x))) problems.push(`${at}: methods must be a non-empty list of GET, POST, PUT, PATCH, DELETE`);
        if (c.headers !== undefined && !allowHeaders) problems.push(`${at}: fixed headers are only allowed on platform built-ins`);
        if (c.secret !== undefined) {
            const s = c.secret;
            if (!s || typeof s !== 'object') problems.push(`${at}: secret must be an object`);
            else {
                if (!SECRET_NAME.test(s.name || '')) problems.push(`${at}: secret name must be UPPER_SNAKE_CASE`);
                if (!['header', 'query', 'body'].includes(s.in)) problems.push(`${at}: secret.in must be header, query or body`);
                else if (!FIELD.test(s.field || '')) problems.push(`${at}: secret needs a field name`);
                else if (s.in === 'header' && FORBIDDEN_HEADERS.has(String(s.field).toLowerCase())) problems.push(`${at}: secret header "${s.field}" is not allowed`);
            }
        }
    }
    return { ok: problems.length === 0, problems };
}
