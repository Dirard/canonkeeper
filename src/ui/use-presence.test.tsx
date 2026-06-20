import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { usePresence } from './use-presence';

function Harness({ open }: { open: boolean }) {
  const presence = usePresence(open);
  if (!presence.mounted) {
    return <p>closed</p>;
  }
  return <p data-state={presence.status}>open</p>;
}

describe('usePresence', () => {
  it('mounts immediately when the value is active', () => {
    render(<Harness open />);
    expect(screen.getByText('open').getAttribute('data-state')).toBe('open');
  });

  it('unmounts synchronously when matchMedia is unavailable (jsdom / reduced motion)', () => {
    // jsdom does not implement matchMedia, so exit collapses to instant.
    const { rerender } = render(<Harness open />);
    expect(screen.queryByText('open')).not.toBeNull();

    act(() => {
      rerender(<Harness open={false} />);
    });

    expect(screen.queryByText('open')).toBeNull();
    expect(screen.queryByText('closed')).not.toBeNull();
  });

  it('retains the last truthy value while mounted', () => {
    function ValueHarness() {
      const [value] = useState<string | null>('chapter-7');
      const presence = usePresence(value);
      return presence.mounted ? <p>{presence.value}</p> : <p>gone</p>;
    }

    render(<ValueHarness />);
    expect(screen.queryByText('chapter-7')).not.toBeNull();
  });
});
