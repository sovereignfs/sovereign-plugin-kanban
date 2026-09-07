import Link from 'next/link';
import { Button, EmptyState, PageContainer } from '@sovereignfs/ui';

/**
 * The board route's own 404 — reached via `notFound()` when the board
 * doesn't exist *or* the viewer has no access to it (the two are
 * deliberately indistinguishable, see `getBoardAccess`). The platform's
 * generic 404 gave no way back into the plugin.
 */
export default function BoardNotFound() {
  return (
    <PageContainer maxWidth="md">
      <EmptyState
        icon="square-kanban"
        heading="Board not found"
        description="It may have been deleted, or you don’t have access to it. Ask a project owner to add you if you think you should."
        action={
          <Link href="/kanban">
            <Button variant="secondary">Back to boards</Button>
          </Link>
        }
      />
    </PageContainer>
  );
}
