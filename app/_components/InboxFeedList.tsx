import Link from 'next/link';
import { EmptyState, Typography } from '@sovereignfs/ui';
import { describeActivity } from '../_lib/activity-copy';
import { groupByDay } from '../_lib/inbox';
import { displayName } from '../_lib/identity';
import { timeAgo } from '../_lib/time';
import type { InboxFeed } from '../_lib/queries';
import type { CurrentUser } from './BoardView';
import styles from '../kanban.module.css';

/**
 * Server-renderable — `describeActivity`/`displayName`/`groupByDay` are
 * plain functions (no hooks, no client-only APIs), so this list needs no
 * `'use client'` of its own despite living alongside client components.
 */
export function InboxFeedList({ feed, currentUser }: { feed: InboxFeed; currentUser: CurrentUser }) {
  if (feed.items.length === 0) {
    return (
      <EmptyState
        icon="bell"
        heading="Nothing here yet"
        description="Activity across the boards you belong to will show up here."
      />
    );
  }

  const groups = groupByDay(feed.items);

  return (
    <div className={styles.inboxFeed}>
      {groups.map((group) => (
        <section key={group.label} className={styles.inboxDayGroup}>
          <Typography variant="label" className={styles.inboxDayLabel}>
            {group.label}
          </Typography>
          <ul className={styles.inboxItemList}>
            {group.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={
                    item.cardId
                      ? `/kanban/boards/${item.boardId}?card=${item.cardId}`
                      : `/kanban/boards/${item.boardId}`
                  }
                  className={styles.inboxItem}
                >
                  <Typography variant="body">
                    <strong>{displayName(item.actorId, currentUser, feed.members)}</strong>{' '}
                    {describeActivity(item, {
                      lists: feed.lists,
                      labels: feed.labels,
                      resolveName: (userId) => displayName(userId, currentUser, feed.members),
                    })}
                  </Typography>
                  <Typography variant="caption" className={styles.inboxItemMeta}>
                    {item.boardName}
                    {item.cardTitle ? ` · ${item.cardTitle}` : ''} · {timeAgo(item.createdAt)}
                  </Typography>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
