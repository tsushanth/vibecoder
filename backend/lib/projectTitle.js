// The title a project gets from the prompt it was built from. It appears in My Apps, on Explore and as the name of an exported APK.

// Words that cannot end a title: the five-word cut often lands on one ("I need to link a site" -> "I Need To Link A").
const DANGLING = new Set(['a', 'an', 'the', 'in', 'to', 'of', 'for', 'with', 'and', 'or', 'on', 'at', 'by', 'as', 'my', 'your', 'is', 'are', 'that', 'which', 'where']);

export function deriveTitle(prompt) {
    const words = String(prompt ?? '').trim()
        // The article must be a whole word: without the trailing \s+, "an" lost only its "a" and "Build an expense tracker" became "N Expense Tracker".
        .replace(/^(?:build|create|make|design|develop)\s+(?:(?:me\s+)?(?:an?|the)\s+)?/i, '')
        .replace(/\s+(?:with|that|where|which|for|using|featuring|including|and\s+a)\s+.*/i, '')
        .split(/\s+/)
        .slice(0, 5);
    while (words.length > 1 && DANGLING.has(words[words.length - 1].toLowerCase())) words.pop();
    const title = words.join(' ').substring(0, 50) || 'My App';
    return title.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
