import { it, expect } from 'vitest';
import { assertRenderingAvailable } from './index';
it('does not fabricate official forms', () =>
  expect(assertRenderingAvailable).toThrow('NOT_IMPLEMENTED'));
