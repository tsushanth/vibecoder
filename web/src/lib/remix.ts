/** Remix is offered on other people's apps only: the API refuses to fork your own. */
export function canRemix(creatorId: string | null | undefined, userId: string | null | undefined): boolean {
  return !userId || creatorId !== userId;
}
