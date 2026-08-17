export interface MemberIdentity {
  userId: string;
  name: string | null;
  email: string | null;
}

/**
 * "You" for the current session's own id; otherwise the directory name/email
 * resolved onto `board.members` by K.9's `sdk.directory.resolveUsers()` call
 * in `getBoardData`. Falls back to the raw id when `members` is omitted
 * (call sites that don't have it handy) or when the id isn't a current
 * member — e.g. an activity row naming someone who has since been removed
 * from the board (a real, retrievable id, just not fabricated info about
 * them). Shared by assignees (K.6), comments and activity (K.8), and the
 * share dialog (K.9).
 */
export function displayName(
  userId: string,
  currentUser: { id: string; name: string | null },
  members?: MemberIdentity[],
): string {
  if (userId === currentUser.id) return currentUser.name ?? 'You';
  const member = members?.find((m) => m.userId === userId);
  if (member) return member.name ?? member.email ?? userId;
  return userId;
}
