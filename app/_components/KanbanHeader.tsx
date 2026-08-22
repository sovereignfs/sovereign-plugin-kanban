'use client';

import Link from 'next/link';
import styles from '../kanban.module.css';
import { AppsMenu } from './AppsMenu';
import { KanbanAccountMenu, type KanbanAccountMenuUser } from './KanbanAccountMenu';

export type KanbanHeaderUser = KanbanAccountMenuUser;

/**
 * Web-only top bar (hidden below the sidebar's own mobile breakpoint — mobile
 * gets its own equivalent, `KanbanMobileHeader`). Renders on every plugin
 * page via the root layout, unlike `KanbanSidebar` which is scoped to the
 * Home/Inbox routes only.
 *
 * `shell: minimal` gives the plugin zero platform chrome, so this replaces
 * what the platform's own header would have provided: a way back to
 * Launcher (left) and the current user's identity (right). Notifications
 * are deliberately deferred here — no bell in the desktop header (unlike
 * the mobile header, which does have one pointed at Inbox).
 *
 * A compact top bar sized against the Trello reference (48px height, 32px
 * icon buttons, 32px avatar) rather than the platform's own taller 60px
 * shell header — this plugin owns its whole viewport under `shell: minimal`,
 * so it isn't bound to platform chrome dimensions.
 *
 * The instance-initial badge (left, next to the Kanban wordmark) is the same
 * accent-filled tile the platform's own sidebar renders
 * (`runtime/app/(platform)/layout.tsx`'s `.brand`) and still just links to
 * `/launcher` — unchanged in position or purpose.
 *
 * The Apps trigger (`AppsMenu`) is a separate control, next to the avatar:
 * the actual Launcher plugin's own icon
 * (`/plugin-icons/fs.sovereign.launcher.svg`), opening a floating apps
 * switcher rather than navigating. `shell: minimal` gets no sidebar/Apps
 * drawer at all, so this is this plugin's only way to jump directly to
 * another app without a full round trip through `/launcher` first — see
 * `AppsMenu`'s own doc comment for the data source and why it's a popover,
 * not a modal.
 *
 * The avatar/account dropdown is `KanbanAccountMenu`, shared verbatim with
 * `KanbanMobileHeader` — see that component's own doc comment for why it's a
 * DS-primitive rebuild rather than the platform's real `AccountMenu`.
 */
export function KanbanHeader({
  user,
  instanceName,
}: {
  user: KanbanHeaderUser;
  instanceName: string;
}) {
  const brandInitial = instanceName.charAt(0).toUpperCase() || 'S';

  return (
    <header className={styles.header}>
      <div className={styles.headerLeft}>
        <Link
          href="/launcher"
          className={styles.headerBrandBadge}
          aria-label={`${instanceName} Launcher`}
        >
          {brandInitial}
        </Link>
        <Link href="/kanban" className={styles.headerBrand}>
          <img
            src="/plugin-icons/fs.sovereign.kanban.svg"
            alt=""
            className={styles.headerBrandIcon}
          />
          <span className={styles.headerBrandName}>Kanban</span>
        </Link>
      </div>

      <div className={styles.headerRight}>
        <AppsMenu />
        <KanbanAccountMenu user={user} avatarSize="md" />
      </div>
    </header>
  );
}
