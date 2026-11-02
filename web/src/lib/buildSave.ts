/**
 * After a streamed build the backend has already written the result to the placeholder project row it created when the
 * build was queued (it reports that id on the "queued" event and again on the "result" event). Posting the bundle to
 * /api/projects/save as well would insert a second row for the same build, so the client only does that when the stream
 * never told it an id (an older backend, or a placeholder insert that failed).
 */

function cleanId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** The server-side project id for this build: the result event wins, then the queued event, else null. */
export function pickServerProjectId(resultProjectId: unknown, queuedProjectId: unknown): string | null {
  return cleanId(resultProjectId) ?? cleanId(queuedProjectId);
}

export type SavePlan = { kind: 'server'; projectId: string } | { kind: 'client-save' };

export function planSaveAfterBuild(ids: { resultProjectId?: unknown; queuedProjectId?: unknown }): SavePlan {
  const projectId = pickServerProjectId(ids.resultProjectId, ids.queuedProjectId);
  return projectId ? { kind: 'server', projectId } : { kind: 'client-save' };
}
