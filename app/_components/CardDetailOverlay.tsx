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
import { MoveCardDialog } from './MoveCardDialog';

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

  function close(): void {
    router.push(closeHref ?? pathname);
  }

  return (
    <Dialog
      open
      onClose={close}
      size={isMobile ? 'full' : 'xl'}
      title={cardDetail.title}
      aria-label={cardDetail.title}
    >
      <div className={styles.cardOverlayBody}>
        <CardHeader card={cardDetail} board={board} isMobile={isMobile} onClose={close} />
        {/* Labels/Due date/Assignees grouped into one row (developer-requested
            retouch) — three short metadata fields each got their own
            full-width stacked section before, all at the same visual
            weight as the much bigger Description/Checklist blocks below
            them, reading as a long uniform list with no sense of grouping.
            A shared border-bottom also marks where "card metadata" ends
            and "card content" begins — there wasn't a visual break there
            before either. */}
        <div className={styles.cardMetaRow}>
          <CardLabels card={cardDetail} boardId={board.id} boardLabels={board.labels} />
          <CardDueDate card={cardDetail} />
          <CardAssignees card={cardDetail} members={board.members} currentUser={currentUser} />
        </div>
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
  board,
  isMobile,
  onClose,
}: {
  card: CardDetail;
  board: BoardData;
  isMobile: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
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
    // Sticky/bleed treatment is desktop-only (`.cardHeader` vs. the plain
    // `.cardHeaderMobile`) — mobile already has its own permanently-pinned
    // title bar via `Dialog`'s own mobile `OverlayHeader` (`title` prop,
    // fed above), so sticking *this* in-body header too would duplicate
    // it, and unlike on desktop that duplicate would now stay on screen
    // continuously while scrolling instead of scrolling away once (caught
    // live testing at a real 375px viewport before shipping this, not by
    // report). Mobile also never had `Dialog`'s floating `.close` button
    // to begin with (mobile hides it in favor of `OverlayHeader`'s own
    // close affordance — `Dialog.module.css`'s mobile media query), so
    // none of this header's close-button-clearance styling applies there
    // either.
    <div className={isMobile ? styles.cardHeaderMobile : styles.cardHeader}>
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
          // commits (matching the old single-line `Input`'s behavior)
          // instead of inserting a newline, which a plain `<textarea>`
          // would otherwise do by default.
          if (e.key === 'Enter') e.preventDefault();
          titleHandlers.onKeyDown(e);
        }}
        onBlur={titleHandlers.onBlur}
      />
      {isMobile ? (
        // K.15 — "Move to…" is the mobile-only, non-drag path for a
        // cross-list move (CONCEPT.md: "Action menu only... never drag" on
        // mobile, vs. web's whole-card drag, K.7) — the menu earns its
        // keep here since it holds two real items. Desktop's own menu
        // never had a second item to justify one at all (web already has
        // drag for the list move, so "Move to…" is deliberately absent
        // there) — replaced with a direct delete button below, developer-
        // requested: one fewer click, and one fewer disconnected-looking
        // trigger competing with the close button in the same corner.
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
            { label: 'Delete card', icon: 'trash-2', destructive: true, onSelect: () => setDeleteOpen(true) },
          ]}
        />
      ) : (
        <Button
          className={styles.cardHeaderDeleteButton}
          variant="ghost"
          size="sm"
          aria-label="Delete card"
          onClick={() => setDeleteOpen(true)}
        >
          <Icon name="trash-2" size="sm" aria-hidden={true} />
        </Button>
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

      {moveOpen && <MoveCardDialog card={card} board={board} onClose={() => setMoveOpen(false)} />}
    </div>
  );
}

/**
 * K.14 (mobile) + developer-requested desktop follow-up: Comments and
 * Activity switch via tabs on both surfaces now, not just mobile — the two
 * sections stacked together on desktop read as one long, low-signal scroll
 * (nothing marks where Comments ends and Activity begins beyond a section
 * label), and most of a card's activity log is redundant with what its
 * comments already say. On mobile the tab strip is still handed up to the
 * Dialog's own `OverlayHeader` second row (`useOverlaySecondRow`, the same
 * mechanism Account/Console use for their own tab strips) so it stays
 * pinned above the scrolling content instead of scrolling away with it —
 * desktop has no such header row to hand it to, so it renders inline here
 * instead, as an ordinary (non-sticky) first element.
 *
 * Both sections stay mounted at all times on *both* surfaces (toggled via a
 * CSS class, not conditional rendering) — unmounting the inactive one on
 * every switch would discard an in-progress, not-yet-submitted comment
 * draft the moment someone clicks over to Activity and back, undercutting
 * the "editing efficiency" this modal is supposed to prioritize
 * (CONCEPT.md) on either surface, not just mobile.
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
      {!isMobile && tabStrip}
      {/* `.cardTabPanels`' own `min-height` (developer-requested) keeps the
          dialog from visibly resizing every time the active tab switches —
          Comments and Activity rarely have the same amount of content
          (e.g. "No comments yet" vs. four real activity log lines), and
          since the dialog's own height is content-driven up to its size
          cap (`Dialog.module.css`'s own file comment), swapping between a
          short panel and a longer one shifted the whole panel's height on
          every click. Doesn't make the dialog truly fixed-height — content
          taller than the reserved minimum still grows it, matching the
          `sm`/`md`/`xl` "grows to fit, capped rather than fixed" behavior
          everywhere else in this dialog — just stops the *common* short-
          content case from visibly jumping. */}
      <div className={styles.cardTabPanels}>
        <div className={activeTab !== 'comments' ? styles.tabPanelHidden : undefined}>
          <CardComments card={card} members={board.members} currentUser={currentUser} />
        </div>
        <div className={activeTab !== 'activity' ? styles.tabPanelHidden : undefined}>
          <CardActivity card={card} board={board} currentUser={currentUser} />
        </div>
      </div>
    </>
  );
}
