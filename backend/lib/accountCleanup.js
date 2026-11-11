// Removes the data of a deleted account that lives OUTSIDE the main database, so account deletion leaves nothing behind:
//   - the private GitHub repo the build worker created for each project (deleted through the worker, which alone holds the GitHub token),
//   - the preview screenshots in storage (project-assets/thumbnails/<projectId>.jpg),
//   - the app keys stored in the data proxy's vault (under the project-id app and under each site's subdomain app).
// Every step is idempotent (something already gone counts as done), runs for all items even if one fails, never throws, and logs
// only counts and status codes: no user id, project id, repo name or key name. `failed` names the steps that need a retry.
import { WORKER_URL, WORKER_SECRET } from '../config/constants.js';

const THUMBNAIL_BUCKET = 'project-assets';
const REMOVE_BATCH = 100;
const REPO_NAME = /^app-[A-Za-z0-9-]{8,64}$/;

// Runs fn over items with at most `limit` in flight; results keep the item order.
async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const lane = async () => { for (;;) { const i = next++; if (i >= items.length) return; out[i] = await fn(items[i]); } };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
    return out;
}

/** The repo names to delete: the stored one plus the one the worker names after every project (covers a repo whose name never got saved). */
export function repoNamesFor(projects) {
    const names = new Set();
    for (const p of projects || []) {
        if (typeof p?.github_repo === 'string' && REPO_NAME.test(p.github_repo)) names.add(p.github_repo);
        if (typeof p?.id === 'string') { const n = `app-${p.id}`; if (REPO_NAME.test(n)) names.add(n); }
    }
    return [...names];
}

/** Deletes each repo through the worker. 2xx (including "already gone") is success; anything else, including a worker that
 *  does not know the route yet (404), is a failure, so an old worker never makes this silently do nothing. */
export async function deleteProjectRepos(repoNames, { fetchImpl = globalThis.fetch, workerUrl = WORKER_URL, workerSecret = WORKER_SECRET, log = console.warn, timeoutMs = 30000 } = {}) {
    const results = await mapLimit(repoNames, 4, async (name) => {
        try {
            const r = await fetchImpl(`${workerUrl}/repo/${encodeURIComponent(name)}`, { method: 'DELETE', headers: { 'x-worker-secret': workerSecret }, signal: AbortSignal.timeout(timeoutMs) });
            if (r.ok) return { ok: true };
            return { ok: false, why: `http_${r.status}` };
        } catch (e) {
            return { ok: false, why: e?.name === 'TimeoutError' ? 'timeout' : 'unreachable' };
        }
    });
    const bad = results.filter((r) => !r.ok);
    if (bad.length) log(`[account-cleanup] github repos: ${bad.length} of ${repoNames.length} not deleted (${[...new Set(bad.map((b) => b.why))].join(',')})`);
    return { total: repoNames.length, failed: bad.length };
}

/** Removes the stored screenshot of each project. Removing a missing object is not an error in storage. */
export async function deleteThumbnails(projectIds, storage, { log = console.warn } = {}) {
    const paths = (projectIds || []).filter((id) => typeof id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(id)).map((id) => `thumbnails/${id}.jpg`);
    let failed = 0;
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
        const batch = paths.slice(i, i + REMOVE_BATCH);
        try {
            const { error } = await storage.from(THUMBNAIL_BUCKET).remove(batch);
            if (error) { failed += batch.length; log(`[account-cleanup] screenshots: batch of ${batch.length} not removed (${error.statusCode || error.status || 'error'})`); }
        } catch {
            failed += batch.length; log(`[account-cleanup] screenshots: batch of ${batch.length} not removed (unreachable)`);
        }
    }
    return { total: paths.length, failed };
}

/** Deletes every stored key of each proxy app (project-id apps and subdomain apps). An app the proxy does not know holds none.
 *  With no proxy configured nothing was ever stored (key capture needs it), so that is skipped, not failed. */
export async function deleteAppKeys(appIds, proxyAdmin, { log = console.warn } = {}) {
    const ids = [...new Set((appIds || []).filter((s) => typeof s === 'string' && s))];
    if (!ids.length) return { total: 0, failed: 0, deleted: 0 };
    if (!proxyAdmin?.configured) { log('[account-cleanup] keys: proxy not configured, skipped'); return { total: ids.length, failed: 0, deleted: 0, skipped: true }; }
    let deleted = 0;
    const results = await mapLimit(ids, 4, async (appId) => {
        let names;
        try { names = (await proxyAdmin.listSecrets(appId)).map((s) => s?.name).filter((n) => typeof n === 'string'); }
        catch (e) { return e?.code === 'unknown_app' || e?.status === 404 ? { ok: true } : { ok: false, why: e?.code || 'error' }; }
        let ok = true; let why = '';
        for (const name of names) {
            try { await proxyAdmin.deleteSecret(appId, name); deleted++; }
            catch (e) { if (!(e?.code === 'unknown_app' || e?.status === 404)) { ok = false; why = e?.code || 'error'; } }
        }
        return ok ? { ok: true } : { ok: false, why };
    });
    const bad = results.filter((r) => !r.ok);
    if (bad.length) log(`[account-cleanup] keys: ${bad.length} of ${ids.length} apps not cleared (${[...new Set(bad.map((b) => b.why))].join(',')})`);
    return { total: ids.length, failed: bad.length, deleted };
}

/** All three, for one account. Returns { failed: ['github'|'screenshots'|'keys', ...] } (empty = everything removed). Never throws. */
export async function deleteAccountExternalData({ projects, subdomains = [], proxyAdmin, storage, fetchImpl, log = console.warn } = {}) {
    const failed = [];
    const ids = (projects || []).map((p) => p?.id).filter(Boolean);
    try {
        const repos = await deleteProjectRepos(repoNamesFor(projects), { fetchImpl, log });
        if (repos.failed) failed.push('github');
    } catch { failed.push('github'); }
    try {
        const shots = await deleteThumbnails(ids, storage, { log });
        if (shots.failed) failed.push('screenshots');
    } catch { failed.push('screenshots'); }
    try {
        const keys = await deleteAppKeys([...ids, ...subdomains], proxyAdmin, { log });
        if (keys.failed) failed.push('keys');
    } catch { failed.push('keys'); }
    return { failed };
}
