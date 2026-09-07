'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  Button,
  ConfirmDialog,
  Dialog,
  Icon,
  Menu,
  Tabs,
  Textarea,
  Typography,
  useCommitOnEnterOrBlur,
  useIsMobile,
  useOverlaySecondRow,
  useToast,
} from '@sovereignfs/ui';
import { archiveCard, deleteCard, restoreCard, updateCard } from '../actions';
import { displayName } from '../_lib/identity';
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
import { MoveCardDialog } from './MoveCardDialog';

function formatCreatedAt(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(ms));
}

/**
 * `?card=<id>` overlay — the URL-addressable contract SPEC's Routes section
 * defines. `cardDetail` is fetched server-side in `page.tsx`; this component
 * is purely presentational/interactive — no client-side fetch of its own.
 *
 * Close navigates to `closeHref` (drops the `card` query) rather than
 * `router.back()`: this is a plain same-page Dialog that must also behave
 * when `?card=` is opened as a fresh deep link with no in-app history.
 *
 * K.21 — `canEdit` false renders every field read-only: no title editing,
 * no header actions, no composers, no pickers. The card's own `archivedAt`
 * additionally locks the fields (with a Restore affordance) even for
 * members, since an archived card shouldn't be edited in place.
 */
export function CardDetailOverlay({
  board,
  cardDetail,
  currentUser,
  canEdit,
  closeHref,
}: {
  board: BoardData;
  cardDetail: CardDetail | null;
  currentUser: CurrentUser;
  canEdit: boolean;
  /** K.13 — mobile passes `${pathname}?list=<cardDetail.listId>` so closing
   *  returns to the carousel slide the card was opened from. */
  closeHref?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const cardId = searchParams.get('card');

  if (!cardId || !cardDetail) return null;

  function close(): void {
    router.push(closeHref ?? pathname);
  }

  const cardEditable = canEdit && cardDetail.archivedAt === null;

  return (
    // Keyed by card id so switching straight from one card to another (a
    // notification link while a card is already open) never carries the
    // previous card's draft title/tab/composer state across.
    <Dialog
      key={cardDetail.id}
      open
      onClose={close}
      size={isMobile ? 'lg' : 'auto'}
      title={cardDetail.title}
      aria-label={cardDetail.title}
    >
      <div className={styles.cardOverlayBody}>
        <CardHeader
          card={cardDetail}
          board={board}
          currentUser={currentUser}
          isMobile={isMobile}
          canEdit={canEdit}
          cardEditable={cardEditable}
          onClose={close}
        />
        {/* Labels/Due date/Assignees grouped into one row — three short
            metadata fields at the same visual weight as the bigger
            Description/Checklist blocks below read as one long uniform list
            otherwise; the row's shared border marks where metadata ends. */}
        <div className={styles.cardMetaRow}>
          <CardLabels
            card={cardDetail}
            boardId={board.id}
            boardLabels={board.labels}
            canEdit={cardEditable}
          />
          <CardDueDate card={cardDetail} canEdit={cardEditable} />
          <CardAssignees
            card={cardDetail}
            members={board.members}
            currentUser={currentUser}
            canEdit={cardEditable}
          />
        </div>
        <CardDescription card={cardDetail} canEdit={cardEditable} />
        <CardChecklist card={cardDetail} canEdit={cardEditable} />
        <CardCommentsActivity
          card={cardDetail}
          board={board}
          currentUser={currentUser}
          isMobile={isMobile}
          canEdit={cardEditable}
        />
      </div>
    </Dialog>
  );
}

function CardHeader({
  card,
  board,
  currentUser,
  isMobile,
  canEdit,
  cardEditable,
  onClose,
}: {
  card: CardDetail;
  board: BoardData;
  currentUser: CurrentUser;
  isMobile: boolean;
  /** Board-level edit right (member, board not archived). */
  canEdit: boolean;
  /** `canEdit` and the card itself isn't archived. */
  cardEditable: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [title, setTitle] = useState(card.title);
  // Resync when the title changes underneath (another member's rename
  // arriving through revalidation) — React's adjust-state-during-render
  // pattern, so the field never shows a stale draft.
  const [prevTitle, setPrevTitle] = useState(card.title);
  if (card.title !== prevTitle) {
    setPrevTitle(card.title);
    setTitle(card.title);
  }
  const [titlePending, startTitleTransition] = useTransition();
  const [deletePending, startDeleteTransition] = useTransition();
  const [archivePending, startArchiveTransition] = useTransition();

  const listName = board.lists.find((l) => l.id === card.listId)?.name;
  const creator = displayName(card.createdBy, currentUser, board.members);

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

  function archive(): void {
    startArchiveTransition(async () => {
      const result = await archiveCard({ cardId: card.id });
      if (result.ok) onClose();
      else toast.show({ title: 'Couldn’t archive card', message: result.error, category: 'error' });
    });
  }

  function restore(): void {
    startArchiveTransition(async () => {
      const result = await restoreCard({ cardId: card.id });
      if (!result.ok) {
        toast.show({ title: 'Couldn’t restore card', message: result.error, category: 'error' });
      }
    });
  }

  const titleHandlers = useCommitOnEnterOrBlur(commitTitle);

  return (
    // Sticky/bleed treatment is desktop-only — mobile already has its own
    // permanently-pinned title bar via `Dialog`'s mobile `OverlayHeader`.
    <div className={isMobile ? styles.cardHeaderMobile : styles.cardHeader}>
      {cardEditable ? (
        <Textarea
          className={styles.cardTitleInput}
          autoGrow
          rows={1}
          value={title}
          disabled={titlePending}
          aria-label="Card title"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setTitle(card.title);
              return;
            }
            // A title wraps for display but stays one logical line — Enter
            // commits instead of inserting a newline.
            if (e.key === 'Enter') e.preventDefault();
            titleHandlers.onKeyDown(e);
          }}
          onBlur={titleHandlers.onBlur}
        />
      ) : (
        <Typography variant="h3" as="h2" className={styles.cardTitleReadOnly}>
          {card.title}
        </Typography>
      )}
      {cardEditable && isMobile && (
        // K.15 — "Move to…" is the mobile-only, non-drag path for a
        // cross-list move; the menu also carries Archive and Delete here.
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
          items={[
            { label: 'Move to…', icon: 'external-link', onSelect: () => setMoveOpen(true) },
            { label: 'Archive card', icon: 'archive', onSelect: archive },
            { type: 'separator' },
            {
              label: 'Delete card',
              icon: 'trash-2',
              destructive: true,
              onSelect: () => setDeleteOpen(true),
            },
          ]}
        />
      )}
      {cardEditable && !isMobile && (
        // Desktop keeps direct icon buttons (developer-requested: one fewer
        // click than a menu) — Archive is the reversible default, Delete
        // stays right beside it behind its confirmation.
        <div className={styles.cardHeaderActions}>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Archive card"
            title="Archive card"
            disabled={archivePending}
            onClick={archive}
          >
            <Icon name="archive" size="sm" aria-hidden={true} />
          </Button>
          <Button
            className={styles.cardHeaderDeleteButton}
            variant="ghost"
            size="sm"
            aria-label="Delete card"
            title="Delete card"
            onClick={() => setDeleteOpen(true)}
          >
            <Icon name="trash-2" size="sm" aria-hidden={true} />
          </Button>
        </div>
      )}

      {/* Where the card lives and where it came from — Trello's "in list X"
          line, plus the creator/date that were fetched but never shown. */}
      <Typography variant="caption" className={styles.cardSubtitle}>
        {listName ? `In "${listName}"` : 'In a deleted list'} · created by {creator} on{' '}
        {formatCreatedAt(card.createdAt)}
      </Typography>

      {card.archivedAt !== null && (
        <div className={styles.readOnlyBanner} role="status">
          <Icon name="archive" size="sm" aria-hidden={true} />
          <Typography variant="caption">This card is archived.</Typography>
          {canEdit && (
            <Button variant="secondary" size="sm" onClick={restore} loading={archivePending}>
              Restore
            </Button>
          )}
        </div>
      )}

      {deleteOpen && (
        <ConfirmDialog
          open
          onClose={() => setDeleteOpen(false)}
          title={`Delete "${card.title}"?`}
          message="This can't be undone. Archive it instead if you might need it later."
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
                toast.show({
                  title: 'Couldn’t delete card',
                  message: result.error,
                  category: 'error',
                });
                setDeleteOpen(false);
              }
            });
          }}
        />
      )}

      {moveOpen && <MoveCardDialog card={card} board={board} onClose={() => setMoveOpen(false)} />}
    </div>
  );
}

/**
 * Comments and Activity switch via tabs on both surfaces. On mobile the tab
 * strip is handed up to the Dialog's own `OverlayHeader` second row so it
 * stays pinned above the scrolling content; desktop renders it inline.
 *
 * Both sections stay mounted at all times (toggled via a CSS class, not
 * conditional rendering) so an in-progress comment draft survives a switch
 * to Activity and back.
 */
function CardCommentsActivity({
  card,
  board,
  currentUser,
  isMobile,
  canEdit,
}: {
  card: CardDetail;
  board: BoardData;
  currentUser: CurrentUser;
  isMobile: boolean;
  canEdit: boolean;
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
      {!isMobile && tabStrip}
      <div className={styles.cardTabPanels}>
        <div className={activeTab !== 'comments' ? styles.tabPanelHidden : undefined}>
          <CardComments
            card={card}
            members={board.members}
            currentUser={currentUser}
            canEdit={canEdit}
            canModerate={board.role === 'owner'}
          />
        </div>
        <div className={activeTab !== 'activity' ? styles.tabPanelHidden : undefined}>
          <CardActivity card={card} board={board} currentUser={currentUser} />
        </div>
      </div>
    </>
  );
}
