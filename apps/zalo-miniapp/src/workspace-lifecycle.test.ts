import { expect, it } from 'vitest';
import { WorkspaceLifecycle } from './workspace-lifecycle';
it('preserves edits made while an evidence refresh is in flight', () => {
  const state = new WorkspaceLifecycle();
  state.mount();
  const refresh = state.beginLoad();
  state.edited();
  expect(state.accepts(refresh)).toBe(true);
  expect(state.mayReplaceDraft(refresh, false)).toBe(false);
  expect(state.mayReplaceDraft(refresh, true)).toBe(false);
  const next = state.beginLoad();
  expect(state.mayReplaceDraft(next, false)).toBe(false);
  state.discarded();
  expect(state.mayReplaceDraft(state.beginLoad(), false)).toBe(true);
});
it('rejects stale responses from another dossier lifecycle and older overlapping refreshes', () => {
  const state = new WorkspaceLifecycle();
  state.mount();
  const oldDossier = state.beginLoad();
  state.unmount();
  state.mount();
  expect(state.accepts(oldDossier)).toBe(false);
  const first = state.beginLoad(),
    second = state.beginLoad();
  expect(state.accepts(first)).toBe(false);
  expect(state.accepts(second)).toBe(true);
  state.unmount();
  expect(state.accepts(second)).toBe(false);
});
it('blocks repeated action dispatches before React has rerendered', () => {
  const state = new WorkspaceLifecycle();
  expect(state.startAction()).toBe(false);
  state.mount();
  expect(state.startAction()).toBe(true);
  expect(state.startAction()).toBe(false);
  state.finishAction();
  expect(state.startAction()).toBe(true);
});
it('keeps the declaration If-Match base version until the user explicitly discards and reloads', () => {
  const state = new WorkspaceLifecycle();
  state.mount();
  expect(state.adopt(state.beginLoad(), true, 4)).toBe(true);
  state.edited();
  expect(state.adopt(state.beginLoad(), false, 5)).toBe(false);
  expect(state.baseVersion).toBe(4);
  state.discarded();
  expect(state.adopt(state.beginLoad(), true, 5)).toBe(true);
  expect(state.baseVersion).toBe(5);
});
it('prevents a late SDK token from starting another exchange after the Mini App unmounts', async () => {
  const state = new WorkspaceLifecycle();
  state.mount();
  const action = state.beginLoad();
  let finish: () => void = () => {};
  const sdk = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let exchanges = 0;
  const continuation = sdk.then(() => {
    if (state.accepts(action)) exchanges++;
  });
  state.unmount();
  finish();
  await continuation;
  expect(exchanges).toBe(0);
});
