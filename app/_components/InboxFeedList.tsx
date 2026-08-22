import Link from 'next/link';
import { EmptyState, Typography } from '@sovereignfs/ui';
import { groupByDay } from '../_lib/inbox';
import { displayName } from '../_lib/identity';
import type { InboxFeed, InboxItem } from '../_lib/queries';
import type { CurrentUser } from './BoardView';
import styles from '../kanban.module.css';
import { TimeAgo } from './TimeAgo';

function describeInboxItem(kind: InboxItem['kind']): string {
  return kind === 'assigned' ? 'assigned you to' : 'replied to your comment on';
}

/**
 * Server-renderable — `describeInboxItem`/`displayName`/`groupByDay` are
 * plain functions (no hooks, no client-only APIs), so this list needs no
 * `'use client'` of its own despite living alongside client components.
 * `TimeAgo` (rendered below) is itself a client component, but a Server
 * Component can render a Client Component as a child with no `'use client'`
 * of its own — standard RSC composition, not an exception to the rule above.
 */
export function InboxFeedList({ feed, currentUser }: { feed: InboxFeed; currentUser: CurrentUser }) {
  if (feed.items.length === 0) {
    return (
      <EmptyState
        icon="inbox"
        heading="Nothing here yet"
        description="Cards assigned to you and replies to your comments will show up here."
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
                  href={`/kanban/b/${item.boardId}?card=${item.cardId}`}
                  className={styles.inboxItem}
                >
                  <Typography variant="body">
                    <strong>{displayName(item.actorId, currentUser, feed.members)}</strong>{' '}
                    {describeInboxItem(item.kind)} &quot;{item.cardTitle}&quot;
                  </Typography>
                  <Typography variant="caption" className={styles.inboxItemMeta}>
                    {item.boardName} · <TimeAgo ms={item.createdAt} />
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
