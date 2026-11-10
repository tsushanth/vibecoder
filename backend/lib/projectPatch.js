// Validation for PATCH /api/projects/:id. A request may rename the project, change whether it is listed on Explore, or both.

/** @returns {{ fields: { title?: string, is_public?: boolean } } | { error: string }} */
export function parsePatchBody({ title, isPublic }) {
    const fields = {};
    if (title !== undefined) {
        if (typeof title !== 'string') return { error: 'title (string) is required' };
        const trimmed = title.trim();
        if (trimmed.length === 0) return { error: 'title cannot be empty' };
        if (trimmed.length > 180) return { error: 'title must be 180 chars or fewer' };
        fields.title = trimmed;
    }
    if (isPublic !== undefined) {
        if (typeof isPublic !== 'boolean') return { error: 'isPublic must be true or false' };
        fields.is_public = isPublic;
    }
    if (Object.keys(fields).length === 0) return { error: 'title (string) is required' };
    return { fields };
}
