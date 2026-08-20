import { sdk } from '@sovereignfs/sdk';
import { PageContainer } from '@sovereignfs/ui';
import { HomeView } from '../_components/HomeView';
import { requireUser } from '../_lib/authz';
import { getDb } from '../_lib/db';
import { getHomeData } from '../_lib/queries';

export default async function KanbanHomePage() {
  const actor = await requireUser();
  const db = await getDb();
  const [projects, session] = await Promise.all([getHomeData(db, actor), sdk.auth.getSession()]);
  const currentUser = { id: actor.userId, name: session?.user.name ?? null };

  return (
    <PageContainer maxWidth="lg">
      <HomeView projects={projects} currentUser={currentUser} />
    </PageContainer>
  );
}
