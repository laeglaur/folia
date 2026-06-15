globalThis.window = {
  localStorage: {
    getItem: () => null,
    setItem: () => {}
  }
};
globalThis.document = {
  createElement: () => {
    throw new Error('document.createElement should not be needed for this smoke test');
  }
};
Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: () => 'smoke-id'
  }
});

const stateModule = await import(new URL('../dist-test/state.js', import.meta.url).href);
const { createInitialState, createQueuedPersistenceSaver } = stateModule;

const baseState = createInitialState();
const olderState = {
  ...baseState,
  pages: baseState.pages.map((page) => ({ ...page, title: 'older snapshot' }))
};
const latestState = {
  ...baseState,
  pages: baseState.pages.map((page) => ({ ...page, title: 'latest snapshot' }))
};

const events = [];
let firstWriteStarted = false;
let releaseFirstWrite;
const firstWriteReleased = new Promise((resolve) => {
  releaseFirstWrite = resolve;
});

const saver = createQueuedPersistenceSaver({
  persistNativeSnapshot: async (stateJson) => {
    const state = JSON.parse(stateJson);
    events.push({ kind: 'write', title: state.pages[0]?.title });
    if (!firstWriteStarted) {
      firstWriteStarted = true;
      await firstWriteReleased;
    }
  },
  cleanupNativeAttachments: async (state) => {
    events.push({ kind: 'cleanup', title: state.pages[0]?.title });
  },
  persistBrowserSnapshot: () => {
    throw new Error('browser persistence should not be used in Tauri smoke mode');
  }
});

globalThis.__TAURI_INTERNALS__ = {};
globalThis.isTauri = true;

const olderSave = saver.saveState(olderState);
await new Promise((resolve) => setTimeout(resolve, 0));
const latestSave = saver.saveState(latestState);
releaseFirstWrite();
await Promise.all([olderSave, latestSave]);

const checks = {
  writesAreSerialized: events.filter((event) => event.kind === 'write').map((event) => event.title).join(' -> ') === 'older snapshot -> latest snapshot',
  staleCleanupSkipped: !events.some((event) => event.kind === 'cleanup' && event.title === 'older snapshot'),
  latestCleanupRuns: events.some((event) => event.kind === 'cleanup' && event.title === 'latest snapshot'),
  latestWriteLast: [...events].reverse().find((event) => event.kind === 'write')?.title === 'latest snapshot'
};

console.log(JSON.stringify({ checks, events }, null, 2));

if (Object.values(checks).some((value) => !value)) {
  process.exit(1);
}
