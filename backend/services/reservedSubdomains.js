// Names creators may not deploy under: platform hostnames and the prefixes automatic previews use.
const RESERVED = new Set(['vibe-proxy', 'www', 'api', 'admin', 'app', 'mail', 'send', 'unsubscribe', 'cdn', 'status', 'vibebuild', 'vibecoder-api', 'vibecoder-deploy']);

export function isReservedSubdomain(name) {
    if (typeof name !== 'string') return false;
    const n = name.toLowerCase();
    return RESERVED.has(n) || n.startsWith('preview-') || n.startsWith('prev-');
}
