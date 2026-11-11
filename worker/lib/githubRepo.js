// Deletes the private GitHub repo the worker created for an app (see createGitHubRepo in server.js, org-owned, named app-<projectId>).
// Used by account deletion. Idempotent: a repo that is already gone counts as deleted. The token goes only to api.github.com and
// is never logged, returned, or placed in an error message.
const REPO_NAME = /^app-[A-Za-z0-9-]{8,64}$/;

export const isAppRepoName = (name) => typeof name === 'string' && REPO_NAME.test(name);

/** Resolves { ok: true, alreadyGone } or { ok: false, status } (status 0 = unreachable, 400 = refused name, 503 = not configured). Never throws. */
export async function deleteAppRepo({ pat, org, repoName, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
    if (!isAppRepoName(repoName)) return { ok: false, status: 400 };
    if (!pat || !org) return { ok: false, status: 503 };
    try {
        const r = await fetchImpl(`https://api.github.com/repos/${encodeURIComponent(org)}/${encodeURIComponent(repoName)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${pat}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
            redirect: 'manual',
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (r.status === 204) return { ok: true, alreadyGone: false };
        if (r.status === 404) return { ok: true, alreadyGone: true };   // never existed, or already deleted
        return { ok: false, status: r.status };
    } catch {
        return { ok: false, status: 0 };
    }
}
