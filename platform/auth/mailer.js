// Sends sign-in emails through Resend. The API key and the link are never logged or put in an error.
export function createResendMailer({ apiKey, from, fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
    if (typeof apiKey !== 'string' || apiKey.length < 10) throw new Error('mailer needs an api key');
    if (typeof from !== 'string' || !/^[^<>\r\n]*<[^<>\s@]+@[^<>\s@]+>$|^[^<>\s@]+@[^<>\s@]+$/.test(from)) throw new Error('mailer needs a valid from address');
    return {
        async send({ to, appId, link }) {
            const subject = 'Your sign-in link';
            const text = `Use this link to sign in to ${appId}. It works once and expires in 15 minutes.\n\n${link}\n\nIf you did not ask for this, you can ignore this email.`;
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), timeoutMs);
            try {
                const res = await fetchImpl('https://api.resend.com/emails', {
                    method: 'POST', redirect: 'manual', signal: ctrl.signal,
                    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ from, to: [to], subject, text }),
                });
                if (res.status < 200 || res.status >= 300) throw new Error(`mail provider refused (${res.status})`);
            } finally { clearTimeout(timer); }
        },
    };
}
