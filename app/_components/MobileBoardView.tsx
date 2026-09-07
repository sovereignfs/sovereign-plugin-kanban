'use client';

import { useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  SwipableMobileCarousel,
  SwipableMobileCarouselDots,
  SwipableMobileCarouselSlide,
  SwipableMobileCarouselSlideBody,
  useCarouselRouteSync,
} from '@sovereignfs/ui';
import type { BoardCardSummary, BoardData, BoardList } from '../_lib/queries';
import styles from '../kanban.module.css';
import { AddListSlot } from './AddListSlot';
import { MobileListSlide } from './MobileListSlide';

const ADD_LIST_SLIDE_KEY = '__add-list__';

/**
 * K.13 — swipable one-list-per-screen board. The active slide is synced to
 * `?list=<listId>` via useCarouselRouteSync, but `onNavigate` deliberately
 * calls `history.replaceState` directly instead of `router.replace`: this
 * board's data model loads every list/card up front in one `getBoardData`
 * call, so routing a swipe through Next's router — which re-fetches the
 * whole RSC payload for any searchParam change — would mean a full board
 * reload on every swipe.
 *
 * `usePathname()`/`useSearchParams()` are only read once (frozen in state at
 * first mount) to seed the initial slide from a real deep link or reload;
 * `activeIndex` is the sole source of truth for rendering after that.
 *
 * Opening a card (`?card=`) still goes through a real `<Link>` navigation
 * on purpose — CardDetailOverlay needs a real server round trip for
 * `getCardDetail`. Each slide builds that href itself from its own
 * `list.id`, never from `activeIndex`, so it's correct even mid-swipe.
 *
 * K.21 — `canEdit` false drops the trailing "Add list" slide and passes
 * read-only down to every slide.
 */
export function MobileBoardView({
  board,
  orderedLists,
  cardsFor,
  canEdit,
}: {
  board: BoardData;
  orderedLists: BoardList[];
  cardsFor: (listId: string) => BoardCardSummary[];
  canEdit: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [initialRouteKey] = useState(() => `${pathname}?${searchParams.toString()}`);
  const slideCount = orderedLists.length + (canEdit ? 1 : 0);

  function indexForPathname(routeKey: string): number {
    const qs = routeKey.split('?')[1] ?? '';
    const listId = new URLSearchParams(qs).get('list');
    if (!listId) return 0;
    // The one non-list slide `pathForIndex` below can write into the URL —
    // matched before the real-list lookup, or it fell through to the "not
    // found" fallback and silently bounced back to index 0 on a reload.
    if (listId === ADD_LIST_SLIDE_KEY) return canEdit ? orderedLists.length : 0;
    const idx = orderedLists.findIndex((l) => l.id === listId);
    return idx === -1 ? 0 : idx;
  }

  function pathForIndex(index: number): string {
    if (canEdit && index === orderedLists.length) return `${pathname}?list=${ADD_LIST_SLIDE_KEY}`;
    const list = orderedLists[index];
    return list ? `${pathname}?list=${list.id}` : pathname;
  }

  const { activeIndex, onSettle } = useCarouselRouteSync({
    indexForPathname,
    pathForIndex,
    pathname: initialRouteKey,
    onNavigate: (path) => window.history.replaceState(null, '', path),
  });

  return (
    <div className={styles.mobileCarouselWrap}>
      <SwipableMobileCarousel
        activeIndex={activeIndex}
        onSettle={onSettle}
        aria-label={`${board.name} lists`}
        renderIndicator={
          orderedLists.length > 1
            ? ({ count, activeIndex: dotIndex, labels, onJump }) => (
                <SwipableMobileCarouselDots
                  count={canEdit ? count - 1 : count}
                  activeIndex={dotIndex}
                  labels={canEdit ? labels.slice(0, -1) : labels}
                  density={orderedLists.length > 5 ? 'compact' : 'default'}
                  aria-label={`${board.name} lists`}
                  onJump={onJump}
                />
              )
            : null
        }
      >
        {orderedLists.map((list) => (
          <SwipableMobileCarouselSlide key={list.id} slideKey={list.id} label={list.name}>
            <MobileListSlide
              list={list}
              cards={cardsFor(list.id)}
              canEdit={canEdit}
              cardHrefFor={(cardId) => `${pathname}?list=${list.id}&card=${cardId}`}
            />
          </SwipableMobileCarouselSlide>
        ))}

        {canEdit && slideCount > orderedLists.length && (
          <SwipableMobileCarouselSlide slideKey={ADD_LIST_SLIDE_KEY} label="Add list">
            <SwipableMobileCarouselSlideBody>
              <div className={styles.mobileAddListSlide}>
                <AddListSlot boardId={board.id} variant="empty" />
              </div>
            </SwipableMobileCarouselSlideBody>
          </SwipableMobileCarouselSlide>
        )}
      </SwipableMobileCarousel>
    </div>
  );
}
