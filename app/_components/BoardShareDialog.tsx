'use client';

import { useEffect, useState, useTransition } from 'react';
import type { DirectoryUser } from '@sovereignfs/sdk';
import { Avatar, Button, Dialog, Input, Typography, useToast } from '@sovereignfs/ui';
import { addBoardMember, removeBoardMember, searchBoardMemberCandidates } from '../actions';
import { displayName } from '../_lib/identity';
import type { BoardData } from '../_lib/queries';
import type { CurrentUser } from './BoardView';
import styles from '../kanban.module.css';

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

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
      <Avatar name={name} size="sm" />
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

function MemberPicker({ boardId, onError }: { boardId: string; onError: (message: string) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchBoardMemberCandidates({ boardId, query: trimmed })
        .then((users) => {
          if (!cancelled) setResults(users);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [boardId, query]);

  function add(user: DirectoryUser): void {
    setAddingId(user.id);
    void addBoardMember({ boardId, userId: user.id })
      .then((result) => {
        if (result.ok) {
          setQuery('');
          setResults([]);
        } else {
          onError(result.error);
        }
      })
      .finally(() => setAddingId(null));
  }

  return (
    <div className={styles.memberPicker}>
      <Typography variant="label">Add a person</Typography>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or email"
        autoComplete="off"
      />
      {results.length > 0 && (
        <ul className={styles.memberResults}>
          {results.map((user) => (
            <li key={user.id}>
              <button
                type="button"
                className={styles.memberResultRow}
                disabled={addingId === user.id}
                onClick={() => add(user)}
              >
                <Avatar name={user.name ?? user.email} size="sm" />
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
