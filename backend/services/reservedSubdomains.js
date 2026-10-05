// Names creators may not deploy under: platform hostnames and the prefixes automatic previews use.
const RESERVED = new Set(['vibe-proxy', 'www', 'api', 'admin', 'app', 'mail', 'send', 'unsubscribe', 'cdn', 'status', 'vibebuild', 'vibecoder-api', 'vibecoder-deploy']);

// Project ids (UUIDs) are the platform's own app ids for key storage, so nobody may deploy under one.
const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isReservedSubdomain(name) {
    if (typeof name !== 'string') return false;
    const n = name.toLowerCase();
    return RESERVED.has(n) || PROJECT_ID.test(n) || n.startsWith('preview-') || n.startsWith('prev-');
}
