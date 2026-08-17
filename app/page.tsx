import { PageContainer } from '@sovereignfs/ui';
import { HomeView } from './_components/HomeView';
import { requireUser } from './_lib/authz';
import { getDb } from './_lib/db';
import { getHomeData } from './_lib/queries';

export default async function KanbanHomePage() {
  const actor = await requireUser();
  const db = await getDb();
  const projects = await getHomeData(db, actor);

  return (
    <PageContainer maxWidth="lg">
      <HomeView projects={projects} />
    </PageContainer>
  );
}
