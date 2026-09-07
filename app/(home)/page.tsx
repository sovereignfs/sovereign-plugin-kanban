import { sdk } from '@sovereignfs/sdk';
import { PageContainer, PageHeader } from '@sovereignfs/ui';
import { HomeView } from '../_components/HomeView';
import { requireUser } from '../_lib/authz';
import { getHomeDataCached } from '../_lib/request-cache';
import styles from '../kanban.module.css';

export default async function KanbanHomePage() {
  const actor = await requireUser();
  const [projects, session] = await Promise.all([
    getHomeDataCached(actor.userId, actor.tenantId),
    sdk.auth.getSession(),
  ]);
  const currentUser = { id: actor.userId, name: session?.user.name ?? null };

  return (
    <PageContainer maxWidth="lg">
      {/* Same `PageHeader` DS component the sibling Inbox page already uses
          (`(home)/inbox/page.tsx`) — this page never had one, so it read as
          a bare list with no page-level title (developer-reported). */}
      <PageHeader title="Kanban" headingLevel={1} className={styles.homePageHeader} />
      <HomeView projects={projects} currentUser={currentUser} />
    </PageContainer>
  );
}
