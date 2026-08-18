'use client';

import { useState, useTransition } from 'react';
import { Button, Dialog, Select, SegmentedControl, Typography, useToast } from '@sovereignfs/ui';
import { moveCard } from '../actions';
import { topBottomNeighbors } from '../_lib/order';
import type { BoardData, CardDetail } from '../_lib/queries';
import styles from '../kanban.module.css';

/**
 * K.15 — the non-drag path for moving a card across lists on mobile
 * (CONCEPT.md: "Action menu only... never drag" on mobile, unlike web's
 * whole-card cross-list drag). Reachable from CardHeader's "…" menu, mobile
 * only. A native `<select>` for the target list (works with the on-screen
 * keyboard's own picker, no custom dropdown to fight) plus a top/bottom
 * `SegmentedControl` — deliberately not an arbitrary-position picker, matching
 * SPEC's own "top/bottom position choice" wording exactly.
 *
 * Reuses `moveCard` unchanged — the same action web's drag-and-drop
 * (BoardView's handleDragEnd) already calls, just with prevCardId/nextCardId
 * computed from the target list's current top/bottom card instead of a drop
 * position.
 */
export function MoveCardDialog({
  card,
  board,
  onClose,
}: {
  card: CardDetail;
  board: BoardData;
  onClose: () => void;
}) {
  const toast = useToast();
  const otherLists = board.lists.filter((l) => l.id !== card.listId);
  const [targetListId, setTargetListId] = useState<string | null>(otherLists[0]?.id ?? null);
  const [position, setPosition] = useState<'top' | 'bottom'>('top');
  const [pending, startTransition] = useTransition();

  function confirm(): void {
    if (!targetListId) return;
    const targetCards = board.cards.filter((c) => c.listId === targetListId);
    const { prevCardId, nextCardId } = topBottomNeighbors(targetCards, position);

    startTransition(async () => {
      const result = await moveCard({ cardId: card.id, toListId: targetListId, prevCardId, nextCardId });
      if (result.ok) {
        onClose();
      } else {
        toast.show({ title: 'Couldn’t move card', message: result.error, category: 'error' });
      }
    });
  }

  if (otherLists.length === 0) {
    return (
      <Dialog open onClose={onClose} size="sm" title="Move to…" aria-label="Move card">
        <div className={styles.dialogBody}>
          <Typography variant="body">This is the only list on the board.</Typography>
          <div className={styles.composerActions}>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} size="sm" title="Move to…" aria-label="Move card">
      <div className={styles.dialogBody}>
        <div className={styles.moveCardField}>
          <Typography variant="label">List</Typography>
          <Select
            aria-label="Target list"
            value={targetListId ?? ''}
            disabled={pending}
            onChange={(e) => setTargetListId(e.target.value)}
          >
            {otherLists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>

        <div className={styles.moveCardField}>
          <Typography variant="label">Position</Typography>
          <SegmentedControl
            aria-label="Position in list"
            value={position}
            onChange={(value) => setPosition(value === 'bottom' ? 'bottom' : 'top')}
            options={[
              { label: 'Top', value: 'top' },
              { label: 'Bottom', value: 'bottom' },
            ]}
          />
        </div>

        <div className={styles.composerActions}>
          <Button variant="primary" onClick={confirm} loading={pending} disabled={!targetListId}>
            Move
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
