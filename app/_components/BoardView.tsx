'use client';

import { useMemo, useOptimistic, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  closestCenter,
  closestCorners,
  DndContext,
  DragOverlay,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext } from '@dnd-kit/sortable';
import {
  Avatar,
  Button,
  ConfirmDialog,
  EmptyState,
  Icon,
  Menu,
  MenuEntries,
  Popover,
  Typography,
  useIsMobile,
  useToast,
  type MenuEntry,
} from '@sovereignfs/ui';
import { archiveBoard, deleteBoard, moveCard, reorderList, restoreBoard } from '../actions';
import { useBoardDndSensors } from '../_lib/dndSensors';
import { matchesBoardFilter, normalizeFilterQuery } from '../_lib/filter';
import { displayName } from '../_lib/identity';
import {
  applyOrder,
  findListOf,
  listIdFromDropId,
  neighborsOf,
  seedOrder,
  type OrderState,
} from '../_lib/order';
import { resolveBoardColor } from '../_lib/palette';
import type { BoardCardSummary, BoardData, BoardList, CardDetail } from '../_lib/queries';
import styles from '../kanban.module.css';
import { AddListSlot } from './AddListSlot';
import { ArchivedCardsDialog } from './ArchivedCardsDialog';
import { BoardActivityDialog } from './BoardActivityDialog';
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

type ActiveDrag =
  { type: 'list'; list: BoardList } | { type: 'card'; card: BoardCardSummary } | null;
type BoardDialog =
  'settings' | 'share' | 'activity' | 'archived' | 'archive-board' | 'delete-board' | null;

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

/** Where a card drag is currently pointing: a list and an insertion index within it. */
function resolveCardTarget(
  over: DragOverEvent['over'],
  state: OrderState,
): { toListId: string; toIndex: number } | null {
  if (!over) return null;
  const overData = over.data.current as { type?: 'list' | 'card' } | undefined;
  const overId = String(over.id);
  if (overData?.type === 'card') {
    // The list the hovered card *currently* sits in (from live order state,
    // not the card's static `listId` data — the only card that ever moves
    // mid-drag is the active one, which is never `over`).
    const listId = findListOf(state, overId);
    if (!listId) return null;
    return { toListId: listId, toIndex: (state.cardOrderByList[listId] ?? []).indexOf(overId) };
  }
  if (overData?.type === 'list') {
    return { toListId: overId, toIndex: (state.cardOrderByList[overId] ?? []).length };
  }
  const dropListId = listIdFromDropId(overId);
  if (dropListId) {
    return { toListId: dropListId, toIndex: (state.cardOrderByList[dropListId] ?? []).length };
  }
  return null;
}

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
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [dialog, setDialog] = useState<BoardDialog>(null);
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag>(null);
  // Live order while a card is being dragged across lists — see
  // `handleDragOver`. Null when no cross-list preview is in effect.
  const [dragOrder, setDragOrder] = useState<OrderState | null>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [, startTransition] = useTransition();
  const [boardActionPending, startBoardAction] = useTransition();
  const sensors = useBoardDndSensors();

  // K.21 — the one flag every interactive surface below keys off: a viewer
  // (project owner or public-project member with no board membership) or
  // anyone on an archived board gets the full board, read-only.
  const isArchived = board.archivedAt !== null;
  const canEdit = board.role !== 'viewer' && !isArchived;
  // Share shows the member list to members, and management to managers —
  // a plain viewer has no business in it (SPEC K.21: "Share CTA hidden").
  const canOpenShare = board.role !== 'viewer' || board.canManage;

  const listById = useMemo(() => new Map(board.lists.map((l) => [l.id, l])), [board.lists]);
  const cardById = useMemo(() => new Map(board.cards.map((c) => [c.id, c])), [board.cards]);

  const baseOrder = useMemo(() => seedOrder(board.lists, board.cards), [board.lists, board.cards]);
  const [order, dispatchOrder] = useOptimistic(baseOrder, applyOrder);
  const displayOrder = dragOrder ?? order;

  const orderedLists = displayOrder.listOrder
    .map((id) => listById.get(id))
    .filter((l): l is BoardList => l !== undefined);

  // K.10 search/filter — client-side only, over the already-loaded board
  // payload (title + label names). The underlying `order` (drag source of
  // truth) is never touched by filtering — only which cards `cardsFor`
  // returns for rendering.
  const trimmedQuery = normalizeFilterQuery(filterQuery);
  const isFiltering = trimmedQuery.length > 0;
  const dragEnabled = canEdit && !isFiltering;

  function cardsFor(listId: string): BoardCardSummary[] {
    const ordered = (displayOrder.cardOrderByList[listId] ?? [])
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

  /**
   * Cross-list live preview (dnd-kit's multi-container pattern): the moment
   * a dragged card is over another list, move it there in local state so
   * that list's cards make room and the placeholder appears where the drop
   * will land — previously the card only jumped on drop and the target
   * list never reacted. Same-list reordering is left to the list's own
   * `SortableContext` transforms, which already animate it live.
   */
  function handleDragOver(event: DragOverEvent): void {
    const { active, over } = event;
    const activeData = active.data.current as { type?: 'list' | 'card' } | undefined;
    if (activeData?.type !== 'card' || !over || active.id === over.id) return;
    const current = dragOrder ?? order;
    const cardId = String(active.id);
    const fromListId = findListOf(current, cardId);
    const target = resolveCardTarget(over, current);
    if (!fromListId || !target || target.toListId === fromListId || target.toIndex === -1) return;
    setDragOrder(applyOrder(current, { type: 'moveCard', cardId, ...target }));
  }

  function handleDragCancel(): void {
    setActiveDrag(null);
    setDragOrder(null);
  }

  function handleDragEnd(event: DragEndEvent): void {
    setActiveDrag(null);
    setDragOrder(null);
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current as { type?: 'list' | 'card' } | undefined;
    const overData = over.data.current as { type?: 'list' | 'card' } | undefined;

    if (activeData?.type === 'list') {
      if (overData?.type !== 'list' || active.id === over.id) return;
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
    // Resolve the final landing spot against the *previewed* order (the card
    // may already sit in the target list from `handleDragOver`), then
    // re-express it as one action against the committed base order so the
    // optimistic reducer and the server see the same move.
    const current = dragOrder ?? order;
    const fromListId = findListOf(current, cardId);
    if (!fromListId) return;
    let final = current;
    if (active.id !== over.id) {
      const target = resolveCardTarget(over, current);
      if (!target || target.toIndex === -1) return;
      final = applyOrder(current, { type: 'moveCard', cardId, ...target });
    }
    const toListId = findListOf(final, cardId);
    if (!toListId) return;
    const finalList = final.cardOrderByList[toListId] ?? [];
    const toIndex = finalList.indexOf(cardId);
    const originListId = findListOf(order, cardId);
    if (
      toListId === originListId &&
      toIndex === (order.cardOrderByList[toListId] ?? []).indexOf(cardId)
    ) {
      return; // dropped exactly where it started
    }

    const action = { type: 'moveCard' as const, cardId, toListId, toIndex };
    const { prevId, nextId } = neighborsOf(finalList, cardId);
    startTransition(async () => {
      dispatchOrder(action);
      const result = await moveCard({ cardId, toListId, prevCardId: prevId, nextCardId: nextId });
      if (!result.ok) {
        toast.show({ title: 'Couldn’t move card', message: result.error, category: 'error' });
      }
    });
  }

  function runBoardAction(
    action: () => Promise<{ ok: boolean; error?: string }>,
    failTitle: string,
    onSuccess?: () => void,
  ): void {
    startBoardAction(async () => {
      const result = await action();
      if (result.ok) {
        setDialog(null);
        onSuccess?.();
      } else {
        toast.show({ title: failTitle, message: result.error ?? 'Try again.', category: 'error' });
      }
    });
  }

  // Board options — everyone gets Activity and the archive panel (reads);
  // managers (board owner or project owner, K.20) also get Settings,
  // Archive/Restore, and Delete.
  const boardMenuItems: MenuEntry[] = [
    { label: 'Activity', icon: 'activity', onSelect: () => setDialog('activity') },
    {
      label:
        board.archivedCardCount > 0
          ? `Archived cards (${board.archivedCardCount})`
          : 'Archived cards',
      icon: 'archive',
      onSelect: () => setDialog('archived'),
    },
    ...(board.canManage
      ? ([
          { type: 'separator' },
          { label: 'Settings', icon: 'settings', onSelect: () => setDialog('settings') },
          isArchived
            ? {
                label: 'Restore board',
                icon: 'archive-restore',
                onSelect: () =>
                  runBoardAction(
                    () => restoreBoard({ boardId: board.id }),
                    'Couldn’t restore board',
                  ),
              }
            : {
                label: 'Archive board',
                icon: 'archive',
                onSelect: () => setDialog('archive-board'),
              },
          { type: 'separator' },
          {
            label: 'Delete board',
            icon: 'trash-2',
            destructive: true,
            onSelect: () => setDialog('delete-board'),
          },
        ] satisfies MenuEntry[])
      : []),
  ];

  // K.13 — mobile keeps the card overlay's URL contract but adds `?list=`;
  // closing must return to the list the card was opened from.
  const closeHref = isMobile && cardDetail ? `${pathname}?list=${cardDetail.listId}` : undefined;

  const readOnlyNotice = isArchived
    ? 'This board is archived and read-only.'
    : board.role === 'viewer'
      ? board.projectRole === 'owner'
        ? 'View only — you own this project but aren’t a member of this board.'
        : 'View only — you can see this board as a project member.'
      : null;

  return (
    <>
      {isMobile ? (
        <div className={styles.mobileBoardWrap}>
          <MobileBoardHeader
            board={board}
            menuItems={boardMenuItems}
            canOpenShare={canOpenShare}
            onOpenShare={() => setDialog('share')}
          />
          {readOnlyNotice && <ReadOnlyBanner notice={readOnlyNotice} />}
          <div className={styles.mobileBoardContent}>
            {board.lists.length === 0 ? (
              <EmptyBoard boardId={board.id} color={board.color} canEdit={canEdit} />
            ) : (
              <MobileBoardView
                board={board}
                orderedLists={orderedLists}
                cardsFor={cardsFor}
                canEdit={canEdit}
              />
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Board View's own "secondary header" toolbar (Trello-style: board
              name + search/members/share in their own compact bar above the
              colored canvas). Always a plain neutral surface — only the
              canvas behind the list columns takes the board's own color. */}
          <div className={styles.boardToolbar}>
            <div className={styles.boardTitleBlock}>
              <Typography variant="h1" as="h1" className={styles.boardTitle}>
                {board.name}
              </Typography>
              {board.description && (
                <span className={styles.boardDescription} title={board.description}>
                  <Typography variant="caption">{board.description}</Typography>
                </span>
              )}
            </div>
            <div className={styles.boardToolbarCenter}>
              <BoardSearchField value={filterQuery} onChange={setFilterQuery} />
            </div>
            <div className={styles.boardHeaderActions}>
              <MemberAvatarStack members={board.members} currentUser={currentUser} />
              {canOpenShare && (
                <Button variant="secondary" size="sm" onClick={() => setDialog('share')}>
                  <Icon name="user-round-plus" size="sm" aria-hidden={true} />
                  Share
                </Button>
              )}
              {/* `Popover` + `MenuEntries` directly, not the shared `Menu` —
                  `Menu`'s desktop path is a fixed 288px-wide `Popover`, which
                  read oversized here and sat a few px from the window edge.
                  `panelStyle`'s `right` offset pulls the panel in. */}
              <span className={styles.boardOptionsMenu}>
                <Popover
                  align="right"
                  width={220}
                  panelStyle={{ right: 'var(--sv-space-4)' }}
                  open={boardMenuOpen}
                  onClose={() => setBoardMenuOpen(false)}
                  aria-label="Board options"
                  trigger={
                    <Button
                      variant="ghost"
                      size="sm"
                      className={styles.boardOptionsTrigger}
                      aria-label="Board options"
                      onClick={() => setBoardMenuOpen((v) => !v)}
                    >
                      <Icon name="ellipsis-vertical" size="sm" aria-hidden={true} />
                    </Button>
                  }
                >
                  <MenuEntries
                    items={boardMenuItems}
                    onSelect={(entry) => {
                      setBoardMenuOpen(false);
                      entry.onSelect?.();
                    }}
                  />
                </Popover>
              </span>
            </div>
          </div>

          {readOnlyNotice && <ReadOnlyBanner notice={readOnlyNotice} />}
          {isFiltering && canEdit && (
            <Typography variant="caption" className={styles.filterHint}>
              Drag-and-drop is paused while searching — clear the search to reorder cards.
            </Typography>
          )}

          {board.lists.length === 0 ? (
            <EmptyBoard boardId={board.id} color={board.color} canEdit={canEdit} />
          ) : null}
        </>
      )}

      {!isMobile && board.lists.length > 0 && (
        <DndContext
          id="kanban-board-dnd"
          // Always the same sensors array. Swapping in an empty one to
          // disable dragging looks tempting, but dnd-kit spreads `sensors`
          // into a `useEffect` dependency array internally, so going from
          // two sensors to zero changes that array's *size* between renders
          // — React logs "The final argument passed to useEffect changed
          // size between renders" every time a filter is typed or cleared
          // (found live in the browser console; invisible to the test
          // suite). Dragging is instead switched off per item, via
          // `useSortable({ disabled })` in `ListColumn`/`CardTile`, which
          // covers the pointer and keyboard sensors alike.
          sensors={sensors}
          collisionDetection={collisionDetectionStrategy}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={displayOrder.listOrder} strategy={horizontalListSortingStrategy}>
            <div className={styles.listsRow} data-filtering={isFiltering || undefined}>
              {orderedLists.map((list) => (
                <ListColumn
                  key={list.id}
                  list={list}
                  cards={cardsFor(list.id)}
                  query={trimmedQuery}
                  canEdit={canEdit}
                  dragEnabled={dragEnabled}
                />
              ))}
              {canEdit && <AddListSlot boardId={board.id} variant="inline" />}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeDrag?.type === 'list' && (
              <ListDragPreview
                list={activeDrag.list}
                cardCount={cardsFor(activeDrag.list.id).length}
              />
            )}
            {activeDrag?.type === 'card' && <CardDragPreview card={activeDrag.card} />}
          </DragOverlay>
        </DndContext>
      )}

      {dialog === 'settings' && board.canManage && (
        <BoardSettingsDialog board={board} onClose={() => setDialog(null)} />
      )}
      {dialog === 'share' && canOpenShare && (
        <BoardShareDialog board={board} currentUser={currentUser} onClose={() => setDialog(null)} />
      )}
      {dialog === 'activity' && (
        <BoardActivityDialog
          board={board}
          currentUser={currentUser}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'archived' && (
        <ArchivedCardsDialog board={board} canEdit={canEdit} onClose={() => setDialog(null)} />
      )}
      {dialog === 'archive-board' && (
        <ConfirmDialog
          open
          onClose={() => setDialog(null)}
          title={`Archive "${board.name}"?`}
          message="The board becomes read-only and moves out of the Home grid. Nothing is deleted — you can restore it any time from its menu."
          confirmLabel={boardActionPending ? 'Archiving…' : 'Archive board'}
          pending={boardActionPending}
          onConfirm={() =>
            runBoardAction(() => archiveBoard({ boardId: board.id }), 'Couldn’t archive board')
          }
        />
      )}
      {dialog === 'delete-board' && (
        <ConfirmDialog
          open
          onClose={() => setDialog(null)}
          title={`Delete "${board.name}"?`}
          message="This permanently deletes the board with every list, card, comment, and its history. This can't be undone — archive it instead if you might need it later."
          destructive
          confirmLabel={boardActionPending ? 'Deleting…' : 'Delete board'}
          pending={boardActionPending}
          onConfirm={() =>
            runBoardAction(
              () => deleteBoard({ boardId: board.id }),
              'Couldn’t delete board',
              () => router.push('/kanban'),
            )
          }
        />
      )}

      <CardDetailOverlay
        board={board}
        cardDetail={cardDetail}
        currentUser={currentUser}
        canEdit={canEdit}
        closeHref={closeHref}
      />
    </>
  );
}

/** K.21 — the one line that tells a viewer (or anyone on an archived board) why nothing is editable. */
function ReadOnlyBanner({ notice }: { notice: string }) {
  return (
    <div className={styles.readOnlyBanner} role="status">
      <Icon name="eye" size="sm" aria-hidden={true} />
      <Typography variant="caption">{notice}</Typography>
    </div>
  );
}

/**
 * K.13 — compact mobile equivalent of the web toolbar's action row.
 * Rendered above both the carousel and the empty-board state so the board
 * menu stays reachable even before the board has any lists. A bespoke row
 * (leading back affordance + title + trailing kebab) rather than
 * `OverlayHeader`, which always renders a trailing close button.
 */
function MobileBoardHeader({
  board,
  menuItems,
  canOpenShare,
  onOpenShare,
}: {
  board: BoardData;
  menuItems: MenuEntry[];
  canOpenShare: boolean;
  onOpenShare: () => void;
}) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={styles.mobileBoardOverlayHeader}>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Back to boards"
        onClick={() => router.push('/kanban')}
      >
        <Icon name="circle-chevron-left" size="md" aria-hidden={true} />
      </Button>
      <Typography variant="h4" as="span" className={styles.mobileBoardTitle}>
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
          ...(canOpenShare
            ? [{ label: 'Share', icon: 'upload' as const, onSelect: onOpenShare }]
            : []),
          ...menuItems,
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
  // Redundant once you're the only member — the stack exists to show *who
  // else* is here, and "just me" is already implied by the header's own
  // account avatar.
  if (members.length < 2) return null;

  const shown = members.slice(0, MAX_STACKED_AVATARS);
  const overflow = members.length - shown.length;
  const label = `${members.length} members`;

  return (
    <div className={styles.memberAvatarStack} aria-label={label} title={label}>
      {shown.map((member) => (
        <Avatar
          key={member.userId}
          name={displayName(member.userId, currentUser, members)}
          src={member.image ?? undefined}
          size="md"
          className={`${styles.memberAvatar} ${styles.stackedAvatar}`}
        />
      ))}
      {overflow > 0 && <span className={styles.stackedAvatarOverflow}>+{overflow}</span>}
    </div>
  );
}

/**
 * This is the one place a board's empty canvas paints text directly on the
 * raw board colour, with no card/surface behind it. `textOn` (hand-picked
 * per curated swatch, WCAG-computed for a custom hex) picks whichever of
 * the two theme-invariant `--sv-color-text-on-*-fill` tokens contrasts with
 * this board's colour, then locally overrides the tokens EmptyState reads.
 */
function EmptyBoard({
  boardId,
  color,
  canEdit,
}: {
  boardId: string;
  color: string;
  canEdit: boolean;
}) {
  const resolved = resolveBoardColor(color);
  const textOnClass = resolved
    ? resolved.textOn === 'light'
      ? styles.emptyBoardOnDarkFill
      : styles.emptyBoardOnLightFill
    : undefined;
  return (
    <EmptyState
      icon="grid-2x2"
      heading={canEdit ? 'Add your first list' : 'Nothing here yet'}
      description={
        canEdit
          ? 'Lists organize this board’s cards — try "To Do", "In Progress", "Done".'
          : 'This board has no lists yet.'
      }
      action={canEdit ? <AddListSlot boardId={boardId} variant="empty" /> : undefined}
      className={[textOnClass, styles.emptyBoardGutter].filter(Boolean).join(' ')}
    />
  );
}
