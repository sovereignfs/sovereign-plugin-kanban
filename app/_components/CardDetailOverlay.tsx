'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Button,
  ConfirmDialog,
  Dialog,
  Icon,
  Input,
  Menu,
  Typography,
  useCommitOnEnterOrBlur,
  useToast,
} from '@sovereignfs/ui';
import { deleteCard, updateCard } from '../actions';
import type { BoardData, CardDetail } from '../_lib/queries';
import styles from '../kanban.module.css';
import { CardActivity } from './CardActivity';
import { CardAssignees } from './CardAssignees';
import type { CurrentUser } from './BoardView';
import { CardChecklist } from './CardChecklist';
import { CardComments } from './CardComments';
import { CardDescription } from './CardDescription';
import { CardDueDate } from './CardDueDate';
import { CardLabels } from './CardLabels';

/**
 * `?card=<id>` overlay — the URL-addressable contract SPEC's Routes section
 * defines (built in K.5, unchanged here). `cardDetail` is fetched
 * server-side in `page.tsx`; this component is purely presentational/
 * interactive — no client-side fetch of its own.
 *
 * Close navigates to `closeHref` (drops the `card` query, defaulting to the
 * bare board URL) rather than `router.back()`: unlike the platform's own
 * `@modal` overlay-shell mechanism (docs/architecture-rules.md), this is a
 * plain same-page Dialog that must also behave correctly when `?card=` is
 * opened as a fresh deep link with no in-app history to unwind — back()
 * would leave the plugin entirely in that case.
 */
export function CardDetailOverlay({
  board,
  cardDetail,
  currentUser,
  closeHref,
}: {
  board: BoardData;
  cardDetail: CardDetail | null;
  currentUser: CurrentUser;
  /** K.13 — mobile passes `${pathname}?list=<cardDetail.listId>` so closing
   *  returns to the carousel slide the card was opened from, instead of
   *  resetting to the first list. Omit for the original bare-`pathname`
   *  behavior (web, and mobile with no card open). */
  closeHref?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const cardId = searchParams.get('card');

  if (!cardId || !cardDetail) return null;

  const list = board.lists.find((l) => l.id === cardDetail.listId);

  function close(): void {
    router.push(closeHref ?? pathname);
  }

  return (
    <Dialog open onClose={close} size="lg" title={cardDetail.title} aria-label={cardDetail.title}>
      <div className={styles.cardOverlayBody}>
        <CardHeader card={cardDetail} listName={list?.name} onClose={close} />
        <CardLabels card={cardDetail} boardId={board.id} boardLabels={board.labels} />
        <CardDueDate card={cardDetail} />
        <CardAssignees card={cardDetail} members={board.members} currentUser={currentUser} />
        <CardDescription card={cardDetail} />
        <CardChecklist card={cardDetail} />
        <CardComments card={cardDetail} members={board.members} currentUser={currentUser} />
        <CardActivity card={cardDetail} board={board} currentUser={currentUser} />
      </div>
    </Dialog>
  );
}

function CardHeader({
  card,
  listName,
  onClose,
}: {
  card: CardDetail;
  listName: string | undefined;
  onClose: () => void;
}) {
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [title, setTitle] = useState(card.title);
  const [titlePending, startTitleTransition] = useTransition();
  const [deletePending, startDeleteTransition] = useTransition();

  function commitTitle(): void {
    const trimmed = title.trim();
    if (!trimmed || trimmed === card.title) {
      setTitle(card.title);
      return;
    }
    startTitleTransition(async () => {
      const result = await updateCard({ cardId: card.id, title: trimmed });
      if (!result.ok) {
        setTitle(card.title);
        toast.show({ title: 'Couldn’t rename card', message: result.error, category: 'error' });
      }
    });
  }

  const titleHandlers = useCommitOnEnterOrBlur(commitTitle);

  return (
    <div className={styles.cardHeader}>
      <Input
        className={styles.cardTitleInput}
        value={title}
        disabled={titlePending}
        aria-label="Card title"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setTitle(card.title);
          else titleHandlers.onKeyDown(e);
        }}
        onBlur={titleHandlers.onBlur}
      />
      <Menu
        trigger={
          <Button
            variant="ghost"
            size="sm"
            aria-label="Card options"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Icon name="ellipsis-vertical" size="sm" aria-hidden={true} />
          </Button>
        }
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        align="right"
        aria-label="Card options"
        items={[{ label: 'Delete card', icon: 'trash-2', destructive: true, onSelect: () => setDeleteOpen(true) }]}
      />
      {listName && (
        <Typography variant="caption" className={styles.cardBreadcrumb}>
          in {listName}
        </Typography>
      )}

      {deleteOpen && (
        <ConfirmDialog
          open
          onClose={() => setDeleteOpen(false)}
          title={`Delete "${card.title}"?`}
          message="This can't be undone."
          destructive
          confirmLabel={deletePending ? 'Deleting…' : 'Delete card'}
          pending={deletePending}
          onConfirm={() => {
            startDeleteTransition(async () => {
              const result = await deleteCard({ cardId: card.id });
              if (result.ok) {
                setDeleteOpen(false);
                onClose();
              } else {
                toast.show({ title: 'Couldn’t delete card', message: result.error, category: 'error' });
                setDeleteOpen(false);
              }
            });
          }}
        />
      )}
    </div>
  );
}
