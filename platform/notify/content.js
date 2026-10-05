// What an end-user notification may contain, and the fixed platform footer around it. Plain text only; the subject can
// never carry a line break, so an app cannot inject mail headers. The app picks words, never recipients or markup.
export const MAX_SUBJECT = 120;
export const MAX_TEXT = 2000;

const APP_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
// C0 controls, DEL, C1 controls, NEL and the Unicode line and paragraph separators: all become a space in a subject.
const SUBJECT_BAD = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const TEXT_BAD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const invalid = (detail) => ({ ok: false, reason: 'invalid_content', detail });

export function validateContent(input) {
    const { subject, text } = input && typeof input === 'object' ? input : {};
    const s = typeof subject === 'string' ? subject.replace(SUBJECT_BAD, ' ').replace(/ {2,}/g, ' ').trim() : '';
    if (!s) return invalid('subject_required');
    if (s.length > MAX_SUBJECT) return invalid('subject_too_long');
    if (typeof text !== 'string') return invalid('text_required');
    const t = text.replace(/\r\n?/g, '\n');
    if (!t.trim()) return invalid('text_required');
    if (t.length > MAX_TEXT) return invalid('text_too_long');
    if (TEXT_BAD.test(t)) return invalid('text_control_chars');
    return { ok: true, subject: s, text: t };
}

export function buildMessage({ appId, subject, text, unsubscribeUrl }) {
    if (typeof appId !== 'string' || !APP_ID.test(appId)) throw new Error('invalid app id');
    if (typeof unsubscribeUrl !== 'string' || !/^https:\/\/[^\s<>"\\]+$/.test(unsubscribeUrl)) throw new Error('invalid unsubscribe url');
    const footer = [
        '',
        '--',
        `This message was sent by the app "${appId}", which runs on VibeBuild, to the email address you signed in with.`,
        `To stop receiving messages from ${appId}, open this link: ${unsubscribeUrl}`,
        '',
    ].join('\n');
    return {
        subject,
        text: `${text}\n${footer}`,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    };
}
