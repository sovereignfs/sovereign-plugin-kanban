'use client';

import { useState, useTransition, type KeyboardEvent } from 'react';
import { useDroppable, type DraggableAttributes, type DraggableSyntheticListeners } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Button,
  ConfirmDialog,
  Icon,
  Input,
  Menu,
  Typography,
  useCommitOnEnterOrBlur,
  useToast,
} from '@sovereignfs/ui';
import { deleteList, renameList } from '../actions';
import { listDropId } from '../_lib/order';
import type { BoardCardSummary, BoardList } from '../_lib/queries';
import styles from '../kanban.module.css';
import { CardTile } from './CardTile';
import { QuickAddCard } from './QuickAddCard';

/**
 * The list itself is a sortable item (list-reorder drag), but the drag
 * surface is scoped to just its header — the cards area below is its own
 * nested sortable context for card drag/drop, and dragging a list by
 * grabbing its body would be ambiguous with dragging the cards inside it.
 * Matches Trello's own behaviour (grab a list by its title bar).
 */
export function ListColumn({
  list,
  cards,
  query = '',
}: {
  list: BoardList;
  cards: BoardCardSummary[];
  /** K.10 search/filter — `cards` already only contains matches; `query` is
   * just for title-highlighting and the "no matches" placeholder text. */
  query?: string;
}) {
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [addingCard, setAddingCard] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: list.id,
    data: { type: 'list' },
  });
  const { setNodeRef: setDropRef } = useDroppable({ id: listDropId(list.id) });

  return (
    <div
      ref={setNodeRef}
      className={styles.list}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
    >
      <ListHeader
        list={list}
        renaming={renaming}
        onStartRename={() => setRenaming(true)}
        onStopRename={() => setRenaming(false)}
        onMenuTrigger={() => setMenuOpen((v) => !v)}
        menuOpen={menuOpen}
        onMenuClose={() => setMenuOpen(false)}
        onAddCard={() => setAddingCard(true)}
        onDelete={() => setDeleteOpen(true)}
        cardCount={cards.length}
        dragAttributes={renaming ? undefined : attributes}
        dragListeners={renaming ? undefined : listeners}
      />

      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div ref={setDropRef} className={styles.listCards}>
          {query && cards.length === 0 && list.cardCount > 0 && (
            <Typography variant="caption" className={styles.descriptionPlaceholder}>
              No matching cards
            </Typography>
          )}
          {cards.map((card) => (
            <CardTile key={card.id} card={card} query={query} />
          ))}
        </div>
      </SortableContext>

      <QuickAddCard listId={list.id} open={addingCard} onOpenChange={setAddingCard} />

      {deleteOpen && (
        <DeleteListConfirm
          listId={list.id}
          listName={list.name}
          cardCount={cards.length}
          onClose={() => setDeleteOpen(false)}
          onError={(message) => toast.show({ title: 'Couldn’t delete list', message, category: 'error' })}
        />
      )}
    </div>
  );
}

function ListHeader({
  list,
  renaming,
  onStartRename,
  onStopRename,
  menuOpen,
  onMenuTrigger,
  onMenuClose,
  onAddCard,
  onDelete,
  cardCount,
  dragAttributes,
  dragListeners,
}: {
  list: BoardList;
  renaming: boolean;
  onStartRename: () => void;
  onStopRename: () => void;
  menuOpen: boolean;
  onMenuTrigger: () => void;
  onMenuClose: () => void;
  onAddCard: () => void;
  onDelete: () => void;
  cardCount: number;
  dragAttributes: DraggableAttributes | undefined;
  dragListeners: DraggableSyntheticListeners | undefined;
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
      <div className={styles.listHeader}>
        <Input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- replaces the list name only from the user's own click on it (or "Rename list" in the menu), never on page load
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
    <div className={styles.listHeader} {...dragAttributes} {...dragListeners}>
      <button type="button" className={styles.listName} onClick={onStartRename}>
        <Typography variant="h4" as="span">
          {list.name}
        </Typography>
      </button>
      <Typography variant="caption">{cardCount}</Typography>
      <span className={styles.listHeaderSpacer} />
      <span data-no-dnd>
        <Menu
          trigger={
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Options for ${list.name}`}
              onClick={onMenuTrigger}
            >
              <Icon name="ellipsis-vertical" size="sm" aria-hidden={true} />
            </Button>
          }
          open={menuOpen}
          onClose={onMenuClose}
          align="right"
          aria-label={`${list.name} options`}
          items={[
            { label: 'Add card', icon: 'plus', onSelect: onAddCard },
            { label: 'Rename list', icon: 'pencil', onSelect: onStartRename },
            { type: 'separator' },
            { label: 'Delete list', icon: 'trash-2', destructive: true, onSelect: onDelete },
          ]}
        />
      </span>
    </div>
  );
}

/** Shared with K.13's MobileListSlide — deleting a list has no web/mobile-specific behavior. */
export function DeleteListConfirm({
  listId,
  listName,
  cardCount,
  onClose,
  onError,
}: {
  listId: string;
  listName: string;
  cardCount: number;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title={`Delete "${listName}"?`}
      message={
        cardCount > 0
          ? `This deletes the list and its ${cardCount === 1 ? 'card' : `${cardCount} cards`}. This can't be undone.`
          : "This can't be undone."
      }
      destructive
      confirmLabel={pending ? 'Deleting…' : 'Delete list'}
      pending={pending}
      onConfirm={() => {
        startTransition(async () => {
          const result = await deleteList({ listId });
          if (result.ok) onClose();
          else {
            onError(result.error);
            onClose();
          }
        });
      }}
    />
  );
}

/** Static (non-interactive) rendering for `DragOverlay` — the floating copy that follows the cursor. */
export function ListDragPreview({ list, cardCount }: { list: BoardList; cardCount: number }) {
  return (
    <div className={[styles.list, styles.listDragPreview].join(' ')}>
      <div className={styles.listHeader}>
        <Typography variant="h4" as="span">
          {list.name}
        </Typography>
        <Typography variant="caption">{cardCount}</Typography>
      </div>
    </div>
  );
}
