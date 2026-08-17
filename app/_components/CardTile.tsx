'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Icon, Typography } from '@sovereignfs/ui';
import type { BoardCardSummary } from '../_lib/queries';
import { boardColorValue } from '../_lib/palette';
import styles from '../kanban.module.css';

function formatDueDate(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(ms));
}

/**
 * Wraps the first case-insensitive occurrence of `query` in the title with a
 * highlight (K.10's "match highlighting"). Only the first occurrence, not
 * every one — a card title repeating the same substring more than once is
 * rare enough that splitting for every match isn't worth the complexity for
 * a Phase 1 filter.
 */
function HighlightedTitle({ title, query }: { title: string; query: string }) {
  if (!query) return <>{title}</>;
  const index = title.toLowerCase().indexOf(query);
  if (index === -1) return <>{title}</>;
  return (
    <>
      {title.slice(0, index)}
      <mark className={styles.searchMatch}>{title.slice(index, index + query.length)}</mark>
      {title.slice(index + query.length)}
    </>
  );
}

/** The card's visual content — shared between the real (interactive, sortable) tile and the DragOverlay preview. */
function CardTileBody({ card, query = '' }: { card: BoardCardSummary; query?: string }) {
  const hasMetadata =
    card.checklistTotal > 0 || card.commentCount > 0 || card.dueDate !== null || card.assigneeCount > 0;

  return (
    <>
      {card.labels.length > 0 && (
        <div className={styles.cardLabels} aria-hidden>
          {card.labels.map((label) => (
            <span
              key={label.id}
              className={styles.cardLabelChip}
              style={{ backgroundColor: boardColorValue(label.color) }}
            />
          ))}
        </div>
      )}

      <Typography variant="body" className={styles.cardTitle}>
        <HighlightedTitle title={card.title} query={query} />
      </Typography>

      {hasMetadata && (
        <div className={styles.cardMeta}>
          {card.checklistTotal > 0 && (
            <span className={styles.cardMetaItem}>
              <Icon name="circle-check" size="sm" aria-hidden={true} />
              {card.checklistDone}/{card.checklistTotal}
            </span>
          )}
          {card.commentCount > 0 && (
            <span className={styles.cardMetaItem}>
              <Icon name="mail" size="sm" aria-hidden={true} />
              {card.commentCount}
            </span>
          )}
          {card.dueDate !== null && (
            <span className={styles.cardMetaItem}>
              <Icon name="calendar" size="sm" aria-hidden={true} />
              {formatDueDate(card.dueDate)}
            </span>
          )}
          {card.assigneeCount > 0 && (
            <span className={styles.cardMetaItem}>
              <Icon name="user" size="sm" aria-hidden={true} />
              {card.assigneeCount}
            </span>
          )}
        </div>
      )}
    </>
  );
}

/**
 * The whole tile is both the click-to-open target and the drag surface — no
 * handle (SPEC's web interaction model). A short pointer-activation distance
 * (see `useBoardDndSensors`) is what lets dnd-kit tell a plain click from a
 * drag start, so the `Link` navigation still fires normally on a real click.
 */
export function CardTile({ card, query = '' }: { card: BoardCardSummary; query?: string }) {
  const pathname = usePathname();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', listId: card.listId },
  });

  return (
    <Link
      ref={setNodeRef}
      href={`${pathname}?card=${card.id}`}
      scroll={false}
      className={styles.cardTile}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
    >
      <CardTileBody card={card} query={query} />
    </Link>
  );
}

/** Static (non-interactive) rendering for `DragOverlay` — the floating copy that follows the cursor. */
export function CardDragPreview({ card }: { card: BoardCardSummary }) {
  return (
    <div className={[styles.cardTile, styles.cardDragPreview].join(' ')}>
      <CardTileBody card={card} />
    </div>
  );
}
