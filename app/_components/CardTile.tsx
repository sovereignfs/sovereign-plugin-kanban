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

/** The card's visual content — shared between the real (interactive, sortable) tile and the DragOverlay preview. */
function CardTileBody({ card }: { card: BoardCardSummary }) {
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
        {card.title}
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
export function CardTile({ card }: { card: BoardCardSummary }) {
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
      <CardTileBody card={card} />
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
