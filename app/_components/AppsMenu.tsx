'use client';

import { useState } from 'react';
import { Icon, Popover } from '@sovereignfs/ui';
import styles from '../kanban.module.css';
import type { MobileAppEntry } from './KanbanMobileFooter';

function monogram(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const [first = '', second = ''] = trimmed.split(/\s+/);
  return (second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2)).toUpperCase();
}

const LAUNCHER_PLUGIN_ID = 'fs.sovereign.launcher';

/**
 * Apps switcher this plugin's own top bar opens in place of the platform
 * sidebar's Apps grid — `shell: minimal` gets none of the platform's chrome
 * (no sidebar, no Launcher link), so this is the only way to jump directly
 * to another installed app without going through `/launcher` first. A
 * floating popover anchored to its own trigger, not a modal — a quick
 * jump-to-another-app switcher, not a page the user reads through.
 *
 * `apps` is the same `sdk.plugins.list()` result the mobile footer's
 * drawer already renders, fetched once server-side in `layout.tsx` and
 * passed down — this component used to fetch `/api/plugins` on every open
 * (a runtime-internal URL a plugin has no contract with) with its own
 * loading/error states while the mobile surface got the list for free.
 * The Launcher plugin itself is filtered out (it's the "Home" tile below).
 *
 * Tile links are plain `<a>` tags, not `next/link` — most of these apps
 * live under the platform's `(platform)` root layout, a different one than
 * this plugin's `(minimal)`, and a client-side transition across that
 * boundary hit an intercepting-route bug for `/account`.
 *
 * "Home" and (admin-only) "Console" are static tiles ahead of the list —
 * neither is a listable plugin: Launcher is a hardcoded shell route, and
 * Console is deliberately filtered out of the plugin list by the platform.
 */
export function AppsMenu({ apps, isAdmin }: { apps: MobileAppEntry[]; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const tiles = apps.filter((app) => app.id !== LAUNCHER_PLUGIN_ID);

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
      <div className={styles.appsGrid}>
        <a href="/launcher" className={styles.appTile}>
          <span className={styles.appTileIcon} aria-hidden="true">
            <Icon name="house" size="md" aria-hidden />
          </span>
          <span className={styles.appTileName}>Home</span>
        </a>
        {isAdmin && (
          <a href="/console" className={styles.appTile}>
            <span className={styles.appTileIcon} aria-hidden="true">
              <img
                src="/plugin-icons/fs.sovereign.console.svg"
                alt=""
                className={styles.appTileIconImg}
              />
            </span>
            <span className={styles.appTileName}>Console</span>
          </a>
        )}
        {tiles.map((app) => (
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
    </Popover>
  );
}
