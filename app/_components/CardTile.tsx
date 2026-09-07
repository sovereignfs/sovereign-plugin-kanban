'use client';

import { memo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Icon, Typography } from '@sovereignfs/ui';
import { describeDueState, dueState, type DueState } from '../_lib/due';
import type { BoardCardSummary } from '../_lib/queries';
import { boardColorValue } from '../_lib/palette';
import styles from '../kanban.module.css';

function formatDueDate(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(ms),
  );
}

const DUE_CLASS: Record<DueState, string | undefined> = {
  overdue: styles.cardMetaDueOverdue,
  today: styles.cardMetaDueToday,
  soon: styles.cardMetaDueSoon,
  later: undefined,
};

/**
 * Wraps the first case-insensitive occurrence of `query` in the title with a
 * highlight (K.10's "match highlighting"). Only the first occurrence, not
 * every one — a card title repeating the same substring more than once is
 * rare enough that splitting for every match isn't worth the complexity.
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

/**
 * The card's visual content — shared between the web tile, the DragOverlay
 * preview, and K.15's MobileCardTile (below).
 */
export function CardTileBody({ card, query = '' }: { card: BoardCardSummary; query?: string }) {
  const hasMetadata =
    card.checklistTotal > 0 ||
    card.commentCount > 0 ||
    card.dueDate !== null ||
    card.assigneeCount > 0;
  const due = card.dueDate !== null ? dueState(card.dueDate) : null;

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
              <Icon name="message-square" size="sm" aria-hidden={true} />
              {card.commentCount}
            </span>
          )}
          {card.dueDate !== null && due && (
            // Overdue/today/soon get their own colour so a slipping card
            // reads at a glance instead of every due date looking the same.
            <span
              className={[styles.cardMetaItem, DUE_CLASS[due]].filter(Boolean).join(' ')}
              title={describeDueState(due)}
              aria-label={`${describeDueState(due)}: ${formatDueDate(card.dueDate)}`}
            >
              <Icon name={due === 'later' ? 'calendar' : 'clock'} size="sm" aria-hidden={true} />
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
 * dnd-kit's sortable `attributes` include `role="button"` and `aria-pressed`
 * — fine on a div, wrong on a link (a screen reader would announce the tile
 * as a button and lose the "opens the card" navigation semantics). Keep the
 * keyboard/drag wiring (`tabIndex`, `aria-roledescription`,
 * `aria-describedby`) and drop the role override.
 */
function linkSafeAttributes(attributes: ReturnType<typeof useSortable>['attributes']) {
  const { role: _role, 'aria-pressed': _pressed, ...rest } = attributes;
  return rest;
}

/**
 * The whole tile is both the click-to-open target and the drag surface — no
 * handle (SPEC's web interaction model). A short pointer-activation distance
 * (see `useBoardDndSensors`) is what lets dnd-kit tell a plain click from a
 * drag start, so the `Link` navigation still fires normally on a real click.
 *
 * `memo`-wrapped (K.16 performance pass): `ListColumn` rebuilds its `cards`
 * array on every `BoardView` render, but the individual `BoardCardSummary`
 * objects inside it are referentially stable, so an unrelated reorder skips
 * re-rendering every untouched tile.
 */
export const CardTile = memo(function CardTile({
  card,
  query = '',
  dragEnabled = true,
}: {
  card: BoardCardSummary;
  query?: string;
  /**
   * False leaves the tile a plain link with no drag surface — a read-only
   * viewer or archived board (K.21), and also while a search filter is
   * active (see `BoardView`'s `sensors` comment).
   */
  dragEnabled?: boolean;
}) {
  const pathname = usePathname();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', listId: card.listId },
    disabled: !dragEnabled,
  });

  return (
    <Link
      ref={setNodeRef}
      href={`${pathname}?card=${card.id}`}
      scroll={false}
      className={styles.cardTile}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      {...linkSafeAttributes(attributes)}
      {...(dragEnabled ? listeners : {})}
    >
      <CardTileBody card={card} query={query} />
    </Link>
  );
});

/** Static (non-interactive) rendering for `DragOverlay` — the floating copy that follows the cursor. */
export function CardDragPreview({ card }: { card: BoardCardSummary }) {
  return (
    <div className={[styles.cardTile, styles.cardDragPreview].join(' ')}>
      <CardTileBody card={card} />
    </div>
  );
}

/**
 * K.15 — mobile's sortable card tile. Visually identical to CardTile, but:
 * (a) `href` is passed in rather than built from `pathname` alone, since
 * mobile's URL contract also carries `?list=<id>` (K.13); (b) no `data`
 * passed to `useSortable` — the enclosing DndContext lives inside
 * MobileListSlide, scoped to exactly one list's cards; (c) rendered inside a
 * DndContext using `useMobileCardDndSensors` (long-press TouchSensor). See
 * `.mobileCardTile` in kanban.module.css for why this does NOT reuse
 * CardTile's own `touch-action: none`.
 */
export const MobileCardTile = memo(function MobileCardTile({
  card,
  href,
  dragEnabled = true,
}: {
  card: BoardCardSummary;
  href: string;
  dragEnabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: !dragEnabled,
  });

  return (
    <Link
      ref={setNodeRef}
      href={href}
      scroll={false}
      className={[styles.cardTile, styles.mobileCardTile].join(' ')}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
      }}
      {...linkSafeAttributes(attributes)}
      {...(dragEnabled ? listeners : {})}
    >
      <CardTileBody card={card} />
    </Link>
  );
});
