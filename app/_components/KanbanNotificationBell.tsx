'use client';

import { useEffect, useRef, useState } from 'react';
import type { NotificationItem } from '@sovereignfs/sdk';
import { Icon, Popover, Typography, useToast } from '@sovereignfs/ui';
import {
  dismissAllPlatformNotifications,
  dismissPlatformNotification,
  listPlatformNotifications,
  markAllPlatformNotificationsRead,
  markPlatformNotificationRead,
} from '../actions';
import styles from '../kanban.module.css';

interface SsePayload {
  notificationId: string;
  userId: string;
  title: string;
  body?: string;
  url?: string;
  category: string;
  source?: string;
}

const POLL_INTERVAL_MS = 10_000;
const SSE_ERROR_FALLBACK_THRESHOLD = 3;

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 2) return 'Yesterday';
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Same three-way grouping as the real `NotificationBell`'s own
 * `categoryColorClass`/`CategoryIcon` — green for user/invite/join, amber
 * for security/session/auth/warning, neutral otherwise — mapped onto this
 * plugin's existing curated `@sovereignfs/ui` icon set. `layers` (the
 * real component's default/neutral icon) is now in the curated set — added
 * alongside this fix specifically so the neutral case matches pixel-for-
 * pixel instead of falling back to `package`, the closest available
 * equivalent before. `user-round-plus` for the green case remains a
 * deliberate approximation of the real component's hand-drawn `user-plus`
 * glyph (not curated), close enough that adding it wasn't judged worth a
 * second icon addition in the same pass.
 */
function categoryIconName(category: string): 'user-round-plus' | 'alert-triangle' | 'layers' {
  const c = category.toLowerCase();
  if (c.includes('user') || c.includes('invite') || c.includes('join')) return 'user-round-plus';
  if (c.includes('security') || c.includes('session') || c.includes('auth') || c.includes('warning'))
    return 'alert-triangle';
  return 'layers';
}

function categoryIconClass(category: string, styles: Record<string, string>): string | undefined {
  const c = category.toLowerCase();
  if (c.includes('user') || c.includes('invite') || c.includes('join')) return styles.iconGreen;
  if (c.includes('security') || c.includes('session') || c.includes('auth') || c.includes('warning'))
    return styles.iconAmber;
  return styles.iconNeutral;
}

/**
 * The real platform Notification Center, not a Kanban-scoped substitute —
 * per explicit developer direction ("the header completely belongs to
 * platform functionalities; the bell should open a notification popup").
 * Reads/writes go through `@sovereignfs/sdk`'s `notifications.list/
 * markRead/markAllRead/dismiss/dismissAll` (via this plugin's own server
 * actions in `actions.ts`) rather than calling the platform-internal
 * `/api/account/notifications` REST route directly — the SDK methods hit
 * the exact same underlying platform-DB rows (real cross-plugin data, real
 * read/dismissed state), just through the sanctioned plugin-facing surface
 * instead of a runtime-internal URL a plugin has no contract with. The
 * real `NotificationBell` React component itself still can't be imported
 * (`shell: minimal` gets none of the platform's chrome, and it isn't part
 * of `@sovereignfs/ui`'s published surface — same situation
 * `KanbanAccountMenu` already documents), so the UI is rebuilt from DS
 * primitives, same as before.
 *
 * SSE (`/api/account/notifications/stream`) is the one piece still called
 * directly by URL, not through the SDK — a persistent server-sent-events
 * connection is a transport primitive the browser opens itself
 * (`new EventSource(url)`), not a request/response call an SDK method can
 * wrap; polling `listPlatformNotifications()` on an interval is this
 * component's fallback, same as the real bell's own polling mode.
 *
 * Deliberately a single self-contained component rather than the platform's
 * module-level shared store — that store exists solely because the real
 * `NotificationBell` mounts twice at once (sidebar + mobile header) and
 * needed to dedupe polling/SSE between them; Kanban only ever mounts one
 * instance (the mobile header), so there's no second instance to
 * coordinate with. Built from `Popover` (the same DS primitive
 * `KanbanAccountMenu` already uses for its own trigger+dropdown), not the
 * platform's bespoke hand-rolled panel positioning — DS-first, per this
 * plugin's own conventions.
 *
 * Visual details (panel width/padding, header title, close button, per-item
 * category icon/color, dismiss/unread-dot sizing) are copied from the real
 * `NotificationBell.module.css` token-for-token — same semantic tokens
 * (`--sv-color-surface-sunken`, `--sv-color-success-*`/`-warning-*`,
 * `--sv-radius-*`), same pixel values — so the two panels read as the same
 * design, not a reskinned approximation.
 */
export function KanbanNotificationBell() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The trigger button's own bottom edge (plain px, measured at open time) —
  // mirrors the real `NotificationBell`'s own `sidebarPanelBottom` pattern.
  // Not read off `--sv-shell-header-height`: that variable is only ever
  // published onto `#sv-app-shell` (`usePublishShellChromeHeight`), an
  // element that doesn't exist under `shell: minimal` — every reference to
  // it here would silently fall back to its hardcoded 60px default,
  // undershooting `MobileHeader`'s real ~69px rendered height (12px
  // padding-top + 44px trigger + 12px padding-bottom) and landing the panel
  // a few px into the header instead of below it. The panel's actual `top`
  // is built from this measured value with `calc()` at render time (see the
  // `panelStyle` below) — `--sv-space-3` closes out the header's own bottom
  // padding (the exact amount `MobileHeader.module.css` reserves below its
  // content row, reconstructing the header's real bottom edge from this one
  // live measurement with no dependency on `@sovereignfs/ui`'s internal DOM
  // structure or class names), then `--sv-space-2` is the same gap the real
  // `NotificationBell.module.css` `.panelHeader` puts between the header and
  // the panel. Deliberately built via `calc()` + `var()` rather than
  // resolving the tokens to px in JS (e.g. `getComputedStyle` + a rem→px
  // multiply) — letting the browser do that arithmetic sidesteps having to
  // assume a 16px root font size.
  const [triggerBottom, setTriggerBottom] = useState<number | null>(null);
  // Optimistic: attempt SSE first, same as the real bell's default —
  // falls back to polling after repeated stream errors (below). There's no
  // server-communicated "sse available" flag on this path (that lives in
  // the REST route's own response shape, which this component no longer
  // calls), so this starts SSE-first rather than polling-first.
  const [transport, setTransport] = useState<'polling' | 'sse'>('sse');
  const seenIds = useRef<Set<string>>(new Set());
  const initialFetchDone = useRef(false);
  const sseErrorCount = useRef(0);

  async function fetchNotifications(opts?: { silent?: boolean }): Promise<void> {
    try {
      const data = await listPlatformNotifications();

      const isFirstFetch = !initialFetchDone.current;
      for (const item of data.items) {
        if (!seenIds.current.has(item.id)) {
          seenIds.current.add(item.id);
          if (!isFirstFetch && !opts?.silent && item.readAt == null) {
            toast.show({
              title: item.title,
              message: item.body ?? undefined,
              category: item.category,
            });
          }
        }
      }
      initialFetchDone.current = true;
      setItems(data.items);
      setUnreadCount(data.unreadCount);
    } catch {
      // Transient fetch failure — the next poll tick or SSE reconnect retries.
    }
  }

  // Initial fetch on mount.
  useEffect(() => {
    void fetchNotifications({ silent: true });
  }, []);

  // Transport loop — SSE first, falling back to polling after repeated SSE
  // errors (mirrors the real NotificationBell's own fallback threshold
  // exactly, see this component's own doc comment for why SSE is called by
  // URL directly rather than through the SDK).
  useEffect(() => {
    if (transport === 'sse') {
      sseErrorCount.current = 0;
      const es = new EventSource('/api/account/notifications/stream');
      es.onmessage = (event: MessageEvent<string>) => {
        sseErrorCount.current = 0;
        try {
          const payload = JSON.parse(event.data) as SsePayload;
          if (seenIds.current.has(payload.notificationId)) return;
          seenIds.current.add(payload.notificationId);
          toast.show({
            title: payload.title,
            message: payload.body,
            category: payload.category,
          });
          setItems((prev) => [
            {
              id: payload.notificationId,
              source: payload.source ?? 'unknown',
              sourceType: 'plugin',
              title: payload.title,
              body: payload.body ?? null,
              url: payload.url ?? null,
              category: payload.category,
              icon: null,
              readAt: null,
              dismissedAt: null,
              createdAt: Math.floor(Date.now() / 1000),
            },
            ...prev,
          ]);
          setUnreadCount((c) => c + 1);
        } catch {
          // Malformed payload — ignore.
        }
      };
      es.onerror = () => {
        sseErrorCount.current += 1;
        if (sseErrorCount.current >= SSE_ERROR_FALLBACK_THRESHOLD) setTransport('polling');
      };
      return () => es.close();
    }

    const handle = setInterval(() => void fetchNotifications(), POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [transport]);

  async function markAllRead(): Promise<void> {
    setItems((prev) =>
      prev.map((n) => ({ ...n, readAt: n.readAt ?? Math.floor(Date.now() / 1000) })),
    );
    setUnreadCount(0);
    await markAllPlatformNotificationsRead();
  }

  async function markRead(id: string): Promise<void> {
    const item = items.find((n) => n.id === id);
    if (!item || item.readAt != null) return;
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: Math.floor(Date.now() / 1000) } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    await markPlatformNotificationRead(id);
  }

  async function dismiss(id: string): Promise<void> {
    const item = items.find((n) => n.id === id);
    setItems((prev) => prev.filter((n) => n.id !== id));
    if (item?.readAt == null) setUnreadCount((c) => Math.max(0, c - 1));
    await dismissPlatformNotification(id);
  }

  async function clearAll(): Promise<void> {
    setItems([]);
    setUnreadCount(0);
    await dismissAllPlatformNotifications();
  }

  return (
    <Popover
      align="right"
      width={340}
      open={open}
      onClose={() => setOpen(false)}
      aria-label="Notifications"
      panelStyle={{
        position: 'fixed',
        top:
          triggerBottom != null
            ? `calc(${triggerBottom}px + var(--sv-space-3) + var(--sv-space-2))`
            : undefined,
        left: 'var(--sv-space-4)',
        right: 'var(--sv-space-4)',
        width: 'auto',
        maxHeight: 480,
      }}
      trigger={
        <button
          ref={triggerRef}
          type="button"
          className={[styles.mobileHeaderIconButton, open ? styles.mobileHeaderIconButtonActive : '']
            .filter(Boolean)
            .join(' ')}
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            // Not a functional `setOpen((o) => { if (!o) void fetchNotifications(...); return !o; })`
            // — nesting the server-action call inside a state-updater
            // function tripped "Cannot update a component (Router) while
            // rendering a different component" (found live: reproduced on
            // every mount, not just this click, root-caused by isolating it
            // to this exact nesting pattern before removing it — a sibling
            // `useTransition` wrapper was also tried and ruled out the same
            // way, verified clean without it in a fresh tab with no HMR
            // history). Reading `open` from the closed-over variable and
            // calling the action as a plain, unnested side effect avoids it.
            const willOpen = !open;
            setOpen(willOpen);
            if (willOpen) {
              void fetchNotifications({ silent: true });
              if (triggerRef.current) {
                setTriggerBottom(triggerRef.current.getBoundingClientRect().bottom);
              }
            }
          }}
        >
          <Icon name="bell" size="lg" aria-hidden />
          {unreadCount > 0 && (
            <span className={styles.notificationBadge} aria-hidden>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      }
    >
      <div className={styles.notificationPanelHeader}>
        <span className={styles.notificationPanelTitle}>Notifications</span>
        <div className={styles.notificationPanelActions}>
          {items.length > 0 && (
            <>
              {unreadCount > 0 && (
                <button
                  type="button"
                  className={styles.notificationActionBtn}
                  onClick={() => void markAllRead()}
                >
                  Mark all read
                </button>
              )}
              <button
                type="button"
                className={styles.notificationActionBtn}
                onClick={() => void clearAll()}
              >
                Clear all
              </button>
            </>
          )}
          <button
            type="button"
            className={styles.notificationCloseBtn}
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
          >
            <Icon name="x" size="sm" aria-hidden />
          </button>
        </div>
      </div>
      <ul className={styles.notificationList} aria-label="Notification list">
        {items.length === 0 && (
          <li className={styles.notificationEmpty}>
            <span className={styles.notificationEmptyIcon} aria-hidden>
              <Icon name="bell" size="md" aria-hidden />
            </span>
            <Typography variant="caption">No notifications.</Typography>
          </li>
        )}
        {items.map((item) => (
          <li
            key={item.id}
            className={[styles.notificationItem, item.readAt != null ? styles.notificationItemRead : '']
              .filter(Boolean)
              .join(' ')}
          >
            <span
              className={[styles.notificationCategoryIcon, categoryIconClass(item.category, styles)]
                .filter(Boolean)
                .join(' ')}
              aria-hidden
            >
              <Icon name={categoryIconName(item.category)} size="sm" aria-hidden />
            </span>
            <div className={styles.notificationItemBody}>
              {item.url ? (
                <a
                  href={item.url}
                  className={styles.notificationItemTitle}
                  onClick={() => {
                    void markRead(item.id);
                    setOpen(false);
                  }}
                >
                  {item.title}
                </a>
              ) : item.readAt == null ? (
                <button
                  type="button"
                  className={styles.notificationItemTitle}
                  aria-label={`Mark as read: ${item.title}`}
                  onClick={() => void markRead(item.id)}
                >
                  {item.title}
                </button>
              ) : (
                <span className={styles.notificationItemTitle}>{item.title}</span>
              )}
              <Typography variant="caption" className={styles.notificationItemTime}>
                {timeAgo(item.createdAt)}
              </Typography>
            </div>
            <div className={styles.notificationItemEnd}>
              {item.readAt == null && (
                <span className={styles.notificationUnreadDot} aria-label="Unread" />
              )}
              <button
                type="button"
                className={styles.notificationDismissBtn}
                aria-label={`Dismiss: ${item.title}`}
                onClick={() => void dismiss(item.id)}
              >
                <Icon name="x" size="xs" aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
