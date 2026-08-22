'use client';

import { useEffect, useOptimistic, useState, useTransition } from 'react';
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

type Member = BoardData['members'][number];
type MemberAction = { type: 'remove'; userId: string } | { type: 'add'; member: Member };
type CandidateAction = { type: 'add'; user: DirectoryUser } | { type: 'remove'; userId: string };

function applyMemberAction(state: readonly Member[], action: MemberAction): Member[] {
  return action.type === 'remove'
    ? state.filter((m) => m.userId !== action.userId)
    : [...state, action.member];
}

function applyCandidateAction(
  state: readonly DirectoryUser[] | null,
  action: CandidateAction,
): DirectoryUser[] | null {
  if (!state) return state;
  if (action.type === 'remove') return state.filter((u) => u.id !== action.userId);
  return state.some((u) => u.id === action.user.id) ? [...state] : [...state, action.user];
}

function toCandidate(member: Member): DirectoryUser {
  return { id: member.userId, email: member.email ?? '', name: member.name, image: member.image };
}

function toMember(user: DirectoryUser): Member {
  return { userId: user.id, name: user.name, email: user.email, image: user.image, role: 'member' };
}

/**
 * Board header CTA (K.9) — every member can open this to see who's on the
 * board; the add-picker and each row's "Remove" only render for the owner
 * ("owner-only management" per SPEC, not owner-only visibility).
 *
 * Both the member list and the "Add a person" candidate list are driven by
 * their own `useOptimistic`, not a plain `useState` for the latter — that
 * distinction mattered in practice. First attempt paired `useOptimistic`
 * (for members) with a plain `setCandidates` call, both invoked
 * synchronously back-to-back inside the same `startTransition`, expecting
 * them to commit together. Live instrumentation (temporary `console.log`
 * timestamps at every step, not just DOM/height sampling — the height
 * sampling alone had already shown *something* was still two-stage, but
 * not *why*) proved they don't: `useOptimistic`'s dispatch gets special
 * treatment to render immediately even inside a transition, but a plain
 * `useState` setter called in that same transition is ordinary low-priority
 * transition work, and React deferred its flush until the transition's own
 * async work (the server action's round-trip) settled — 200-500ms later,
 * confirmed by the timestamps. The member row disappeared immediately; the
 * candidate row appeared only once the mutation resolved, same two-stage
 * dialog-height jump as before, just with a different root cause than the
 * first fix addressed. Routing `candidates` through its own `useOptimistic`
 * (`confirmedCandidates` as the durable base, updated on success so the
 * optimistic view doesn't revert once the transition settles) gives it the
 * same immediate-apply treatment `optimisticMembers` already has, so both
 * update in the same commit as the click, for real this time — verified
 * the same way the bug was found: per-step timestamps, not just a visual
 * check.
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
  const [confirmedCandidates, setConfirmedCandidates] = useState<DirectoryUser[] | null>(null);
  const [optimisticMembers, dispatchMembers] = useOptimistic(board.members, applyMemberAction);
  const [candidates, dispatchCandidates] = useOptimistic(confirmedCandidates, applyCandidateAction);

  useEffect(() => {
    let cancelled = false;
    getBoardMemberCandidates({ boardId: board.id })
      .then((users) => {
        if (!cancelled) setConfirmedCandidates(users);
      })
      .catch(() => {
        if (!cancelled) setConfirmedCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [board.id]);

  function onError(message: string): void {
    toast.show({ title: 'Couldn’t update members', message, category: 'error' });
  }

  // One transition per direction rather than per row/candidate — `useOptimistic`
  // only needs *some* transition active when its dispatch is called, and
  // sharing keeps `pending` meaningful (disables the whole list while any
  // remove is in flight) without a per-id Set.
  const [removePending, startRemoveTransition] = useTransition();
  const [addPending, startAddTransition] = useTransition();

  function removeMember(member: Member): void {
    startRemoveTransition(async () => {
      dispatchMembers({ type: 'remove', userId: member.userId });
      dispatchCandidates({ type: 'add', user: toCandidate(member) });
      const result = await removeBoardMember({ boardId: board.id, userId: member.userId });
      if (result.ok) {
        // Commits the optimistic candidates change into the durable base —
        // `optimisticMembers` doesn't need this, its own base (board.members)
        // already gets updated via the mutation's refresh(). Without this,
        // `candidates` would revert to its pre-removal value the moment this
        // transition settles, since confirmedCandidates itself never changed.
        setConfirmedCandidates((prev) =>
          prev && !prev.some((u) => u.id === member.userId) ? [...prev, toCandidate(member)] : prev,
        );
      } else {
        onError(result.error);
      }
    });
  }

  function addMember(user: DirectoryUser): void {
    startAddTransition(async () => {
      dispatchCandidates({ type: 'remove', userId: user.id });
      dispatchMembers({ type: 'add', member: toMember(user) });
      const result = await addBoardMember({ boardId: board.id, userId: user.id });
      if (result.ok) {
        setConfirmedCandidates((prev) => (prev ? prev.filter((u) => u.id !== user.id) : prev));
      } else {
        onError(result.error);
      }
    });
  }

  return (
    <Dialog open onClose={onClose} size="sm" title="Share board" aria-label="Share board">
      <div className={styles.dialogBody}>
        <Typography variant="h3" className={styles.dialogStickyHeader}>
          Share board
        </Typography>
        <BoardUrlRow boardId={board.id} />
        <ul className={styles.memberList}>
          {optimisticMembers.map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              currentUser={currentUser}
              canManage={isOwner}
              pending={removePending}
              onRemove={() => removeMember(member)}
            />
          ))}
        </ul>
        {isOwner && <MemberPicker candidates={candidates} pending={addPending} onAdd={addMember} />}
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
  member,
  currentUser,
  canManage,
  pending,
  onRemove,
}: {
  member: Member;
  currentUser: CurrentUser;
  canManage: boolean;
  pending: boolean;
  onRemove: () => void;
}) {
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
          <Button variant="ghost" size="sm" disabled={pending} onClick={onRemove}>
            Remove
          </Button>
        )
      )}
    </li>
  );
}

/**
 * K.20 — candidates are the board's project members not yet on the board;
 * the text field below filters that list client-side, rather than
 * live-querying the directory the way the project-level picker
 * (`ManageProjectDialog`'s own `MemberPicker`) still does — a board can only
 * ever be shared with someone the project already trusts, so there's no
 * "search the whole directory" case here at all.
 *
 * Fully controlled by `BoardShareDialog` — see that component's own doc
 * comment for why both the member list and this candidate list are driven
 * from up there together, each through its own `useOptimistic`.
 */
function MemberPicker({
  candidates,
  pending,
  onAdd,
}: {
  candidates: DirectoryUser[] | null;
  pending: boolean;
  onAdd: (user: DirectoryUser) => void;
}) {
  const [query, setQuery] = useState('');

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
                disabled={pending}
                onClick={() => onAdd(user)}
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
