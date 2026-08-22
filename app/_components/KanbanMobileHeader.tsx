'use client';

import Link from 'next/link';
import { MobileHeader, useIsMobile } from '@sovereignfs/ui';
import styles from '../kanban.module.css';
import { KanbanAccountMenu, type KanbanAccountMenuUser } from './KanbanAccountMenu';
import { KanbanNotificationBell } from './KanbanNotificationBell';

/**
 * Mobile counterpart to `KanbanHeader`, matching the real platform shell's
 * own mobile header shape 1:1 (`runtime/app/(platform)/layout.tsx`'s
 * `<MobileHeader logo=… bell=<NotificationBell/> avatarMenu=<AccountMenu/>>`)
 * — same `@sovereignfs/ui` component, same three-slot composition (brand,
 * bell, avatar menu), same underlying data (instance name, session user).
 * `shell: minimal` means this plugin can't reach the platform's real
 * `MobileHeader` instance (it renders nothing for this plugin at all) or its
 * real `NotificationBell`/`AccountMenu` (not part of `@sovereignfs/ui`'s
 * published surface — see `KanbanAccountMenu`'s own doc comment), so both
 * slots are filled with this plugin's own equivalents instead of the literal
 * platform components.
 *
 * `bell` is `KanbanNotificationBell` — the real platform Notification
 * Center (same `/api/account/notifications` data, real unread count, real
 * mark-read/dismiss), not a Kanban-scoped substitute. Per explicit
 * developer direction: "the header completely belongs to platform
 * functionalities; the bell icon there should open notification popup for
 * the user" — see that component's own doc comment for how it reaches the
 * real endpoint without importing the real component. This plugin's own
 * Inbox has its own separate entry point (the mobile *footer*'s "Inbox"
 * icon, with its own `hasUnseenInboxActivity` dot) — the two are
 * deliberately different concepts now, not the same thing wearing two
 * icons.
 *
 * `title` is `instanceName`, not the plugin's own name — the real platform
 * mobile header always shows the instance brand regardless of which plugin
 * is active (see `runtime/app/(platform)/layout.tsx`'s own doc comment:
 * "No `title` is set — the header always shows the instance brand"); this
 * plugin's `MobileHeader` has no title-less brand-in-logo composition of
 * its own, so `title={instanceName}` reproduces the same real-world result
 * (the instance name reads next to the badge) through the prop that exists
 * for it.
 *
 * `avatarMenu` is `KanbanAccountMenu`, shared verbatim with the desktop
 * header — same account dropdown, not a second implementation. `avatarSize="md"`
 * matches the desktop header's own trigger size exactly (`KanbanHeader.tsx`),
 * not a smaller mobile-specific size — same component, same size, same
 * styles as the other place in this plugin it's already used.
 *
 * Gated by `useIsMobile()`, not CSS — same reasoning as `KanbanMobileFooter`
 * (see its own doc comment): avoids ever measuring/publishing shell-chrome
 * height from a hidden `MobileHeader` on desktop, and this plugin's `shell:
 * minimal` tree has no `#sv-app-shell` ancestor for that publish to reach
 * anyway, so mounting it at all on desktop would be pure waste.
 */
export function KanbanMobileHeader({
  user,
  instanceName,
}: {
  user: KanbanAccountMenuUser;
  instanceName: string;
}) {
  const isMobile = useIsMobile();
  const brandInitial = instanceName.charAt(0).toUpperCase() || 'S';

  if (!isMobile) return null;

  return (
    <MobileHeader
      className={styles.mobileHeader}
      logo={
        <Link
          href="/launcher"
          className={styles.mobileHeaderLogo}
          aria-label={`${instanceName} Launcher`}
        >
          {brandInitial}
        </Link>
      }
      title={instanceName}
      bell={<KanbanNotificationBell />}
      avatarMenu={<KanbanAccountMenu user={user} avatarSize="md" />}
    />
  );
}
