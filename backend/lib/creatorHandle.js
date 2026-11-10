// What a visitor sees as the creator of a public project.
//
// projects.creator_name is whatever the client sent when the build started: the signup full name, or the part of the email
// address before the @ when the account has no name. Neither belongs on a public page. This turns it into a first name plus
// an initial ("Sam T."), or, when there is nothing that reads as a person's name, a stable handle derived from the user id
// ("builder-3fa9c1"). It never returns an email address or the part of one.

import crypto from 'node:crypto';

const MAX_PART = 20;

function handleFor(creatorId) {
    const seed = typeof creatorId === 'string' && creatorId ? creatorId : 'unknown';
    return `builder-${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 6)}`;
}

// A name token that reads as a person's name: letters (any script), apostrophes and hyphens, no digits or other symbols.
const NAME_TOKEN = /^[\p{L}][\p{L}'’-]*$/u;

/**
 * @param {string|null|undefined} name  the stored creator_name
 * @param {string|null|undefined} creatorId  the stored creator_id, used only to derive a stable handle
 * @returns {string}
 */
export function publicCreatorName(name, creatorId) {
    const fallback = handleFor(creatorId);
    if (typeof name !== 'string') return fallback;
    const clean = name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!clean || clean.includes('@')) return fallback;

    const parts = clean.split(' ');
    const first = parts[0];
    if (!NAME_TOKEN.test(first)) return fallback; // "john.smith92", "puzzle_verse", "user123": an email prefix, not a name
    const firstShown = first.slice(0, MAX_PART);

    if (parts.length === 1) return firstShown;
    const last = parts[parts.length - 1];
    const initial = [...last].find((ch) => /\p{L}/u.test(ch));
    return initial ? `${firstShown} ${initial.toLocaleUpperCase()}.` : firstShown;
}

/** A copy of a browse/project row with the creator name made public-safe. */
export function withPublicCreator(row) {
    if (!row || typeof row !== 'object') return row;
    return { ...row, creator_name: publicCreatorName(row.creator_name, row.creator_id) };
}
