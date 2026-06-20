import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Overlay } from './Overlay';

describe('Overlay', () => {
  it('enters focus, locks scroll, dismisses with Escape and returns focus', () => {
    const onDismiss = vi.fn();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">
            Open overlay
          </button>
          {open ? (
            <Overlay
              kind="dialog"
              label="Rename chat"
              onDismiss={() => {
                onDismiss();
                setOpen(false);
              }}
            >
              <button type="button">Save</button>
            </Overlay>
          ) : null}
        </>
      );
    }

    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Open overlay' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Rename chat' });
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe('');
  });
});
