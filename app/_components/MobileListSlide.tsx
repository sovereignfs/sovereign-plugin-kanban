'use client';

import { useMemo, useOptimistic, useState, useTransition, type KeyboardEvent } from 'react';
import { closestCenter, DndContext, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  Button,
  Icon,
  Input,
  Menu,
  SwipableMobileCarouselSlideBody,
  Typography,
  useCommitOnEnterOrBlur,
  useToast,
} from '@sovereignfs/ui';
import { moveCard, renameList } from '../actions';
import { useMobileCardDndSensors } from '../_lib/dndSensors';
import { neighborsOf } from '../_lib/order';
import type { BoardCardSummary, BoardList } from '../_lib/queries';
import styles from '../kanban.module.css';
import { MobileCardTile } from './CardTile';
import { DeleteListConfirm } from './ListColumn';
import { QuickAddCard } from './QuickAddCard';

/**
 * One carousel slide's contents (K.13) — the mobile equivalent of
 * ListColumn. List reorder isn't in Phase 1 mobile scope at all (see K.13's
 * own status entry); card reorder is K.15's own long-press `DndContext`,
 * scoped to exactly this list's cards — a separate instance per slide (not
 * one shared across the whole carousel) is what makes "within-list only"
 * true at the code level rather than just true in practice because the
 * other lists' cards happen to be off-screen.
 *
 * Rendered inside SwipableMobileCarouselSlide, itself gated by that
 * component's own mount-window logic — so this only actually mounts for the
 * active slide ± prefetchDistance, matching the "no fetch/render for
 * off-screen lists" behavior the carousel primitive already centralizes.
 */
export function MobileListSlide({
  list,
  cards,
  cardHrefFor,
}: {
  list: BoardList;
  cards: BoardCardSummary[];
  cardHrefFor: (cardId: string) => string;
}) {
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [addingCard, setAddingCard] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const sensors = useMobileCardDndSensors();

  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const baseOrder = useMemo(() => cards.map((c) => c.id), [cards]);
  const [order, dispatchOrder] = useOptimistic(baseOrder, (_state: string[], next: string[]) => next);
  const [, startReorderTransition] = useTransition();

  const orderedCards = order
    .map((id) => cardById.get(id))
    .filter((c): c is BoardCardSummary => c !== undefined);

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = order.indexOf(String(active.id));
    const toIndex = order.indexOf(String(over.id));
    if (fromIndex === -1 || toIndex === -1) return;
    const nextOrder = arrayMove(order, fromIndex, toIndex);
    const { prevId, nextId } = neighborsOf(nextOrder, String(active.id));
    startReorderTransition(async () => {
      dispatchOrder(nextOrder);
      const result = await moveCard({
        cardId: String(active.id),
        toListId: list.id,
        prevCardId: prevId,
        nextCardId: nextId,
      });
      if (!result.ok) {
        toast.show({ title: 'Couldn’t reorder card', message: result.error, category: 'error' });
      }
    });
  }

  return (
    <>
      <SwipableMobileCarouselSlideBody className={styles.mobileListSlideScroll}>
        <div className={styles.mobileListBody}>
          {/* Direct child of `.mobileListBody`, not `SwipableMobileCarouselSlideHeader`
              — mirrors `ListColumn`'s own desktop placement (`.listHeader` inside
              `.list`, both capped by the same box) rather than sitting above the
              box on the plain canvas background (developer-reported: the header
              read as detached from its own list's card container). The DS
              carousel's header slot exists for content that must render before an
              async body resolves (see `SwipableMobileCarouselSlideBody`'s own doc
              comment) — irrelevant here, since `list`/`cards` both arrive as
              already-resolved props, not fetched inside this component. */}
          <MobileListHeader
            list={list}
            renaming={renaming}
            onStartRename={() => setRenaming(true)}
            onStopRename={() => setRenaming(false)}
            menuOpen={menuOpen}
            onMenuTrigger={() => setMenuOpen((v) => !v)}
            onMenuClose={() => setMenuOpen(false)}
            onDelete={() => setDeleteOpen(true)}
            cardCount={cards.length}
          />
          <div className={styles.mobileListCards}>
            {orderedCards.length === 0 && (
              <Typography variant="caption" className={styles.descriptionPlaceholder}>
                No cards yet
              </Typography>
            )}
            <DndContext
              id={`mobile-list-dnd-${list.id}`}
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={order} strategy={verticalListSortingStrategy}>
                {orderedCards.map((card) => (
                  <MobileCardTile key={card.id} card={card} href={cardHrefFor(card.id)} />
                ))}
              </SortableContext>
            </DndContext>
          </div>

          {/* Right after the last card, in normal scroll flow — not
              `SwipableMobileCarouselSlideFooter`, which pins to the bottom of
              the *slide's* own flex column via `flex: 0 0 auto`. Matches
              `ListColumn`'s own desktop placement exactly — `QuickAddCard`
              as a plain sibling right after `.mobileListCards`, both inside
              `.mobileListBody`, not in any pinned slot: mirrors desktop's
              `.list` (ListHeader / `.listCards` / QuickAddCard, all direct
              children of the one capped box) so the trigger stays visible
              right under the cards rather than pinned to the whole slide's
              own bottom edge. */}
          <QuickAddCard listId={list.id} open={addingCard} onOpenChange={setAddingCard} />
        </div>
      </SwipableMobileCarouselSlideBody>

      {deleteOpen && (
        <DeleteListConfirm
          listId={list.id}
          listName={list.name}
          cardCount={cards.length}
          onClose={() => setDeleteOpen(false)}
          onError={(message) => toast.show({ title: 'Couldn’t delete list', message, category: 'error' })}
        />
      )}
    </>
  );
}

function MobileListHeader({
  list,
  renaming,
  onStartRename,
  onStopRename,
  menuOpen,
  onMenuTrigger,
  onMenuClose,
  onDelete,
  cardCount,
}: {
  list: BoardList;
  renaming: boolean;
  onStartRename: () => void;
  onStopRename: () => void;
  menuOpen: boolean;
  onMenuTrigger: () => void;
  onMenuClose: () => void;
  onDelete: () => void;
  cardCount: number;
}) {
  const toast = useToast();
  const [value, setValue] = useState(list.name);
  const [pending, startTransition] = useTransition();

  function commit(): void {
    const name = value.trim();
    if (!name || name === list.name) {
      setValue(list.name);
      onStopRename();
      return;
    }
    startTransition(async () => {
      const result = await renameList({ listId: list.id, name });
      if (!result.ok) {
        setValue(list.name);
        toast.show({ title: 'Couldn’t rename list', message: result.error, category: 'error' });
      }
      onStopRename();
    });
  }

  const commitHandlers = useCommitOnEnterOrBlur(commit);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Escape') {
      setValue(list.name);
      onStopRename();
      return;
    }
    commitHandlers.onKeyDown(e);
  }

  if (renaming) {
    return (
      <div className={styles.mobileListHeaderRow}>
        <Input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- replaces the list name only from the user's own tap on it, never on mount
          autoFocus
          value={value}
          disabled={pending}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commitHandlers.onBlur}
          aria-label="List name"
        />
      </div>
    );
  }

  return (
    <div className={styles.mobileListHeaderRow}>
      <button type="button" className={styles.mobileListName} onClick={onStartRename}>
        <Typography variant="h4" as="span">
          {list.name}
        </Typography>
        <Typography variant="caption">{cardCount}</Typography>
      </button>
      {/* `rectangle-ellipsis`, not the board header's own `ellipsis-vertical`
          — two identical kebab triggers stacked ~50px apart read as the
          same button repeated (developer-reported). A distinct glyph keeps
          this a menu (room to grow — more list-level actions can land here
          later) without visually colliding with the board header's own
          trigger above it. Add card and Rename list were dropped as items
          here since both already have dedicated affordances (tapping the
          title above renames it; `QuickAddCard`'s own "+ Add a card" row
          is the real entry point for adding a card) — Delete is the only
          one that was genuinely menu-only. */}
      <Menu
        trigger={
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Options for ${list.name}`}
            onClick={onMenuTrigger}
          >
            <Icon name="rectangle-ellipsis" size="sm" aria-hidden={true} />
          </Button>
        }
        open={menuOpen}
        onClose={onMenuClose}
        align="right"
        aria-label={`${list.name} options`}
        items={[{ label: 'Delete list', icon: 'trash-2', destructive: true, onSelect: onDelete }]}
      />
    </div>
  );
}
