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
  Tabs,
  Typography,
  useCommitOnEnterOrBlur,
  useIsMobile,
  useOverlaySecondRow,
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
  const isMobile = useIsMobile();
  const cardId = searchParams.get('card');

  if (!cardId || !cardDetail) return null;

  const list = board.lists.find((l) => l.id === cardDetail.listId);

  function close(): void {
    router.push(closeHref ?? pathname);
  }

  return (
    <Dialog
      open
      onClose={close}
      size={isMobile ? 'full' : 'lg'}
      title={cardDetail.title}
      aria-label={cardDetail.title}
    >
      <div className={styles.cardOverlayBody}>
        <CardHeader card={cardDetail} listName={list?.name} onClose={close} />
        <CardLabels card={cardDetail} boardId={board.id} boardLabels={board.labels} />
        <CardDueDate card={cardDetail} />
        <CardAssignees card={cardDetail} members={board.members} currentUser={currentUser} />
        <CardDescription card={cardDetail} />
        <CardChecklist card={cardDetail} />
        <CardCommentsActivity
          card={cardDetail}
          board={board}
          currentUser={currentUser}
          isMobile={isMobile}
        />
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

/**
 * K.14 — mobile readability: Comments and Activity switch via tabs instead
 * of two always-stacked sections. The tab strip itself is handed up to the
 * Dialog's mobile `OverlayHeader` second row (`useOverlaySecondRow`, the
 * same mechanism Account/Console use for their own tab strips) rather than
 * rendered inline here, so it stays pinned above the scrolling content
 * instead of scrolling away with it.
 *
 * Both sections stay mounted at all times on mobile (toggled via a CSS
 * class, not conditional rendering) — unmounting the inactive one on every
 * switch would discard an in-progress, not-yet-submitted comment draft the
 * moment someone taps over to Activity and back, undercutting the "editing
 * efficiency" mobile card detail is supposed to prioritize (CONCEPT.md).
 *
 * Desktop is completely unchanged: both sections render stacked, exactly as
 * K.6/K.8 originally built them, matching CONCEPT.md's web row (`modal
 * dialog with all card fields plus dedicated Comments & Replies and
 * Activity sections`).
 */
function CardCommentsActivity({
  card,
  board,
  currentUser,
  isMobile,
}: {
  card: CardDetail;
  board: BoardData;
  currentUser: CurrentUser;
  isMobile: boolean;
}) {
  const [activeTab, setActiveTab] = useState<'comments' | 'activity'>('comments');

  const tabStrip = (
    <Tabs
      items={[
        { label: 'Comments', value: 'comments' },
        { label: 'Activity', value: 'activity' },
      ]}
      value={activeTab}
      onChange={(value) => setActiveTab(value === 'activity' ? 'activity' : 'comments')}
      aria-label="Card detail sections"
    />
  );
  useOverlaySecondRow(isMobile ? tabStrip : null);

  return (
    <>
      <div className={isMobile && activeTab !== 'comments' ? styles.tabPanelHidden : undefined}>
        <CardComments card={card} members={board.members} currentUser={currentUser} />
      </div>
      <div className={isMobile && activeTab !== 'activity' ? styles.tabPanelHidden : undefined}>
        <CardActivity card={card} board={board} currentUser={currentUser} />
      </div>
    </>
  );
}
