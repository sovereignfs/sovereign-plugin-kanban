'use client';

import { useState, useTransition } from 'react';
import { Button, Typography } from '@sovereignfs/ui';
import { getMoreCardActivity } from '../actions';
import { activityCursorFor, type ActivityCursor } from '../_lib/activity-pagination';
import { describeActivity } from '../_lib/activity-copy';
import { displayName } from '../_lib/identity';
import type { BoardData, CardDetail } from '../_lib/queries';
import type { CurrentUser } from './BoardView';
import styles from '../kanban.module.css';
import { TimeAgo } from './TimeAgo';

/**
 * Paged, newest-first (K.8 review checklist). Page 1 is server-fetched
 * alongside the card (`getCardDetail`); "Load more" calls the
 * `getMoreCardActivity` action for subsequent pages, so opening the card
 * never pays for more than one page of activity it might not scroll to.
 *
 * Page 1 always renders straight from `card.activity` — every mutation's
 * `revalidatePath` re-fetches the card server-side and passes a fresh prop
 * into this already-mounted component (the overlay never remounts on a
 * same-card revalidation), so page 1 can't be copied into local state once
 * at mount without going stale on the very next comment/edit. Only the
 * *extra* pages loaded via "Load more" are local state, and get reset
 * whenever `card.activity` itself changes — React's documented "adjust
 * state during render when a prop changes" pattern, not a `useEffect`, so
 * there's no extra render showing stale data first.
 */
export function CardActivity({
  card,
  board,
  currentUser,
}: {
  card: CardDetail;
  board: BoardData;
  currentUser: CurrentUser;
}) {
  const [prevPage1, setPrevPage1] = useState(card.activity);
  const [extraItems, setExtraItems] = useState<CardDetail['activity']>([]);
  const [cursor, setCursor] = useState<ActivityCursor | null>(activityCursorFor(card.activity));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (card.activity !== prevPage1) {
    setPrevPage1(card.activity);
    setExtraItems([]);
    setCursor(activityCursorFor(card.activity));
  }
  const items = [...card.activity, ...extraItems];

  function loadMore(): void {
    if (!cursor) return;
    startTransition(async () => {
      const result = await getMoreCardActivity({ cardId: card.id, cursor });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      setExtraItems((prev) => [...prev, ...result.items]);
      setCursor(result.nextCursor);
    });
  }

  return (
    <section className={styles.cardSection}>
      <Typography variant="label">Activity</Typography>

      {items.length === 0 ? (
        <Typography variant="caption" className={styles.descriptionPlaceholder}>
          No activity yet.
        </Typography>
      ) : (
        <ul className={styles.activityList}>
          {items.map((item) => (
            <li key={item.id}>
              <Typography variant="caption">
                <strong>{displayName(item.actorId, currentUser, board.members)}</strong>{' '}
                {describeActivity(item, {
                  lists: board.lists,
                  labels: board.labels,
                  resolveName: (userId) => displayName(userId, currentUser, board.members),
                })}
                {' · '}
                <TimeAgo ms={item.createdAt} />
              </Typography>
            </li>
          ))}
        </ul>
      )}

      {error && <p className={styles.formError}>{error}</p>}

      {cursor && (
        <Button variant="ghost" size="sm" onClick={loadMore} loading={pending}>
          Load more
        </Button>
      )}
    </section>
  );
}
