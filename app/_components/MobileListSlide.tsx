'use client';

import { useState, useTransition, type KeyboardEvent } from 'react';
import Link from 'next/link';
import {
  Button,
  Icon,
  Input,
  Menu,
  SwipableMobileCarouselSlideBody,
  SwipableMobileCarouselSlideFooter,
  SwipableMobileCarouselSlideHeader,
  Typography,
  useCommitOnEnterOrBlur,
  useToast,
} from '@sovereignfs/ui';
import { renameList } from '../actions';
import type { BoardCardSummary, BoardList } from '../_lib/queries';
import styles from '../kanban.module.css';
import { CardTileBody } from './CardTile';
import { DeleteListConfirm } from './ListColumn';
import { QuickAddCard } from './QuickAddCard';

/**
 * One carousel slide's contents (K.13) — the mobile equivalent of
 * ListColumn, but with no dnd-kit: card reorder/list reorder aren't part of
 * this task (K.15 owns mobile card reorder; list reorder isn't in Phase 1
 * mobile scope at all — see SPEC.md's K.13 status entry). Card tiles are
 * plain `<Link>`s reusing CardTile's exported CardTileBody, not CardTile
 * itself, since CardTile's `useSortable` call requires a DndContext ancestor
 * this carousel doesn't have.
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

  return (
    <>
      <SwipableMobileCarouselSlideHeader>
        <MobileListHeader
          list={list}
          renaming={renaming}
          onStartRename={() => setRenaming(true)}
          onStopRename={() => setRenaming(false)}
          menuOpen={menuOpen}
          onMenuTrigger={() => setMenuOpen((v) => !v)}
          onMenuClose={() => setMenuOpen(false)}
          onAddCard={() => setAddingCard(true)}
          onDelete={() => setDeleteOpen(true)}
          cardCount={cards.length}
        />
      </SwipableMobileCarouselSlideHeader>

      <SwipableMobileCarouselSlideBody>
        <div className={styles.mobileListCards}>
          {cards.length === 0 && (
            <Typography variant="caption" className={styles.descriptionPlaceholder}>
              No cards yet
            </Typography>
          )}
          {cards.map((card) => (
            <Link
              key={card.id}
              href={cardHrefFor(card.id)}
              scroll={false}
              className={styles.cardTile}
            >
              <CardTileBody card={card} />
            </Link>
          ))}
        </div>
      </SwipableMobileCarouselSlideBody>

      <SwipableMobileCarouselSlideFooter>
        <QuickAddCard listId={list.id} open={addingCard} onOpenChange={setAddingCard} />
      </SwipableMobileCarouselSlideFooter>

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
  onAddCard,
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
  onAddCard: () => void;
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
          // eslint-disable-next-line jsx-a11y/no-autofocus -- replaces the list name only from the user's own tap on it (or "Rename list" in the menu), never on mount
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
    </div>
  );
}
