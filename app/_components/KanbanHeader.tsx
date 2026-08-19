'use client';

import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { Avatar, Icon, Popover } from '@sovereignfs/ui';
import styles from '../kanban.module.css';
import { AppsMenu } from './AppsMenu';

export interface KanbanHeaderUser {
  name: string | null;
  email: string;
  image: string | null;
}

/**
 * Web-only top bar (hidden below the sidebar's own mobile breakpoint —
 * mobile keeps its existing footer-only chrome for now). Renders on every
 * plugin page via the root layout, unlike `KanbanSidebar` which is scoped to
 * the Home/Inbox routes only.
 *
 * `shell: minimal` gives the plugin zero platform chrome, so this replaces
 * what the platform's own header would have provided: a way back to
 * Launcher (left) and the current user's identity (right). Notifications
 * are deliberately deferred — no bell here yet.
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
 * The avatar opens the same account dropdown the platform's own shell chrome
 * shows (`runtime/app/(platform)/_components/AccountMenu.tsx`) — that
 * component lives outside the plugin's reach (`shell: minimal` gets none of
 * the platform's chrome, and it isn't part of the published `@sovereignfs/ui`
 * surface plugins can import), so this rebuilds the same look/behavior from
 * DS primitives (`Popover`, `Avatar`, `Icon`) instead: user header (avatar +
 * name + email), Account/Preferences links, then a destructive Sign out that
 * posts to the platform's own `/api/account/logout` route.
 *
 * The Account/Preferences items are plain `<a>` tags, not `next/link`'s
 * `Link` — `/account` has an intercepting-route modal variant
 * (`(platform)/(plugins)/@modal/(.)account`) that only exists inside the
 * `(platform)` root layout's own `@modal` parallel slot. `shell: minimal`
 * puts this plugin under a *different* root layout (`(minimal)`) with no
 * such slot, so a client-side `Link` soft-navigation to `/account` from here
 * always tries to mount that intercepted modal into a tree that has nowhere
 * to put it — reproduced live as a bare "404 — This page could not be
 * found" even on a first navigation in a brand-new tab, i.e. not a stale
 * router-cache artifact. A plain anchor forces a full page load, which
 * bypasses interception entirely (a Next.js convention: intercepting routes
 * only apply to client-side navigation).
 */
export function KanbanHeader({
  user,
  instanceName,
}: {
  user: KanbanHeaderUser;
  instanceName: string;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const displayName = user.name ?? user.email;
  const brandInitial = instanceName.charAt(0).toUpperCase() || 'S';

  function handleSignOut(event: FormEvent<HTMLFormElement>) {
    // Native, non-React submit (matches the platform's own AccountMenu) so it
    // isn't tied to any React state that's about to unmount anyway.
    event.currentTarget.submit();
  }

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

        <Popover
          align="right"
          width={240}
          open={accountOpen}
          onClose={() => setAccountOpen(false)}
          aria-label="Account menu"
          trigger={
            <button
              type="button"
              className={styles.headerAvatarLink}
              aria-label="Account"
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((v) => !v)}
            >
              <Avatar
                name={displayName}
                src={user.image ?? undefined}
                size="md"
                className={styles.accentAvatar}
              />
            </button>
          }
        >
          <div role="menu" aria-label="Account">
            <div className={styles.accountMenuHeader}>
              <Avatar
                name={displayName}
                src={user.image ?? undefined}
                size="lg"
                className={styles.accentAvatar}
              />
              <div className={styles.accountMenuUserInfo}>
                {user.name && <p className={styles.accountMenuName}>{user.name}</p>}
                <p className={styles.accountMenuEmail}>{user.email}</p>
              </div>
            </div>
            <hr className={styles.accountMenuDivider} />
            {/* Plain anchors, not next/link's Link — see this component's own
                doc comment for why (the /account intercepting-route modal has
                no parallel slot under this plugin's separate root layout). */}
            <a href="/account" role="menuitem" className={styles.accountMenuItem}>
              <Icon name="user" size="sm" aria-hidden />
              Account
            </a>
            <a href="/account/preferences" role="menuitem" className={styles.accountMenuItem}>
              <Icon name="sliders-horizontal" size="sm" aria-hidden />
              Preferences
            </a>
            <hr className={styles.accountMenuDivider} />
            <form action="/api/account/logout" method="post" onSubmit={handleSignOut}>
              <button
                type="submit"
                role="menuitem"
                className={`${styles.accountMenuItem} ${styles.accountMenuItemDestructive}`}
              >
                <Icon name="log-out" size="sm" aria-hidden />
                Sign out
              </button>
            </form>
          </div>
        </Popover>
      </div>
    </header>
  );
}
