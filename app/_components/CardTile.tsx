'use client';

import { memo } from 'react';
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

/**
 * The card's visual content — shared between the web tile, the DragOverlay
 * preview, and K.15's MobileCardTile (below).
 */
export function CardTileBody({ card, query = '' }: { card: BoardCardSummary; query?: string }) {
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
 *
 * `memo`-wrapped (K.16 performance pass): `ListColumn` rebuilds its `cards`
 * array via `cardsFor()` on every `BoardView` render, so the ARRAY is never
 * referentially stable — but the individual `BoardCardSummary` objects
 * inside it are (`cardById.get(id)` returns the same object from `board.cards`
 * for any card whose data hasn't changed, reorder or not). React reconciles
 * `cards.map(c => <CardTile key={c.id} .../>)` per-key regardless of the
 * array wrapper, so memoizing here still lets an unrelated 195-card reorder
 * skip re-rendering every untouched tile. See SPEC.md's K.16 status entry
 * for the measured before/after on a seeded 200-card list.
 */
export const CardTile = memo(function CardTile({
  card,
  query = '',
}: {
  card: BoardCardSummary;
  query?: string;
}) {
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
 * MobileListSlide, scoped to exactly one list's cards, so there's no
 * cross-list collision branching to disambiguate, unlike web's shared
 * board-wide DndContext; (c) rendered inside a DndContext using
 * `useMobileCardDndSensors` (long-press TouchSensor), not
 * `useBoardDndSensors` (short-distance PointerSensor) — `listeners` from
 * `useSortable` adapts to whichever sensors are active on that ancestor
 * automatically, so this component itself doesn't need to know which. See
 * `.mobileCardTile` in kanban.module.css for why this does NOT reuse
 * CardTile's own `touch-action: none`.
 *
 * `memo`-wrapped for the same reason as `CardTile` above — `href` is a
 * freshly-computed string each render (`cardHrefFor` is a new closure every
 * `MobileListSlide` render), but string props compare by value, not
 * reference, so an unchanged `href` still counts as equal for `memo`'s
 * default shallow comparison.
 */
export const MobileCardTile = memo(function MobileCardTile({
  card,
  href,
}: {
  card: BoardCardSummary;
  href: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });

  return (
    <Link
      ref={setNodeRef}
      href={href}
      scroll={false}
      className={[styles.cardTile, styles.mobileCardTile].join(' ')}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
    >
      <CardTileBody card={card} />
    </Link>
  );
});
