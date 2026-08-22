'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Icon, MobileAppsDrawer, MobileFooter, useIsMobile } from '@sovereignfs/ui';
import styles from '../kanban.module.css';

export interface MobileAppEntry {
  id: string;
  name: string;
  routePrefix: string;
  iconUrl?: string;
}

const LAUNCHER_PLUGIN_ID = 'fs.sovereign.launcher';

/**
 * K.12 mobile shell — Boards (left), Inbox (right, with the same unseen dot
 * the desktop sidebar shows), and an "untouched" Apps launcher (center):
 * untouched means it opens the *real* installed-plugins drawer, not a
 * kanban-scoped substitute. A self-rendered footer (`shellConfig.mobileFooter:
 * false`) replaces the platform's own `MobileNav` — including its Drawer —
 * entirely on this plugin's routes, so there's no shared platform drawer
 * instance left to hook into; `sdk.plugins.list()` (server-fetched in
 * `layout.tsx`, passed down as plain data — never JSX — across the
 * client-boundary) is the supported way to reconstruct the same real list a
 * self-rendering plugin can still show.
 *
 * A plain `onClick`+`router.push` (not `FooterIcon`'s `href`, a bare `<a>`)
 * preserves client-side navigation — same reasoning as the platform's own
 * `MobileNav`.
 *
 * `launcherIcon` (the center button's own icon) is the real Launcher
 * plugin's icon, matching the platform's own `MobileNav`
 * (`launcherIconUrl ? <img .../> : undefined`) — `apps` (from
 * `sdk.plugins.list()`) includes the Launcher plugin as an ordinary entry
 * since the SDK's plugin-discovery path has no chrome-plugin concept (unlike
 * the platform shell's own `selectSidebarPlugins`/`CHROME_PLUGIN_IDS`,
 * `runtime/src`-only and unreachable from here), so it's pulled out of the
 * list here rather than showing up as a redundant "Launcher" tile in the
 * grid below. In its place, a dedicated "Home" tile is prepended to the
 * drawer grid — the platform's own convention puts "Home" in the footer's
 * `leftIcons` instead, but that slot is already "Boards" here (Kanban has
 * no other use for a footer-level Home affordance), so the drawer's first
 * tile is this plugin's equivalent.
 */
export function KanbanMobileFooter({
  apps,
  hasUnseenInbox,
}: {
  apps: MobileAppEntry[];
  hasUnseenInbox: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [appsOpen, setAppsOpen] = useState(false);
  const isMobile = useIsMobile();

  const isBoards = pathname === '/kanban' || pathname.startsWith('/kanban/b');
  const isInbox = pathname.startsWith('/kanban/inbox');

  const launcherApp = apps.find((app) => app.id === LAUNCHER_PLUGIN_ID);
  const drawerApps = apps.filter((app) => app.id !== LAUNCHER_PLUGIN_ID);

  // `useIsMobile` defaults to `false` until the client mounts and reads the
  // real viewport (SSR-safe-not-flash-free, see layout.tsx's own comment) —
  // called after every other hook above so hook order never changes across
  // renders, then bailing out here rather than wrapping the whole component
  // body in a condition.
  if (!isMobile) return null;

  return (
    // `MobileFooter` positions itself with `position: relative` — it's
    // designed for a consumer-owned fixed wrapper (the platform's own
    // MobileNav gets this from the shell's grid; kanban's `.shell` is a
    // plain flex row, so without this wrapper the footer became a third
    // flex item competing with `.main` for horizontal space instead of
    // overlaying the viewport bottom, crushing the actual page content —
    // a real bug caught live, not by any check that renders in isolation).
    <div className={styles.mobileFooterFixed}>
      <MobileFooter
        onOpenApps={() => setAppsOpen(true)}
        launcherOpen={appsOpen}
        launcherIcon={
          launcherApp?.iconUrl ? (
            <img src={launcherApp.iconUrl} alt="" className={styles.mobileFooterLauncherIcon} />
          ) : undefined
        }
        leftIcons={[
          {
            icon: <Icon name="layout-dashboard" size="md" aria-hidden />,
            label: 'Boards',
            active: isBoards,
            onClick: () => router.push('/kanban'),
          },
        ]}
        rightIcons={[
          {
            icon: (
              <span className={styles.mobileFooterIconWrap}>
                <Icon name="inbox" size="md" aria-hidden />
                {hasUnseenInbox && <span className={styles.mobileFooterUnseenBadge} aria-hidden />}
              </span>
            ),
            label: 'Inbox',
            active: isInbox,
            onClick: () => router.push('/kanban/inbox'),
          },
        ]}
      />

      <MobileAppsDrawer
        open={appsOpen}
        onClose={() => setAppsOpen(false)}
        aria-label="Apps"
        items={[
          {
            key: 'home',
            label: 'Home',
            icon: <Icon name="house" size="lg" aria-hidden />,
            onClick: () => {
              setAppsOpen(false);
              router.push('/launcher');
            },
          },
          ...drawerApps.map((app) => ({
            key: app.id,
            label: app.name,
            icon: app.iconUrl ? (
              <img src={app.iconUrl} alt="" className={styles.mobileFooterDrawerIcon} />
            ) : (
              <Icon name="grid-2x2" size="lg" aria-hidden />
            ),
            onClick: () => {
              setAppsOpen(false);
              router.push(app.routePrefix);
            },
          })),
        ]}
      />
    </div>
  );
}
