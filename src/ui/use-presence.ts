import { useEffect, useRef, useState } from 'react';

export type PresenceStatus = 'open' | 'closing';

interface Presence<T> {
  /** Whether the node should be rendered (stays true through the exit animation). */
  mounted: boolean;
  /** Drives the `data-state` attribute the global motion CSS keys off. */
  status: PresenceStatus;
  /** The last truthy value, retained during the exit animation so closing content does not blank out. */
  value: T | null;
}

function prefersReducedMotion(): boolean {
  // jsdom (tests) has no matchMedia — treat that, and an explicit reduce
  // preference, as "no exit animation" so the node unmounts synchronously.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Keeps a conditionally-rendered overlay mounted for the duration of its exit
 * animation. Pass the same value that gates rendering (a boolean, or the entity
 * the overlay shows); render while `mounted`, spread `status` onto `data-state`,
 * and read `value` instead of the source state so closing content stays stable.
 */
export function usePresence<T>(value: T | null | undefined | false, durationMs = 220): Presence<T> {
  const active = value !== null && value !== undefined && value !== false;
  const [status, setStatus] = useState<'open' | 'closing' | 'closed'>(active ? 'open' : 'closed');
  const retained = useRef<T | null>(active ? (value as T) : null);
  if (active) {
    retained.current = value as T;
  }

  useEffect(() => {
    if (active) {
      setStatus('open');
      return;
    }
    if (prefersReducedMotion()) {
      setStatus('closed');
      return;
    }
    setStatus('closing');
    const timer = window.setTimeout(() => setStatus('closed'), durationMs);
    return () => window.clearTimeout(timer);
  }, [active, durationMs]);

  return {
    mounted: status !== 'closed',
    status: status === 'closing' ? 'closing' : 'open',
    value: retained.current,
  };
}
