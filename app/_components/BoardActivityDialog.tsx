'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button, Dialog, Spinner, Typography } from '@sovereignfs/ui';
import { getBoardActivity } from '../actions';
import type { ActivityCursor } from '../_lib/activity-pagination';
import { describeActivity } from '../_lib/activity-copy';
import { displayName } from '../_lib/identity';
import type { BoardActivityItem, BoardData } from '../_lib/queries';
import styles from '../kanban.module.css';
import type { CurrentUser } from './BoardView';
import { TimeAgo } from './TimeAgo';

type State =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'loaded'; items: BoardActivityItem[]; nextCursor: ActivityCursor | null };

/**
 * Board menu → "Activity": the board-level feed. Every list/member/board
 * event was already being recorded (`recordActivity` with no `cardId`) but
 * never rendered anywhere — the card panel only shows its own card's rows.
 * Fetched on open via `getBoardActivity` (a read, so viewers get it too),
 * paged with the same `(createdAt, id)` cursor the card feed uses.
 */
export function BoardActivityDialog({
  board,
  currentUser,
  onClose,
}: {
  board: BoardData;
  currentUser: CurrentUser;
  onClose: () => void;
}) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [loadingMore, startLoadMore] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getBoardActivity({ boardId: board.id })
      .then((result) => {
        if (cancelled) return;
        setState(
          result.ok
            ? { status: 'loaded', items: result.items, nextCursor: result.nextCursor }
            : { status: 'error', error: result.error },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', error: 'Couldn’t load activity.' });
      });
    return () => {
      cancelled = true;
    };
  }, [board.id]);

  function loadMore(): void {
    if (state.status !== 'loaded' || !state.nextCursor) return;
    const cursor = state.nextCursor;
    startLoadMore(async () => {
      const result = await getBoardActivity({ boardId: board.id, cursor });
      setState((prev) => {
        if (prev.status !== 'loaded') return prev;
        if (!result.ok) return { status: 'error', error: result.error };
        return {
          status: 'loaded',
          items: [...prev.items, ...result.items],
          nextCursor: result.nextCursor,
        };
      });
    });
  }

  const resolveName = (userId: string) => displayName(userId, currentUser, board.members);

  return (
    <Dialog open onClose={onClose} size="md" title="Board activity" aria-label="Board activity">
      <div className={styles.dialogBody}>
        <Typography variant="h3" className={styles.dialogStickyHeader}>
          Board activity
        </Typography>
        {state.status === 'loading' && (
          <div className={styles.centered}>
            <Spinner aria-label="Loading activity" />
          </div>
        )}
        {state.status === 'error' && <p className={styles.formError}>{state.error}</p>}
        {state.status === 'loaded' && state.items.length === 0 && (
          <Typography variant="caption" className={styles.descriptionPlaceholder}>
            No activity yet.
          </Typography>
        )}
        {state.status === 'loaded' && state.items.length > 0 && (
          <ul className={styles.activityList}>
            {state.items.map((item) => (
              <li key={item.id}>
                <Typography variant="caption">
                  <strong>{resolveName(item.actorId)}</strong>{' '}
                  {describeActivity(item, {
                    lists: board.lists,
                    labels: board.labels,
                    resolveName,
                    scope: 'board',
                    cardTitle: item.cardTitle,
                  })}
                  {' · '}
                  <TimeAgo ms={item.createdAt} />
                </Typography>
              </li>
            ))}
          </ul>
        )}
        {state.status === 'loaded' && state.nextCursor && (
          <Button variant="ghost" size="sm" onClick={loadMore} loading={loadingMore}>
            Load more
          </Button>
        )}
      </div>
    </Dialog>
  );
}
