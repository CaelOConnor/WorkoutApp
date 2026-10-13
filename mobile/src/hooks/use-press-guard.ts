import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

// Stops a double-tap from doing something twice: opening two copies of a screen, sending two
// requests, or showing two dialogs.
//
// Disabling a button from state (e.g. `disabled={mutation.isPending}`) isn't enough. State only
// changes on the next render, and TanStack Query even delays its update with a timer first, so a
// second tap that arrives before then still sees the button enabled. And a screen stays mounted
// under the one pushed on top of it, so its buttons keep working after router.push().
// A ref fixes both: it changes synchronously, and the very next tap reads the new value.
//
// One guard per screen: while anything on it is running (or it has navigated away), every other
// press through the guard is ignored too, so two changes never overlap.
export function usePressGuard() {
  const busy = useRef(false);
  // True once the screen navigated away: then the lock is only released when it's shown again.
  const left = useRef(false);

  // Runs when this screen gains focus: when it first appears, and when the user comes back to it
  // (e.g. a sheet on top closes). useCallback keeps the effect from re-running on every render.
  useFocusEffect(
    useCallback(() => {
      busy.current = false;
      left.current = false;
    }, [])
  );

  // For a press that only navigates (router.push, router.back).
  function navigate(go: () => void) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    left.current = true;
    go();
  }

  // For a press that runs something async: a request, a confirmation dialog, or both. Presses are
  // ignored until it settles. If it ends by leaving the screen, it calls `leave(go)` instead of
  // navigating directly, so the lock stays on while the screen animates away.
  async function run(action: (leave: (go: () => void) => void) => Promise<void>) {
    if (busy.current) {
      return;
    }
    busy.current = true;
    try {
      await action((go) => {
        left.current = true;
        go();
      });
    } finally {
      // try/finally: released even if the action throws, so one failure can't lock the screen.
      if (!left.current) {
        busy.current = false;
      }
    }
  }

  return { navigate, run };
}

// The guard's type, for passing it to a child component (see components/sheet.tsx).
export type PressGuard = ReturnType<typeof usePressGuard>;
