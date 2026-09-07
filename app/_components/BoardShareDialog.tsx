'use client';

import { useEffect, useOptimistic, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { DirectoryUser } from '@sovereignfs/sdk';
import {
  Avatar,
  Button,
  ConfirmDialog,
  Dialog,
  Icon,
  Input,
  Typography,
  useToast,
} from '@sovereignfs/ui';
import {
  addBoardMember,
  getBoardMemberCandidates,
  leaveBoard,
  removeBoardMember,
  updateBoardMemberRole,
} from '../actions';
import { displayName } from '../_lib/identity';
import type { BoardData } from '../_lib/queries';
import type { CurrentUser } from './BoardView';
import styles from '../kanban.module.css';

// How long the "Copy" button shows "Copied" before reverting.
const COPIED_LABEL_MS = 2000;

type Member = BoardData['members'][number];
type MemberAction =
  | { type: 'remove'; userId: string }
  | { type: 'add'; member: Member }
  | { type: 'role'; userId: string; role: 'owner' | 'member' };
type CandidateAction = { type: 'add'; user: DirectoryUser } | { type: 'remove'; userId: string };
type Confirm = { kind: 'remove'; member: Member } | { kind: 'leave' } | null;

function applyMemberAction(state: readonly Member[], action: MemberAction): Member[] {
  switch (action.type) {
    case 'remove':
      return state.filter((m) => m.userId !== action.userId);
    case 'add':
      return [...state, action.member];
    case 'role':
      return state.map((m) => (m.userId === action.userId ? { ...m, role: action.role } : m));
  }
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
 * board; the add-picker, per-row role toggle, and Remove render for a
 * *manager* (board owner, or K.20's project owner). A member's own row
 * offers "Leave" instead. Remove/Leave sit behind a confirmation — both
 * used to fire on a single click.
 *
 * Both the member list and the candidate list are driven by their own
 * `useOptimistic` so a click updates both in the same commit — a plain
 * `useState` setter inside the same transition is deferred until the
 * server action settles (verified live with timestamps, see git history).
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
  const router = useRouter();
  const canManage = board.canManage;
  const [confirmedCandidates, setConfirmedCandidates] = useState<DirectoryUser[] | null>(null);
  const [optimisticMembers, dispatchMembers] = useOptimistic(board.members, applyMemberAction);
  const [candidates, dispatchCandidates] = useOptimistic(confirmedCandidates, applyCandidateAction);
  const [confirm, setConfirm] = useState<Confirm>(null);

  useEffect(() => {
    if (!canManage) return;
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
  }, [board.id, canManage]);

  function onError(message: string): void {
    toast.show({ title: 'Couldn’t update members', message, category: 'error' });
  }

  const [removePending, startRemoveTransition] = useTransition();
  const [addPending, startAddTransition] = useTransition();
  const [rolePending, startRoleTransition] = useTransition();
  const [leavePending, startLeaveTransition] = useTransition();

  function removeMember(member: Member): void {
    setConfirm(null);
    startRemoveTransition(async () => {
      dispatchMembers({ type: 'remove', userId: member.userId });
      dispatchCandidates({ type: 'add', user: toCandidate(member) });
      const result = await removeBoardMember({ boardId: board.id, userId: member.userId });
      if (result.ok) {
        // Commit the optimistic candidates change into the durable base —
        // without this, `candidates` reverts once the transition settles.
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

  function toggleRole(member: Member): void {
    const role = member.role === 'owner' ? 'member' : 'owner';
    startRoleTransition(async () => {
      dispatchMembers({ type: 'role', userId: member.userId, role });
      const result = await updateBoardMemberRole({
        boardId: board.id,
        userId: member.userId,
        role,
      });
      if (!result.ok) onError(result.error);
    });
  }

  function leave(): void {
    startLeaveTransition(async () => {
      const result = await leaveBoard({ boardId: board.id });
      if (result.ok) {
        setConfirm(null);
        onClose();
        // A departed member may have lost the board entirely (private
        // board/project) — Home is the one place guaranteed to still exist.
        router.push('/kanban');
      } else {
        onError(result.error);
        setConfirm(null);
      }
    });
  }

  const isMember = board.role !== 'viewer';
  const ownerCount = optimisticMembers.filter((m) => m.role === 'owner').length;

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
              canManage={canManage}
              isSelf={member.userId === currentUser.id}
              isLastOwner={member.role === 'owner' && ownerCount <= 1}
              pending={removePending || rolePending}
              onToggleRole={() => toggleRole(member)}
              onRemove={() => setConfirm({ kind: 'remove', member })}
              onLeave={() => setConfirm({ kind: 'leave' })}
            />
          ))}
        </ul>
        {!isMember && !canManage && (
          <Typography variant="caption" className={styles.descriptionPlaceholder}>
            You’re viewing this board as a project member.
          </Typography>
        )}
        {canManage && (
          <MemberPicker candidates={candidates} pending={addPending} onAdd={addMember} />
        )}
      </div>

      {confirm?.kind === 'remove' && (
        <ConfirmDialog
          open
          onClose={() => setConfirm(null)}
          title={`Remove ${displayName(confirm.member.userId, currentUser, [confirm.member])}?`}
          message="They lose access to this board and are unassigned from its cards. You can add them back any time."
          destructive
          confirmLabel="Remove"
          onConfirm={() => removeMember(confirm.member)}
        />
      )}
      {confirm?.kind === 'leave' && (
        <ConfirmDialog
          open
          onClose={() => setConfirm(null)}
          title="Leave this board?"
          message="You’ll be unassigned from its cards and will need an owner to add you back."
          destructive
          confirmLabel={leavePending ? 'Leaving…' : 'Leave board'}
          pending={leavePending}
          onConfirm={leave}
        />
      )}
    </Dialog>
  );
}

/**
 * Reads `window.location.origin` in `useEffect`, never render — a
 * `'use client'` component must not touch browser globals during render.
 * Built from `boardId` rather than `window.location.href` verbatim so an
 * open `?card=…` overlay never leaks into "the board's URL".
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
  isSelf,
  isLastOwner,
  pending,
  onToggleRole,
  onRemove,
  onLeave,
}: {
  member: Member;
  currentUser: CurrentUser;
  canManage: boolean;
  isSelf: boolean;
  isLastOwner: boolean;
  pending: boolean;
  onToggleRole: () => void;
  onRemove: () => void;
  onLeave: () => void;
}) {
  const name = displayName(member.userId, currentUser, [member]);
  const showEmail = Boolean(member.email) && member.email !== name;
  const isOwner = member.role === 'owner';

  return (
    <li className={styles.memberRow}>
      <Avatar name={name} src={member.image ?? undefined} size="sm" />
      <div className={styles.memberInfo}>
        <Typography variant="body">{name}</Typography>
        {showEmail && <Typography variant="caption">{member.email}</Typography>}
      </div>
      <div className={styles.memberRowActions}>
        {isOwner && (!canManage || isLastOwner) && (
          <Typography variant="caption" className={styles.memberRoleBadge}>
            Owner
          </Typography>
        )}
        {canManage && !(isOwner && isLastOwner) && (
          <Button variant="ghost" size="sm" disabled={pending} onClick={onToggleRole}>
            {isOwner ? 'Make member' : 'Make owner'}
          </Button>
        )}
        {isSelf
          ? !isLastOwner && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={onLeave}>
                Leave
              </Button>
            )
          : canManage &&
            !(isOwner && isLastOwner) && (
              <Button variant="ghost" size="sm" disabled={pending} onClick={onRemove}>
                Remove
              </Button>
            )}
      </div>
    </li>
  );
}

/**
 * K.20 — candidates are the board's project members not yet on the board;
 * the text field filters that list client-side rather than live-querying
 * the directory — a board can only ever be shared with someone the project
 * already trusts.
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
