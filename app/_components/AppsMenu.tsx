'use client';

import { useEffect, useState } from 'react';
import { Popover, Spinner } from '@sovereignfs/ui';
import styles from '../kanban.module.css';

interface AppEntry {
  id: string;
  name: string;
  routePrefix: string;
  iconUrl?: string;
}

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'loaded'; apps: AppEntry[] };

function monogram(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const [first = '', second = ''] = trimmed.split(/\s+/);
  return (second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2)).toUpperCase();
}

/**
 * Apps switcher this plugin's own top bar opens in place of the platform
 * sidebar's Apps grid — `shell: minimal` gets none of the platform's chrome
 * (no sidebar, no Launcher link), so this is the only way to get back to, or
 * jump directly to, another installed app without going through `/launcher`
 * first. A floating popover anchored to its own trigger (Google's own account-
 * menu-adjacent app-switcher grid, not a full centered modal with a
 * backdrop) — this is a quick jump-to-another-app switcher, not a page the
 * user reads through, so it shouldn't demand a modal's full attention.
 *
 * Fetches the same session-gated, access-policy-filtered route the
 * platform's own Launcher grid renders from (`GET /api/plugins` —
 * `runtime/src/launcher-plugins.ts`'s `selectLauncherPlugins`) rather than
 * hardcoding a list or importing the registry — the SDK boundary rule
 * forbids the latter, and this route is the documented way a plugin gets
 * the installed-plugin list (`docs/architecture-rules.md`). Already
 * filtered to what the current user can actually launch (enabled,
 * access-policy-allowed, admin-only plugins only for admins) — no extra
 * filtering needed here. Fetched fresh every open rather than once on
 * mount/cached, matching this plugin's own `BoardShareDialog` member-picker
 * precedent (fetch-on-open, no client cache) — a lightweight, infrequently-
 * opened surface, not worth the staleness tradeoff of caching.
 *
 * Tile links are plain `<a>` tags, not `next/link`'s `Link` — most of these
 * apps live under the platform's own `(platform)` root layout, a different
 * one than this plugin's `(minimal)` — see `KanbanHeader.tsx`'s own doc
 * comment for the `/account` intercepting-route bug a `Link` hit crossing
 * that exact boundary. Not every target has an intercepting route, but a
 * plain anchor is correct and safe for all of them, so there's no reason to
 * special-case per target.
 */
export function AppsMenu() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ status: 'loading' });
    fetch('/api/plugins')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch apps: ${res.status}`);
        return res.json() as Promise<{ plugins: AppEntry[] }>;
      })
      .then((data) => {
        if (!cancelled) setState({ status: 'loaded', apps: data.plugins });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Popover
      align="right"
      width={320}
      open={open}
      onClose={() => setOpen(false)}
      aria-label="Apps"
      trigger={
        <button
          type="button"
          className={styles.headerAppsButton}
          aria-label="Apps"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <img
            src="/plugin-icons/fs.sovereign.launcher.svg"
            alt=""
            className={styles.headerAppsIcon}
          />
        </button>
      }
    >
      <div className={styles.appsPopoverHeader}>Apps</div>
      {state.status === 'loading' && (
        <div className={styles.appsPopoverLoading}>
          <Spinner size="md" label="Loading apps…" />
        </div>
      )}
      {state.status === 'error' && (
        <p className={`${styles.formError} ${styles.appsPopoverError}`}>
          Couldn&apos;t load apps. Try again.
        </p>
      )}
      {state.status === 'loaded' && (
        <div className={styles.appsGrid}>
          {state.apps.map((app) => (
            <a key={app.id} href={app.routePrefix} className={styles.appTile}>
              <span className={styles.appTileIcon} aria-hidden="true">
                {app.iconUrl ? (
                  <img src={app.iconUrl} alt="" className={styles.appTileIconImg} />
                ) : (
                  monogram(app.name)
                )}
              </span>
              <span className={styles.appTileName}>{app.name}</span>
            </a>
          ))}
        </div>
      )}
    </Popover>
  );
}
