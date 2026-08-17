import { KeyboardSensor, PointerSensor as LibPointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { PointerEvent as ReactPointerEvent } from 'react';

/**
 * No drag handle (SPEC's web interaction model — whole card/list-header is
 * both the click target and the drag surface): a short activation distance
 * lets dnd-kit tell a plain click from a drag start, so single-click still
 * opens the card modal and list rename still works. Web only — mobile's
 * long-press/carousel-conflict-aware sensor is K.15's separate design.
 */
const ACTIVATION_DISTANCE_PX = 6;

/**
 * True when a drag should be allowed to start from `target`. Refused inside
 * an element marked `data-no-dnd` — the list's "…" options menu opts out so
 * opening it never has a chance to be swallowed by a false-start drag.
 * Exported standalone so it's unit-testable without spinning up dnd-kit.
 */
export function shouldHandleDndEvent(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return target.closest('[data-no-dnd]') === null;
}

// dnd-kit's documented pattern for scoping activation: subclass the sensor
// and replace its static `activators` with a handler that inspects the
// originating event's target — dnd-kit still re-checks the real activation
// constraint (distance) internally regardless of what this returns.
class PointerSensor extends LibPointerSensor {
  static override activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: ReactPointerEvent) => shouldHandleDndEvent(event.target),
    },
  ];
}

export function useBoardDndSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: ACTIVATION_DISTANCE_PX } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}
