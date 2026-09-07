'use client';

import { useEffect, useState, useTransition } from 'react';
import { Button, ConfirmDialog, Dialog, Spinner, Typography, useToast } from '@sovereignfs/ui';
import { deleteCard, listArchivedCards, restoreCard } from '../actions';
import type { ArchivedCard, BoardData } from '../_lib/queries';
import styles from '../kanban.module.css';
import { TimeAgo } from './TimeAgo';

type State =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'loaded'; cards: ArchivedCard[] };

/**
 * Board menu → "Archived cards": restore a card back to the list it came
 * from (its list/position were kept), or delete it for good. Archiving is
 * the reversible path a card takes off the board; delete stays behind a
 * confirmation and is the only way a card is actually lost.
 */
export function ArchivedCardsDialog({
  board,
  canEdit,
  onClose,
}: {
  board: BoardData;
  canEdit: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ArchivedCard | null>(null);
  const [deleting, startDelete] = useTransition();
  const listById = new Map(board.lists.map((l) => [l.id, l.name]));

  useEffect(() => {
    let cancelled = false;
    listArchivedCards({ boardId: board.id })
      .then((result) => {
        if (cancelled) return;
        setState(
          result.ok
            ? { status: 'loaded', cards: result.cards }
            : { status: 'error', error: result.error },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', error: 'Couldn’t load archived cards.' });
      });
    return () => {
      cancelled = true;
    };
  }, [board.id]);

  function removeFromList(cardId: string): void {
    setState((prev) =>
      prev.status === 'loaded'
        ? { ...prev, cards: prev.cards.filter((c) => c.id !== cardId) }
        : prev,
    );
  }

  function restore(card: ArchivedCard): void {
    setPendingId(card.id);
    void restoreCard({ cardId: card.id })
      .then((result) => {
        if (result.ok) removeFromList(card.id);
        else
          toast.show({ title: 'Couldn’t restore card', message: result.error, category: 'error' });
      })
      .finally(() => setPendingId(null));
  }

  return (
    <Dialog open onClose={onClose} size="md" title="Archived cards" aria-label="Archived cards">
      <div className={styles.dialogBody}>
        <Typography variant="h3" className={styles.dialogStickyHeader}>
          Archived cards
        </Typography>
        {state.status === 'loading' && (
          <div className={styles.centered}>
            <Spinner aria-label="Loading archived cards" />
          </div>
        )}
        {state.status === 'error' && <p className={styles.formError}>{state.error}</p>}
        {state.status === 'loaded' && state.cards.length === 0 && (
          <Typography variant="caption" className={styles.descriptionPlaceholder}>
            No archived cards. Archive a card from its detail view to park it here without deleting
            it.
          </Typography>
        )}
        {state.status === 'loaded' && state.cards.length > 0 && (
          <ul className={styles.archivedCardList}>
            {state.cards.map((card) => (
              <li key={card.id} className={styles.archivedCardRow}>
                <div className={styles.memberInfo}>
                  <Typography variant="body">{card.title}</Typography>
                  <Typography variant="caption">
                    {listById.get(card.listId) ?? 'A deleted list'} · archived{' '}
                    <TimeAgo ms={card.archivedAt} />
                  </Typography>
                </div>
                {canEdit && (
                  <div className={styles.memberRowActions}>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pendingId === card.id}
                      onClick={() => restore(card)}
                    >
                      Restore
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pendingId === card.id}
                      onClick={() => setDeleteTarget(card)}
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          open
          onClose={() => setDeleteTarget(null)}
          title={`Delete "${deleteTarget.title}"?`}
          message="This permanently deletes the card and its comments. This can't be undone."
          destructive
          confirmLabel={deleting ? 'Deleting…' : 'Delete card'}
          pending={deleting}
          onConfirm={() => {
            const target = deleteTarget;
            startDelete(async () => {
              const result = await deleteCard({ cardId: target.id });
              if (result.ok) removeFromList(target.id);
              else
                toast.show({
                  title: 'Couldn’t delete card',
                  message: result.error,
                  category: 'error',
                });
              setDeleteTarget(null);
            });
          }}
        />
      )}
    </Dialog>
  );
}
