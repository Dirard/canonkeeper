import { describe, expect, it } from 'vitest';
import { ApiStatusError, NetworkApiError, type ApiProblem } from '../shared/api';
import { classifyAuthFailure } from '../entities/session/api';

function statusError(status: number, detail?: string) {
  const problem: ApiProblem = {
    type: 'about:blank',
    title: `Status ${status}`,
    status,
    detail,
    code: `status_${status}`,
    requestId: 'req_test',
  };
  return new ApiStatusError(status, problem, new Response(null, { status }));
}

describe('classifyAuthFailure', () => {
  it('keeps auth failures distinguishable by status and network shape', () => {
    expect(classifyAuthFailure(statusError(401), 'fallback')).toMatchObject({ kind: 'unauthorized' });
    expect(classifyAuthFailure(statusError(403), 'fallback')).toMatchObject({ kind: 'forbidden' });
    expect(classifyAuthFailure(statusError(500), 'fallback')).toMatchObject({ kind: 'server' });
    expect(classifyAuthFailure(new NetworkApiError(new Error('down')), 'fallback')).toMatchObject({ kind: 'network' });
    expect(classifyAuthFailure(statusError(418, 'teapot'), 'fallback')).toMatchObject({
      kind: 'unknown',
      message: 'fallback',
    });
  });
});
