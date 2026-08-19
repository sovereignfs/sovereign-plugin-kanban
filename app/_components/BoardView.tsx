'use client';

import { useMemo, useOptimistic, useState, useTransition } from 'react';
import { usePathname } from 'next/navigation';
import {
  closestCenter,
  closestCorners,
  DndContext,
  DragOverlay,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import {
  Avatar,
  Button,
  EmptyState,
  Icon,
  Menu,
  MenuEntries,
  Popover,
  Typography,
  useIsMobile,
  useToast,
} from '@sovereignfs/ui';
import { moveCard, reorderList } from '../actions';
import { useBoardDndSensors } from '../_lib/dndSensors';
import { matchesBoardFilter, normalizeFilterQuery } from '../_lib/filter';
import { displayName } from '../_lib/identity';
import { applyOrder, listIdFromDropId, neighborsOf, seedOrder } from '../_lib/order';
import type { BoardCardSummary, BoardData, BoardList, CardDetail } from '../_lib/queries';
import styles from '../kanban.module.css';
import { AddListSlot } from './AddListSlot';
import { BoardSearchField } from './BoardSearchField';
import { BoardSettingsDialog } from './BoardSettingsDialog';
import { BoardShareDialog } from './BoardShareDialog';
import { CardDetailOverlay } from './CardDetailOverlay';
import { CardDragPreview } from './CardTile';
import { ListColumn, ListDragPreview } from './ListColumn';
import { MobileBoardView } from './MobileBoardView';

export interface CurrentUser {
  id: string;
  name: string | null;
}

type ActiveDrag = { type: 'list'; list: BoardList } | { type: 'card'; card: BoardCardSummary } | null;

/**
 * Lists and cards share one `DndContext` (a card needs to be droppable onto
 * another list's header-adjacent area, e.g. an empty list). Plain
 * `closestCorners` compares a dragged item's rect against every registered
 * droppable regardless of level, so a list drag can resolve "over" to some
 * unrelated card purely by corner-distance — dnd-kit's own multi-container
 * examples hit the same issue and solve it the same way: scope collision
 * detection to same-level droppables first.
 */
const collisionDetectionStrategy: CollisionDetection = (args) => {
  if (args.active.data.current?.type === 'list') {
    const listContainers = args.droppableContainers.filter(
      (container) => container.data.current?.type === 'list',
    );
    return closestCenter({ ...args, droppableContainers: listContainers });
  }
  return closestCorners(args);
};

export function BoardView({
  board,
  cardDetail,
  currentUser,
}: {
  board: BoardData;
  cardDetail: CardDetail | null;
  currentUser: CurrentUser;
}) {
  const toast = useToast();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [, startTransition] = useTransition();
  const sensors = useBoardDndSensors();

  const listById = useMemo(() => new Map(board.lists.map((l) => [l.id, l])), [board.lists]);
  const cardById = useMemo(() => new Map(board.cards.map((c) => [c.id, c])), [board.cards]);

  const baseOrder = useMemo(() => seedOrder(board.lists, board.cards), [board.lists, board.cards]);
  const [order, dispatchOrder] = useOptimistic(baseOrder, applyOrder);

  const orderedLists = order.listOrder
    .map((id) => listById.get(id))
    .filter((l): l is BoardList => l !== undefined);

  // K.10 search/filter — client-side only, over the already-loaded board
  // payload (title + label names), instant, no server round trip. The
  // underlying `order` (drag source of truth) is never touched by
  // filtering — only which cards `cardsFor` returns for rendering — so
  // clearing the query always reverts cleanly with nothing to reconcile.
  const trimmedQuery = normalizeFilterQuery(filterQuery);
  const isFiltering = trimmedQuery.length > 0;

  function cardsFor(listId: string): BoardCardSummary[] {
    const ordered = (order.cardOrderByList[listId] ?? [])
      .map((id) => cardById.get(id))
      .filter((c): c is BoardCardSummary => c !== undefined);
    if (!isFiltering) return ordered;
    return ordered.filter((card) => matchesBoardFilter(card, trimmedQuery));
  }

  function handleDragStart(event: DragStartEvent): void {
    const data = event.active.data.current as { type?: 'list' | 'card' } | undefined;
    if (data?.type === 'list') {
      const list = listById.get(String(event.active.id));
      if (list) setActiveDrag({ type: 'list', list });
    } else if (data?.type === 'card') {
      const card = cardById.get(String(event.active.id));
      if (card) setActiveDrag({ type: 'card', card });
    }
  }

  function handleDragEnd(event: DragEndEvent): void {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeData = active.data.current as { type?: 'list' | 'card'; listId?: string } | undefined;
    const overData = over.data.current as { type?: 'list' | 'card'; listId?: string } | undefined;

    if (activeData?.type === 'list') {
      if (overData?.type !== 'list') return;
      const listId = String(active.id);
      const toIndex = order.listOrder.indexOf(String(over.id));
      if (toIndex === -1) return;
      const action = { type: 'moveList' as const, listId, toIndex };
      const nextState = applyOrder(order, action);
      const { prevId, nextId } = neighborsOf(nextState.listOrder, listId);
      startTransition(async () => {
        dispatchOrder(action);
        const result = await reorderList({ listId, prevListId: prevId, nextListId: nextId });
        if (!result.ok) {
          toast.show({ title: 'Couldn’t reorder list', message: result.error, category: 'error' });
        }
      });
      return;
    }

    if (activeData?.type !== 'card') return;
    const cardId = String(active.id);
    let toListId: string | null = null;
    let toIndex: number | null = null;

    if (overData?.type === 'card' && overData.listId) {
      toListId = overData.listId;
      toIndex = (order.cardOrderByList[toListId] ?? []).indexOf(String(over.id));
    } else if (overData?.type === 'list') {
      toListId = String(over.id);
      toIndex = (order.cardOrderByList[toListId] ?? []).length;
    } else {
      const dropListId = listIdFromDropId(String(over.id));
      if (dropListId) {
        toListId = dropListId;
        toIndex = (order.cardOrderByList[dropListId] ?? []).length;
      }
    }
    if (toListId === null || toIndex === null || toIndex === -1) return;

    const action = { type: 'moveCard' as const, cardId, toListId, toIndex };
    const nextState = applyOrder(order, action);
    const { prevId, nextId } = neighborsOf(nextState.cardOrderByList[toListId] ?? [], cardId);
    startTransition(async () => {
      dispatchOrder(action);
      const result = await moveCard({
        cardId,
        toListId: toListId as string,
        prevCardId: prevId,
        nextCardId: nextId,
      });
      if (!result.ok) {
        toast.show({ title: 'Couldn’t move card', message: result.error, category: 'error' });
      }
    });
  }

  // K.13 — mobile keeps the card overlay's URL contract but adds `?list=`
  // (see MobileBoardView's own doc comment); closing must return to the
  // list the card was opened from, not the bare board URL, or the carousel
  // would silently reset to slide 0 on every close. Web has no `list`
  // concept, so `closeHref` stays undefined there — CardDetailOverlay falls
  // back to its original bare-`pathname` behavior unchanged.
  const closeHref = isMobile && cardDetail ? `${pathname}?list=${cardDetail.listId}` : undefined;

  return (
    <>
      {isMobile ? (
        // Single flex column so the header's natural height and the
        // carousel's fill-the-rest height are computed relative to EACH
        // OTHER (flex: 0 0 auto / flex: 1 1 auto; min-height: 0) — not
        // independently guessed via viewport arithmetic, which is what
        // originally overshot the available space and rendered the
        // carousel partly behind the fixed footer (caught live via
        // getBoundingClientRect, not the screenshot alone — see SPEC.md's
        // K.13 status entry).
        <div className={styles.mobileBoardWrap}>
          <MobileBoardHeader
            board={board}
            onOpenShare={() => setShareOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          <div className={styles.mobileBoardContent}>
            {board.lists.length === 0 ? (
              <EmptyBoard boardId={board.id} />
            ) : (
              <MobileBoardView board={board} orderedLists={orderedLists} cardsFor={cardsFor} />
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Board View's own "secondary header" toolbar (Trello-style: board
              name + search/members/share in their own compact bar above the
              colored canvas) — deliberately not the shared `PageHeader` DS
              component here, since this needs a smaller title than
              `PageHeader`'s own fixed size (no title-specific className to
              override it from outside) plus a three-part layout (title,
              centered search, actions) `PageHeader` doesn't support. Always
              a plain neutral surface, same as the primary header above it —
              only the canvas behind the list columns (`.body`) takes the
              board's own color; see `.boardToolbar`'s own comment. */}
          <div className={styles.boardToolbar}>
            <Typography variant="h1" as="h1" className={styles.boardTitle}>
              {board.name}
            </Typography>
            <div className={styles.boardToolbarCenter}>
              <BoardSearchField value={filterQuery} onChange={setFilterQuery} />
            </div>
            <div className={styles.boardHeaderActions}>
              <MemberAvatarStack members={board.members} currentUser={currentUser} />
              <Button variant="secondary" size="sm" onClick={() => setShareOpen(true)}>
                <Icon name="user-round-plus" size="sm" aria-hidden={true} />
                Share
              </Button>
              {/* Same ellipsis-vertical trigger styling as `MobileBoardHeader`
                  below and `ListColumn`'s own list-options trigger — `ghost`,
                  not `secondary` like Share, so it reads as a plain icon
                  affordance rather than a second bordered button competing
                  with it. Owner-only since Settings is currently its only
                  item; add non-owner items here too if that ever changes.
                  `Popover` + `MenuEntries` directly, not the shared `Menu`
                  (used for the same purpose on mobile below) — `Menu`'s
                  desktop path is a fixed 288px-wide `Popover` with no way to
                  override it, which read oversized for a single "Settings"
                  item and, at `align="right"`, left the panel's own right
                  edge just a few px from the browser's own edge (it inherits
                  the trigger's position, itself deliberately close to the
                  window edge to line up with the account avatar above —
                  see `.boardOptionsMenu`'s own comment). `panelStyle`'s
                  `right` offset pulls the *panel* further from the window
                  edge without moving the trigger itself. */}
              {board.role === 'owner' && (
                <span className={styles.boardOptionsMenu}>
                  <Popover
                    align="right"
                    width={170}
                    panelStyle={{ right: 'var(--sv-space-4)' }}
                    open={boardMenuOpen}
                    onClose={() => setBoardMenuOpen(false)}
                    aria-label="Board options"
                    trigger={
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Board options"
                        onClick={() => setBoardMenuOpen((v) => !v)}
                      >
                        <Icon name="ellipsis-vertical" size="sm" aria-hidden={true} />
                      </Button>
                    }
                  >
                    <MenuEntries
                      items={[{ label: 'Settings', icon: 'settings', onSelect: () => setSettingsOpen(true) }]}
                      onSelect={(entry) => {
                        setBoardMenuOpen(false);
                        entry.onSelect();
                      }}
                    />
                  </Popover>
                </span>
              )}
            </div>
          </div>

          {board.lists.length === 0 ? <EmptyBoard boardId={board.id} /> : null}
        </>
      )}

      {!isMobile && board.lists.length > 0 && (
        <DndContext
          id="kanban-board-dnd"
          // Filtering can hide cards from a list's rendered/SortableContext
          // order without touching the real underlying order — dragging in
          // that state would compute prev/next neighbours from a visibly
          // incomplete list, silently reordering relative to hidden
          // siblings in a way the user can't see. Passing an empty sensors
          // array is a clean, total kill switch: no pointer or keyboard
          // activator gets registered anywhere in the tree, so no drag can
          // start at all while a filter is active (K.10 review checklist —
          // decided here rather than "safe": simpler to reason about and
          // matches this being a small Phase 1 filter, not a live reorder
          // feature that needs to keep working mid-search).
          sensors={isFiltering ? [] : sensors}
          collisionDetection={collisionDetectionStrategy}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={order.listOrder} strategy={horizontalListSortingStrategy}>
            <div className={styles.listsRow} data-filtering={isFiltering || undefined}>
              {orderedLists.map((list) => (
                <ListColumn key={list.id} list={list} cards={cardsFor(list.id)} query={trimmedQuery} />
              ))}
              <AddListSlot boardId={board.id} variant="inline" />
            </div>
          </SortableContext>
          <DragOverlay>
            {activeDrag?.type === 'list' && (
              <ListDragPreview list={activeDrag.list} cardCount={cardsFor(activeDrag.list.id).length} />
            )}
            {activeDrag?.type === 'card' && <CardDragPreview card={activeDrag.card} />}
          </DragOverlay>
        </DndContext>
      )}

      {settingsOpen && board.role === 'owner' && (
        <BoardSettingsDialog board={board} onClose={() => setSettingsOpen(false)} />
      )}

      {shareOpen && (
        <BoardShareDialog board={board} currentUser={currentUser} onClose={() => setShareOpen(false)} />
      )}

      <CardDetailOverlay
        board={board}
        cardDetail={cardDetail}
        currentUser={currentUser}
        closeHref={closeHref}
      />
    </>
  );
}

/**
 * K.13 — compact mobile equivalent of the web PageHeader's action row.
 * Rendered above both the carousel and the empty-board state (unlike
 * MobileBoardView, which only handles the non-empty carousel), so Share/
 * Settings stay reachable even before the board has any lists — a board
 * with zero lists otherwise has no other affordance to reach them on
 * mobile. No search field (K.10 is explicitly web-only per its own SPEC
 * title) and no member avatar stack (the member list is already reachable
 * via Share) — a deliberate scope cut to keep this compact, documented in
 * SPEC.md's K.13 status entry.
 */
function MobileBoardHeader({
  board,
  onOpenShare,
  onOpenSettings,
}: {
  board: BoardData;
  onOpenShare: () => void;
  onOpenSettings: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={styles.mobileBoardHeader}>
      <Typography variant="h4" as="h1" className={styles.mobileBoardTitle}>
        {board.name}
      </Typography>
      <Menu
        trigger={
          <Button
            variant="ghost"
            size="sm"
            aria-label="Board options"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Icon name="ellipsis-vertical" size="sm" aria-hidden={true} />
          </Button>
        }
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        align="right"
        aria-label="Board options"
        items={[
          { label: 'Share', icon: 'upload', onSelect: onOpenShare },
          ...(board.role === 'owner'
            ? [{ label: 'Settings', icon: 'settings' as const, onSelect: onOpenSettings }]
            : []),
        ]}
      />
    </div>
  );
}

const MAX_STACKED_AVATARS = 4;

function MemberAvatarStack({
  members,
  currentUser,
}: {
  members: BoardData['members'];
  currentUser: CurrentUser;
}) {
  const shown = members.slice(0, MAX_STACKED_AVATARS);
  const overflow = members.length - shown.length;
  const label = `${members.length} ${members.length === 1 ? 'member' : 'members'}`;

  return (
    <div className={styles.memberAvatarStack} aria-label={label} title={label}>
      {shown.map((member) => (
        <Avatar
          key={member.userId}
          name={displayName(member.userId, currentUser, members)}
          size="sm"
          className={`${styles.memberAvatar} ${styles.stackedAvatar}`}
        />
      ))}
      {overflow > 0 && <span className={styles.stackedAvatarOverflow}>+{overflow}</span>}
    </div>
  );
}

function EmptyBoard({ boardId }: { boardId: string }) {
  return (
    <EmptyState
      icon="grid-2x2"
      heading="Add your first list"
      description={'Lists organize this board’s cards — try "To Do", "In Progress", "Done".'}
      action={<AddListSlot boardId={boardId} variant="empty" />}
    />
  );
}
