// Quality filter for the public browse feed.
//
// The feed is built from every public, ready project, so it fills up with
// test builds, accidental submissions (an email address typed into the prompt
// box, "hey") and repeated taps on the same starter template. None of that is
// something a visitor wants to remix.

const MIN_PROMPT_LENGTH = 15;
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export function normalizePrompt(prompt) {
    return (prompt || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isRealProject(p) {
    const name = (p.creator_name || '').toLowerCase();
    const title = (p.title || '').toLowerCase();
    if (name === 'anonymous' || name === 'test user') return false;
    if (p.creator_id?.startsWith('test-')) return false;
    if (/^test\b/i.test(title) && title.length < 30) return false;
    if (title === 'prefix-test' || title === 'test') return false;
    // Must have a visual (preview screenshot or thumbnail) to show in browse
    if (!p.preview_url && !p.thumbnail_url) return false;

    const prompt = normalizePrompt(p.initial_prompt);
    if (prompt.length < MIN_PROMPT_LENGTH) return false;
    if (EMAIL_PATTERN.test(prompt) || EMAIL_PATTERN.test(title)) return false;
    return true;
}

// Keeps the first project for each distinct prompt, so callers should pass
// the list already sorted the way it will be shown (newest or most played).
export function dedupeByPrompt(projects) {
    const seen = new Set();
    return projects.filter((p) => {
        const key = normalizePrompt(p.initial_prompt);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function filterBrowseProjects(projects) {
    return dedupeByPrompt(projects.filter(isRealProject));
}
