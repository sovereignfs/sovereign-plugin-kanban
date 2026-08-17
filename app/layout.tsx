import type { ReactNode } from 'react';
import { sdk } from '@sovereignfs/sdk';
import { KanbanMobileFooter, type MobileAppEntry } from './_components/KanbanMobileFooter';
import { KanbanSidebar } from './_components/KanbanSidebar';
import { requireUser } from './_lib/authz';
import { getDb } from './_lib/db';
import { hasUnseenInboxActivity } from './_lib/queries';
import styles from './kanban.module.css';

/**
 * Plugin shell: secondary sidebar (web) + a self-rendered mobile footer
 * (K.12, `shellConfig.mobileFooter: false`) — never both. Pages own their
 * PageContainer, this layout adds no gutter of its own.
 *
 * The sidebar keeps its original pure-CSS `@media` hide-on-mobile (no
 * change here) rather than moving to `useIsMobile` too: it already has zero
 * hydration-flash risk (the stylesheet applies before any JS runs), and
 * `useIsMobile`/`ResponsiveSurface` default to the *web* value until the
 * client mounts (documented, SSR-safe-not-flash-free behavior) — switching
 * the already-flash-free sidebar to that mechanism would be a regression
 * for no benefit. `useIsMobile` (inside `KanbanMobileFooter`, per SPEC's
 * named mechanism) is used for the *footer* specifically, since unlike a
 * pure CSS hide it avoids ever measuring/publishing shell-chrome height
 * from `MobileFooter` on desktop at all. `<ResponsiveSurface>` itself can't
 * be used directly here — it has no `'use client'` of its own (by design;
 * every real consumer in this repo renders it from inside an
 * already-client component, never straight from a Server Component's JSX),
 * so `KanbanMobileFooter` decides internally via `useIsMobile` instead of
 * this layout wrapping it in `<ResponsiveSurface>`.
 *
 * K.11: the sidebar's Inbox unseen badge (also read by the mobile footer)
 * is computed here — a layout runs on every navigation within the plugin,
 * not just visits to `/kanban/inbox` — so it stays current without either
 * client component needing its own fetch.
 */
export default async function KanbanLayout({ children }: { children: ReactNode }) {
  const actor = await requireUser();
  const db = await getDb();
  const [hasUnseenInbox, availablePlugins] = await Promise.all([
    hasUnseenInboxActivity(db, actor),
    sdk.plugins.list(),
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
      <KanbanSidebar hasUnseenInbox={hasUnseenInbox} />
      <div className={styles.main}>{children}</div>
      <KanbanMobileFooter apps={apps} hasUnseenInbox={hasUnseenInbox} />
    </div>
  );
}
