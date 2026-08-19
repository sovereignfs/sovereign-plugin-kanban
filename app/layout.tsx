import type { ReactNode } from 'react';
import { sdk } from '@sovereignfs/sdk';
import { KanbanHeader } from './_components/KanbanHeader';
import { KanbanMobileFooter, type MobileAppEntry } from './_components/KanbanMobileFooter';
import { requireUser } from './_lib/authz';
import { getDb } from './_lib/db';
import { hasUnseenInboxActivity } from './_lib/queries';
import styles from './kanban.module.css';

/**
 * Plugin shell for every page: a top header (web) + a self-rendered mobile
 * footer (K.12, `shellConfig.mobileFooter: false` in the pre-minimal-shell
 * manifest — now implicit under `shell: minimal`, which gives no chrome at
 * all). Pages own their PageContainer, this layout adds no gutter of its
 * own.
 *
 * The secondary sidebar (Boards/Inbox nav) is deliberately NOT rendered
 * here — it's scoped to the Home/Inbox routes only via their own
 * `(home)/layout.tsx`, so Board View gets the header but no sidebar.
 *
 * The header keeps a pure-CSS `@media` hide-on-mobile (matching the
 * sidebar's own prior convention) rather than `useIsMobile`: zero
 * hydration-flash risk, and mobile has no header yet (footer-only chrome
 * stays as-is for now). `useIsMobile` (inside `KanbanMobileFooter`) is used
 * for the *footer* specifically, since unlike a pure CSS hide it avoids
 * ever measuring/publishing shell-chrome height from `MobileFooter` on
 * desktop at all. `<ResponsiveSurface>` itself can't be used directly here
 * — it has no `'use client'` of its own (by design; every real consumer in
 * this repo renders it from inside an already-client component, never
 * straight from a Server Component's JSX), so `KanbanMobileFooter` decides
 * internally via `useIsMobile` instead of this layout wrapping it.
 *
 * K.11: the mobile footer's Inbox unseen badge is computed here — a layout
 * runs on every navigation within the plugin, not just visits to
 * `/kanban/inbox` — so it stays current without the client component
 * needing its own fetch. The sidebar's own copy of this same badge is
 * fetched independently by `(home)/layout.tsx` (cheap query, avoids
 * threading data across sibling layouts).
 */
export default async function KanbanLayout({ children }: { children: ReactNode }) {
  const actor = await requireUser();
  const db = await getDb();
  const [hasUnseenInbox, availablePlugins, session, instanceName] = await Promise.all([
    hasUnseenInboxActivity(db, actor),
    sdk.plugins.list(),
    sdk.auth.getSession(),
    // Best-effort: the header's brand badge is a cosmetic detail, not core
    // functionality, so a platform-config read failure (e.g. an
    // unseeded/legacy `instance_id` setting row on an older instance)
    // shouldn't take down the whole plugin — fall back to a sensible
    // default name instead of letting the layout throw.
    sdk.platform
      .getConfig()
      .then((config) => config.instanceName)
      .catch(() => 'Sovereign'),
  ]);

  // Plain serializable data across the client boundary — never JSX (see
  // KanbanMobileFooter's own doc comment for why the drawer is built
  // client-side from this instead).
  const apps: MobileAppEntry[] = availablePlugins
    .filter((p) => p.availableToUser)
    .map((p) => ({
      id: p.id,
      name: p.name,
      routePrefix: p.routePrefix,
      iconUrl: p.icon ? `/plugin-icons/${p.id}.svg` : undefined,
    }));

  return (
    <div className={styles.shell}>
      <KanbanHeader
        user={{
          name: session?.user.name ?? null,
          email: session?.user.email ?? '',
          image: session?.user.image ?? null,
        }}
        instanceName={instanceName}
      />
      <div className={styles.body}>{children}</div>
      <KanbanMobileFooter apps={apps} hasUnseenInbox={hasUnseenInbox} />
    </div>
  );
}
