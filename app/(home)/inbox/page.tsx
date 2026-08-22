import { sdk } from '@sovereignfs/sdk';
import { PageContainer, PageHeader } from '@sovereignfs/ui';
import { InboxFeedList } from '../../_components/InboxFeedList';
import { InboxSeenMarker } from '../../_components/InboxSeenMarker';
import { requireUser } from '../../_lib/authz';
import { getDb } from '../../_lib/db';
import { getInboxFeed } from '../../_lib/queries';

/**
 * K.11 Inbox (redesigned) — cards assigned to the user and replies to the
 * user's own comments, not a per-board activity log (that's the card detail
 * panel's own activity section). `getInboxFeed` derives both straight from
 * `kanban_card_assignees`/`kanban_comments`, scoped by `userId`/`authorId`
 * rather than board membership, so no separate access check is needed here
 * — a card the user is assigned to but no longer has board access to would
 * be an existing edge case in the deep link itself, not something this page
 * needs to filter out upfront.
 */
export default async function InboxPage() {
  const actor = await requireUser();
  const db = await getDb();
  const feed = await getInboxFeed(db, actor);

  const session = await sdk.auth.getSession();
  const currentUser = { id: actor.userId, name: session?.user.name ?? null };

  return (
    <PageContainer maxWidth="lg">
      <InboxSeenMarker />
      <PageHeader title="Inbox" headingLevel={1} />
      <InboxFeedList feed={feed} currentUser={currentUser} />
    </PageContainer>
  );
}
