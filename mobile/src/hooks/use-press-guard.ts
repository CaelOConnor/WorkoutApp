import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

// Stops a double tap from opening two screens, sending two requests or showing two dialogs.
// One guard per screen, so while anything on it runs, every other press is ignored too.
export function usePressGuard() {
  // A ref, not state: state only updates on the next render, too late for a fast second tap.
  const busy = useRef(false);
  // Screens stay mounted under the next one, so after leaving, the lock holds until shown again.
  const left = useRef(false);

  // Runs when the screen appears and whenever the user comes back to it. Without useCallback,
  // useFocusEffect would re-run on every render.
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

  // For an async press. Ending with leave(go) instead of navigating directly keeps the lock on
  // while the screen animates away.
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
      // Released even if the action throws, so one failure can't lock the screen.
      if (!left.current) {
        busy.current = false;
      }
    }
  }

  return { navigate, run };
}

// The guard's type, for passing it to a child component (see components/sheet.tsx).
export type PressGuard = ReturnType<typeof usePressGuard>;
