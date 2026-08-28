import type { ReactNode } from 'react';
import { sdk } from '@sovereignfs/sdk';
import { ToastProvider } from '@sovereignfs/ui';
import { KanbanHeader } from './_components/KanbanHeader';
import { KanbanMobileFooter, type MobileAppEntry } from './_components/KanbanMobileFooter';
import { KanbanMobileHeader } from './_components/KanbanMobileHeader';
import { requireUser } from './_lib/authz';
import { getDb } from './_lib/db';
import { registerPortabilityHandlers } from './_lib/portability';
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
 * The desktop header (`KanbanHeader`) keeps a pure-CSS `@media` hide-on-mobile
 * (matching the sidebar's own prior convention): zero hydration-flash risk.
 * Mobile gets its own equivalent, `KanbanMobileHeader`, gated by
 * `useIsMobile` instead — same reasoning as `KanbanMobileFooter` (below):
 * unlike a pure CSS hide, this avoids ever measuring/publishing shell-chrome
 * height from `MobileHeader`/`MobileFooter` on desktop at all.
 * `<ResponsiveSurface>` itself can't be used directly here — it has no
 * `'use client'` of its own (by design; every real consumer in this repo
 * renders it from inside an already-client component, never straight from a
 * Server Component's JSX), so both mobile components decide internally via
 * `useIsMobile` instead of this layout wrapping them.
 *
 * K.11: the mobile footer's Inbox unseen badge is computed here — a layout
 * runs on every navigation within the plugin, not just visits to
 * `/kanban/inbox` — so it stays current without the client component
 * needing its own fetch. The sidebar's own copy of this same badge is
 * fetched independently by `(home)/layout.tsx` (cheap query, avoids
 * threading data across sibling layouts).
 *
 * `ToastProvider` is supplied here rather than assumed: under `shell:
 * default`, the platform's own `ClientShell` wraps every plugin page in one,
 * but `runtime/app/(minimal)/layout.tsx` (what `shell: minimal` composes
 * into) is deliberately chrome-free and provides none — a `minimal` plugin
 * owns its own tree, providers included. Found live in production: every
 * `useToast()` call (used throughout board/card actions) threw immediately
 * on render — "useToast() must be used inside <ToastProvider>" — the moment
 * this plugin moved off `shell: default` and lost the platform's provider.
 */
export default async function KanbanLayout({ children }: { children: ReactNode }) {
  // In-process and reset on restart — the platform SDK requires
  // re-registering from a request-scoped plugin route, so this runs on
  // every request. Best-effort: a registration failure must not block the
  // plugin's own UI (matches Docs'/Sheets' layout.tsx).
  try {
    await registerPortabilityHandlers();
  } catch {
    // Portability is a best-effort platform integration.
  }

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

  // Platform-role admin check, same capability (`console:access`) and same
  // pattern (`hasCapability` against the session) the platform shell's own
  // `AdminConsoleIcon` uses to gate its Console link — gates the "Console"
  // tile `AppsMenu` adds to its Apps switcher below. Computed here, not in
  // `AppsMenu` itself, because that component is a client component with no
  // server-side session access of its own; every other piece of session data
  // it needs already flows down the same way (see `KanbanHeader`'s `user`
  // prop just below).
  const isAdmin = sdk.auth.hasCapability(session, 'console:access');

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
    <ToastProvider>
      {/* `id="sv-app-shell"` — the platform's own shell root id
          (`runtime/app/(platform)/layout.tsx`), never rendered for this
          plugin's own routes since `shell: minimal` composes under
          `(minimal)`, not `(platform)`, so reusing it here can't collide.
          `MobileHeader`/`MobileFooter` (used by `KanbanMobileHeader`/
          `KanbanMobileFooter` below) already call
          `usePublishShellChromeHeight` internally, looking up exactly this
          id to publish `--sv-shell-header-height`/`--sv-shell-footer-height`
          onto — previously a no-op here with no matching element anywhere
          in this plugin's tree, so every consumer of those variables
          (`Drawer`'s own `bottom: var(--sv-shell-footer-height, 0)` among
          them) silently fell back to a value that doesn't account for this
          plugin's real, self-rendered chrome. Found live: `MobileAppsDrawer`
          extended all the way to the viewport's bottom edge instead of
          stopping above the footer, with only the footer's own higher
          z-index (101) hiding the overlap — its last row of tiles sat
          entirely behind the (opaque) footer with zero visible clearance,
          not just tight padding. Adding this id costs nothing beyond what
          `MobileHeader`/`MobileFooter` were already trying to do. */}
      <div id="sv-app-shell" className={styles.shell}>
        <KanbanHeader
          user={{
            name: session?.user.name ?? null,
            email: session?.user.email ?? '',
            image: session?.user.image ?? null,
          }}
          instanceName={instanceName}
          isAdmin={isAdmin}
        />
        <KanbanMobileHeader
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
    </ToastProvider>
  );
}
