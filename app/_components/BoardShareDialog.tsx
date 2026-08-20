'use client';

import { useEffect, useState, useTransition } from 'react';
import type { DirectoryUser } from '@sovereignfs/sdk';
import { Avatar, Button, Dialog, Icon, Input, Typography, useToast } from '@sovereignfs/ui';
import { addBoardMember, getBoardMemberCandidates, removeBoardMember } from '../actions';
import { displayName } from '../_lib/identity';
import type { BoardData } from '../_lib/queries';
import type { CurrentUser } from './BoardView';
import styles from '../kanban.module.css';

// How long the "Copy" button shows "Copied" before reverting — same value
// and pattern as Console's own copy-to-clipboard affordances
// (LicenseGenerator.tsx's `copyPubKey`/`copyToken`).
const COPIED_LABEL_MS = 2000;

/**
 * Board header CTA (K.9) — every member can open this to see who's on the
 * board; the add-picker and each row's "Remove" only render for the owner
 * ("owner-only management" per SPEC, not owner-only visibility). Reads
 * `board.members` straight from props on every render rather than copying
 * it into local state — `addBoardMember`/`removeBoardMember` both call
 * `refresh()`, and a local copy would go stale the same way K.8's
 * `CardActivity` did before that fix.
 */
export function BoardShareDialog({
  board,
  currentUser,
  onClose,
}: {
  board: BoardData;
  currentUser: CurrentUser;
  onClose: () => void;
}) {
  const toast = useToast();
  const isOwner = board.role === 'owner';

  function onError(message: string): void {
    toast.show({ title: 'Couldn’t update members', message, category: 'error' });
  }

  return (
    <Dialog open onClose={onClose} size="sm" title="Share board" aria-label="Share board">
      <div className={styles.dialogBody}>
        <Typography variant="h3" className={styles.dialogStickyHeader}>
          Share board
        </Typography>
        <BoardUrlRow boardId={board.id} />
        <ul className={styles.memberList}>
          {board.members.map((member) => (
            <MemberRow
              key={member.userId}
              boardId={board.id}
              member={member}
              currentUser={currentUser}
              canManage={isOwner}
              onError={onError}
            />
          ))}
        </ul>
        {isOwner && <MemberPicker boardId={board.id} onError={onError} />}
      </div>
    </Dialog>
  );
}

/**
 * Reads `window.location.origin` in `useEffect`, never render — a
 * `'use client'` component must not touch browser globals during render or
 * in a `useState` initializer, which would render a different value on the
 * server (nothing) vs. the client and trip a hydration mismatch. Starts
 * empty and fills in after mount; the `Copy` button stays disabled until
 * then (effectively instant in practice). Deliberately built from
 * `boardId` rather than `window.location.href` verbatim — the board page
 * can carry a `?card=…` query param while a card's detail overlay is open,
 * and copying that as "the board's URL" would hand out a link to one
 * specific card, not a general board invite.
 */
function BoardUrlRow({ boardId }: { boardId: string }) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(`${window.location.origin}/kanban/b/${boardId}`);
  }, [boardId]);

  async function copy(): Promise<void> {
    if (!url) return;
    // `navigator.clipboard.writeText` can reject for reasons outside this
    // component's control (permission denied, an insecure/non-focused
    // context) — an expected failure a user can retry, not a bug, so it
    // gets a toast rather than an unhandled rejection.
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_LABEL_MS);
    } catch {
      toast.show({
        title: 'Couldn’t copy link',
        message: 'Copy the URL from the field above instead.',
        category: 'error',
      });
    }
  }

  return (
    <div className={styles.boardUrlRow}>
      <Input
        value={url}
        readOnly
        aria-label="Board link"
        onFocus={(e) => e.currentTarget.select()}
      />
      <Button variant="secondary" size="sm" disabled={!url} onClick={() => void copy()}>
        <Icon name={copied ? 'check' : 'copy'} size="sm" aria-hidden={true} />
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

function MemberRow({
  boardId,
  member,
  currentUser,
  canManage,
  onError,
}: {
  boardId: string;
  member: BoardData['members'][number];
  currentUser: CurrentUser;
  canManage: boolean;
  onError: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  // A one-member lookup array — `member` already carries name/email, so
  // `displayName` resolves it without needing the full board member list.
  const name = displayName(member.userId, currentUser, [member]);
  const showEmail = Boolean(member.email) && member.email !== name;

  return (
    <li className={styles.memberRow}>
      <Avatar name={name} src={member.image ?? undefined} size="sm" />
      <div className={styles.memberInfo}>
        <Typography variant="body">{name}</Typography>
        {showEmail && <Typography variant="caption">{member.email}</Typography>}
      </div>
      {member.role === 'owner' ? (
        <Typography variant="caption" className={styles.memberRoleBadge}>
          Owner
        </Typography>
      ) : (
        canManage && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const result = await removeBoardMember({ boardId, userId: member.userId });
                if (!result.ok) onError(result.error);
              });
            }}
          >
            Remove
          </Button>
        )
      )}
    </li>
  );
}

/**
 * K.20 — candidates are the board's project members not yet on the board,
 * fetched once (not per keystroke) via `getBoardMemberCandidates`; the text
 * field below filters that already-fetched list client-side, rather than
 * live-querying the directory the way the project-level picker
 * (`ManageProjectDialog`'s own `MemberPicker`) still does — a board can
 * only ever be shared with someone the project already trusts, so there's
 * no "search the whole directory" case here at all.
 */
function MemberPicker({ boardId, onError }: { boardId: string; onError: (message: string) => void }) {
  const [candidates, setCandidates] = useState<DirectoryUser[] | null>(null);
  const [query, setQuery] = useState('');
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getBoardMemberCandidates({ boardId })
      .then((users) => {
        if (!cancelled) setCandidates(users);
      })
      .catch(() => {
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  function add(user: DirectoryUser): void {
    setAddingId(user.id);
    void addBoardMember({ boardId, userId: user.id })
      .then((result) => {
        if (result.ok) {
          setCandidates((prev) => (prev ? prev.filter((u) => u.id !== user.id) : prev));
        } else {
          onError(result.error);
        }
      })
      .finally(() => setAddingId(null));
  }

  if (candidates !== null && candidates.length === 0) {
    return (
      <div className={styles.memberPicker}>
        <Typography variant="label">Add a person</Typography>
        <Typography variant="caption" className={styles.memberResultStatus}>
          Everyone on this project is already on the board.
        </Typography>
      </div>
    );
  }

  const trimmed = query.trim().toLowerCase();
  const filtered = (candidates ?? []).filter(
    (u) =>
      trimmed.length === 0 ||
      (u.name?.toLowerCase().includes(trimmed) ?? false) ||
      u.email.toLowerCase().includes(trimmed),
  );

  return (
    <div className={styles.memberPicker}>
      <Typography variant="label">Add a person</Typography>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter project members"
        autoComplete="off"
      />
      {filtered.length === 0 && candidates !== null && (
        <Typography variant="caption" className={styles.memberResultStatus}>
          No matches
        </Typography>
      )}
      {filtered.length > 0 && (
        <ul className={styles.memberResults}>
          {filtered.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                className={styles.memberResultRow}
                disabled={addingId === user.id}
                onClick={() => add(user)}
              >
                <Avatar name={user.name ?? user.email} src={user.image ?? undefined} size="sm" />
                <div className={styles.memberInfo}>
                  <Typography variant="body">{user.name ?? user.email}</Typography>
                  {user.name && <Typography variant="caption">{user.email}</Typography>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
