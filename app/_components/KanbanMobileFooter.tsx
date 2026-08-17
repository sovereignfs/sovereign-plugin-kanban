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

  const isBoards = pathname === '/kanban' || pathname.startsWith('/kanban/boards');
  const isInbox = pathname.startsWith('/kanban/inbox');

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
        leftIcons={[
          {
            icon: <Icon name="grid-2x2" size="md" aria-hidden />,
            label: 'Boards',
            active: isBoards,
            onClick: () => router.push('/kanban'),
          },
        ]}
        rightIcons={[
          {
            icon: (
              <span className={styles.mobileFooterIconWrap}>
                <Icon name="bell" size="md" aria-hidden />
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
        items={apps.map((app) => ({
          key: app.id,
          label: app.name,
          icon: app.iconUrl ? (
            <img src={app.iconUrl} alt="" className={styles.mobileFooterAppIcon} />
          ) : (
            <Icon name="grid-2x2" size="lg" aria-hidden />
          ),
          onClick: () => {
            setAppsOpen(false);
            router.push(app.routePrefix);
          },
        }))}
      />
    </div>
  );
}
