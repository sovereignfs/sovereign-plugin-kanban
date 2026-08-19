import { sdk } from '@sovereignfs/sdk';
import { PageContainer, PageHeader } from '@sovereignfs/ui';
import { InboxFeedList } from '../../_components/InboxFeedList';
import { InboxSeenMarker } from '../../_components/InboxSeenMarker';
import { requireUser } from '../../_lib/authz';
import { getDb } from '../../_lib/db';
import { getInboxFeed } from '../../_lib/queries';

/**
 * K.11 Inbox — activity across every board the user belongs to
 * (`getInboxFeed` scopes by membership the same way `getBoardData` does, so
 * a board the user has since left simply stops contributing rows; nothing
 * card/board-specific here needs its own access check beyond that).
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
