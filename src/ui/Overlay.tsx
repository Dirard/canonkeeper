import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react';
import type { PresenceStatus } from './use-presence';

export type OverlayKind = 'dialog' | 'drawer' | 'sheet' | 'menu' | 'fullscreen';

interface OverlayProps {
  children: ReactNode;
  kind: OverlayKind;
  label: string;
  onDismiss: () => void;
  /** Enter/exit animation phase; drives the global motion CSS via data-state. */
  state?: PresenceStatus;
}

export function Overlay({ children, kind, label, onDismiss, state = 'open' }: OverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const siblings = [...document.body.children].filter((node) => node !== rootRef.current?.parentElement);
    siblings.forEach((node) => node.setAttribute('aria-hidden', 'true'));

    const firstFocusable = rootRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (firstFocusable ?? rootRef.current)?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      siblings.forEach((node) => node.removeAttribute('aria-hidden'));
      previousFocus?.focus();
    };
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onDismiss();
    }
  }

  const role = kind === 'menu' ? 'menu' : 'dialog';

  return (
    <div
      aria-label={label}
      aria-modal={kind === 'menu' ? undefined : true}
      data-kind={kind}
      data-state={state}
      onKeyDown={handleKeyDown}
      ref={rootRef}
      role={role}
      tabIndex={-1}
    >
      {children}
    </div>
  );
}
