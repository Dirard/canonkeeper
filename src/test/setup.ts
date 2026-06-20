import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { mswServer } from './msw/server';

beforeAll(() => {
  mswServer.listen({ onUnhandledRequest: 'bypass' });
  installBrowserGeometryPolyfills();
});

afterEach(() => {
  mswServer.resetHandlers();
  cleanup();
});

afterAll(() => {
  mswServer.close();
});

function installBrowserGeometryPolyfills() {
  const rect = {
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    toJSON: () => ({}),
    top: 0,
    width: 0,
    x: 0,
    y: 0,
  } as DOMRect;

  document.elementFromPoint = document.elementFromPoint ?? (() => document.body);
  HTMLElement.prototype.getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect ?? (() => rect);
  HTMLElement.prototype.getClientRects = HTMLElement.prototype.getClientRects ?? (() => [rect] as unknown as DOMRectList);
  Range.prototype.getBoundingClientRect = Range.prototype.getBoundingClientRect ?? (() => rect);
  Range.prototype.getClientRects = Range.prototype.getClientRects ?? (() => [rect] as unknown as DOMRectList);
  if (typeof Text !== 'undefined') {
    (Text.prototype as unknown as { getBoundingClientRect?: () => DOMRect }).getBoundingClientRect ??= () => rect;
    (Text.prototype as unknown as { getClientRects?: () => DOMRectList }).getClientRects ??= () => [rect] as unknown as DOMRectList;
  }
}
