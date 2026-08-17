'use client';

import { useMemo, useOptimistic, useState, useTransition } from 'react';
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
import { Button, EmptyState, PageHeader, Typography, useToast } from '@sovereignfs/ui';
import { moveCard, reorderList } from '../actions';
import { useBoardDndSensors } from '../_lib/dndSensors';
import { applyOrder, listIdFromDropId, neighborsOf, seedOrder } from '../_lib/order';
import type { BoardCardSummary, BoardData, BoardList, CardDetail } from '../_lib/queries';
import styles from '../kanban.module.css';
import { AddListSlot } from './AddListSlot';
import { BoardSettingsDialog } from './BoardSettingsDialog';
import { CardDetailOverlay } from './CardDetailOverlay';
import { CardDragPreview } from './CardTile';
import { ListColumn, ListDragPreview } from './ListColumn';

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag>(null);
  const [, startTransition] = useTransition();
  const sensors = useBoardDndSensors();

  const listById = useMemo(() => new Map(board.lists.map((l) => [l.id, l])), [board.lists]);
  const cardById = useMemo(() => new Map(board.cards.map((c) => [c.id, c])), [board.cards]);

  const baseOrder = useMemo(() => seedOrder(board.lists, board.cards), [board.lists, board.cards]);
  const [order, dispatchOrder] = useOptimistic(baseOrder, applyOrder);

  const orderedLists = order.listOrder
    .map((id) => listById.get(id))
    .filter((l): l is BoardList => l !== undefined);

  function cardsFor(listId: string): BoardCardSummary[] {
    return (order.cardOrderByList[listId] ?? [])
      .map((id) => cardById.get(id))
      .filter((c): c is BoardCardSummary => c !== undefined);
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

  const memberLabel =
    board.members.length === 1 ? '1 member' : `${board.members.length} members`;

  return (
    <>
      <PageHeader
        title={board.name}
        headingLevel={1}
        action={
          <div className={styles.boardHeaderActions}>
            <Typography variant="caption">{memberLabel}</Typography>
            {board.role === 'owner' && (
              <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>
                Settings
              </Button>
            )}
          </div>
        }
      />

      {board.lists.length === 0 ? (
        <EmptyBoard boardId={board.id} />
      ) : (
        <DndContext
          id="kanban-board-dnd"
          sensors={sensors}
          collisionDetection={collisionDetectionStrategy}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={order.listOrder} strategy={horizontalListSortingStrategy}>
            <div className={styles.listsRow}>
              {orderedLists.map((list) => (
                <ListColumn key={list.id} list={list} cards={cardsFor(list.id)} />
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

      <CardDetailOverlay board={board} cardDetail={cardDetail} currentUser={currentUser} />
    </>
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
