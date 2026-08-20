import { notFound } from 'next/navigation';
import { sdk } from '@sovereignfs/sdk';
import { PageContainer } from '@sovereignfs/ui';
import { BoardView } from '../../_components/BoardView';
import { requireUser } from '../../_lib/authz';
import { getDb } from '../../_lib/db';
import { resolveBoardColor } from '../../_lib/palette';
import { getBoardData, getCardDetail } from '../../_lib/queries';

/**
 * Board route. Membership is enforced by getBoardData itself — a
 * non-member gets the authenticated 404, never a confirmation the board
 * exists.
 *
 * The `?card=<id>` overlay's data is fetched here too, not client-side: a
 * `<Link href="?card=…">` navigation re-invokes this Server Component (a
 * fresh RSC fetch) even without a full page reload, so there's no need for
 * a separate "fetch on open" server action or client loading state — same
 * server-first shape as the rest of the board payload. An unknown or
 * inaccessible id just means the overlay doesn't render (see
 * CardDetailOverlay) — never a 404, since the board itself is still valid.
 */
export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ boardId: string }>;
  searchParams: Promise<{ card?: string }>;
}) {
  const { boardId } = await params;
  const { card: cardId } = await searchParams;
  const actor = await requireUser();
  const db = await getDb();
  const board = await getBoardData(db, boardId, actor);
  if (!board) notFound();

  const session = await sdk.auth.getSession();
  const currentUser = { id: actor.userId, name: session?.user.name ?? null };

  const cardDetail = cardId ? await getCardDetail(db, cardId, actor) : null;
  const resolvedColor = resolveBoardColor(board.color);

  return (
    <>
      {/* Sets --kanban-board-color, read only by kanban.module.css's `.body`
          (the canvas behind the list columns) — both headers stay a plain
          neutral surface regardless of board color; the color is only ever
          a background for the lists area. Set globally via :root regardless
          of where this <style> tag physically sits in the DOM — no client
          JS/flash-of-neutral needed, and it's automatically removed (every
          property reverts to its fallback) when navigating away from this
          page, since React unmounts it along with the rest of this page's
          output. Board colors are a fixed, curated palette (never
          user-authored text), so this interpolation is safe. Deliberately
          the literal board hex, not a semantic token — this canvas color
          stays constant across light/dark theme; only card/list surfaces
          sitting on top of it adapt. */}
      {resolvedColor && (
        <style>{`:root {
          --kanban-board-color: ${resolvedColor.value};
        }`}</style>
      )}
      <PageContainer maxWidth="full">
        <BoardView board={board} cardDetail={cardDetail} currentUser={currentUser} />
      </PageContainer>
    </>
  );
}
