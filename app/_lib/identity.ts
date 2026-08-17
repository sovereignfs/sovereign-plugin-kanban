/**
 * `sdk.directory` isn't wired until K.9 (see SPEC) — users are shown by id
 * only, with "You" substituted for the current session's own id, the one
 * identity every surface can resolve honestly without fabricating a name
 * for anyone else. Shared by assignees (K.6), comments and activity (K.8).
 */
export function displayName(userId: string, currentUser: { id: string; name: string | null }): string {
  if (userId === currentUser.id) return currentUser.name ?? 'You';
  return userId;
}
