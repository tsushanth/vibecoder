// Sends platform emails through Resend: sign-in links (send) and end-user notifications (sendMessage). The API key, the
// link and the message body are never logged or put in an error.
const NO_BREAK = /^[^\r\n]+$/;
const ONE_ADDRESS = /^[^\s<>,;"\\]+@[^\s<>,;"\\]+$/;

export function createResendMailer({ apiKey, from, fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
    if (typeof apiKey !== 'string' || apiKey.length < 10) throw new Error('mailer needs an api key');
    if (typeof from !== 'string' || !/^[^<>\r\n]*<[^<>\s@]+@[^<>\s@]+>$|^[^<>\s@]+@[^<>\s@]+$/.test(from)) throw new Error('mailer needs a valid from address');

    async function post(payload) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const res = await fetchImpl('https://api.resend.com/emails', {
                method: 'POST', redirect: 'manual', signal: ctrl.signal,
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ from, ...payload }),
            });
            if (res.status < 200 || res.status >= 300) throw new Error(`mail provider refused (${res.status})`);
        } finally { clearTimeout(timer); }
    }

    return {
        async send({ to, appId, link }) {
            const subject = 'Your sign-in link';
            const text = `Use this link to sign in to ${appId}. It works once and expires in 15 minutes.\n\n${link}\n\nIf you did not ask for this, you can ignore this email.`;
            await post({ to: [to], subject, text });
        },
        // A general message with optional extra headers. Refuses anything that could add a recipient or a header.
        async sendMessage({ to, subject, text, headers }) {
            if (typeof to !== 'string' || !ONE_ADDRESS.test(to)) throw new Error('mailer needs one recipient address');
            if (typeof subject !== 'string' || !NO_BREAK.test(subject)) throw new Error('mailer needs a one-line subject');
            if (typeof text !== 'string' || !text) throw new Error('mailer needs a body');
            const h = headers ?? {};
            for (const [k, v] of Object.entries(h)) if (!/^[A-Za-z0-9-]+$/.test(k) || typeof v !== 'string' || !NO_BREAK.test(v)) throw new Error('mailer refused a header');
            await post({ to: [to], subject, text, ...(Object.keys(h).length ? { headers: h } : {}) });
        },
    };
}
