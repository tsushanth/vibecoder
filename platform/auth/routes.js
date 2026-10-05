// Maps the auth service onto HTTP results. No secrets or tokens are ever echoed back except the session token the caller asked for.
const STATUS = { invalid_email: 400, invalid_link: 400, rate_limited: 429, send_failed: 503, unavailable: 503 };

export const AUTH_OPS = ['request', 'consume', 'me', 'signout'];

export async function handleAuth({ op, body, bearer, ip, appId, svc }) {
    if (!svc) return { status: 503, body: { error: 'auth_unavailable' } };
    const fail = (reason, status) => ({ status: status ?? STATUS[reason] ?? 401, body: { error: reason } });
    if (op === 'request') {
        const r = await svc.requestLink({ appId, email: body.email, ip });
        return r.ok ? { status: 200, body: { ok: true } } : fail(r.reason);
    }
    if (op === 'consume') {
        const r = await svc.consumeLink({ appId, token: body.token });
        return r.ok ? { status: 200, body: { token: r.token, user: r.user } } : fail(r.reason);
    }
    if (op === 'me') {
        const r = await svc.verifySession({ appId, token: bearer });
        return r.ok ? { status: 200, body: { user: r.user } } : fail('unauthorized', 401);
    }
    if (op === 'signout') {
        const r = await svc.signOut({ appId, token: bearer });
        return r.ok ? { status: 200, body: { ok: true } } : fail('unauthorized', 401);
    }
    return fail('not_found', 404);
}
