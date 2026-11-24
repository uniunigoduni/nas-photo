import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const runtimeSource = fs.readFileSync(new URL('../cmd/nas-photo/web/runtime.js', import.meta.url), 'utf8');
const gallerySource = fs.readFileSync(new URL('../cmd/nas-photo/web/gallery.js', import.meta.url), 'utf8');
const viewerSource = fs.readFileSync(new URL('../cmd/nas-photo/web/viewer.js', import.meta.url), 'utf8');
const viewerStateSource = fs.readFileSync(new URL('../cmd/nas-photo/web/viewer-state.js', import.meta.url), 'utf8');

function extractSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `slice not found: ${startMarker} -> ${endMarker}`);
  return source.slice(start, end);
}

const runtimeCoreSlice = extractSlice(
  runtimeSource,
  'function hasBlockingDialogOpen()',
  'window.addEventListener(\'resize\''
);
const galleryScrollSlice = extractSlice(
  gallerySource,
  'const GALLERY_SCROLL_SPEED_PX_PER_SEC = 1400;',
  'function connectGalleryShell()'
);
const toggleSplitSlice = extractSlice(
  viewerSource,
  'function toggleSplit()',
  'function embeddedURL('
);
const restoreStateSlice = extractSlice(
  viewerStateSource,
  'async function restoreViewState(snapshot)',
  'function restoreViewerZoom('
);

function createRuntimeHarness({
  embeddedMode = false,
  embeddedRole = '',
  split = false,
  viewerId = null,
  hasGallery = true,
  dialogOpen = false,
  toolbarPopup = null
} = {}) {
  const docListeners = new Map();
  const winListeners = new Map();
  const calls = {
    move: [],
    startHold: [],
    stopHold: [],
    postParent: [],
    postPrimary: [],
    postSecondary: [],
    toggleSplit: 0
  };
  const primaryFrame = {contentWindow: {postMessage: (msg, origin) => calls.postPrimary.push({msg, origin})}};
  const secondaryFrame = {contentWindow: {postMessage: (msg, origin) => calls.postSecondary.push({msg, origin})}};
  const state = {
    shortcuts: {prev1: 'KeyQ', next1: 'KeyW', prev2: 'KeyA', next2: 'KeyS', loop: 'KeyL', mute: 'KeyM', splitToggle: 'KeyE'},
    viewer: [viewerId, null],
    split,
    loop: true,
    muted: false,
    activePane: 0
  };
  const ctx = {
    state,
    embeddedMode,
    embeddedRole,
    toolbarPopup,
    location: {origin: 'http://localhost:9070'},
    parent: {postMessage: (msg, origin) => calls.postParent.push({msg, origin})},
    document: {
      hidden: false,
      activeElement: {tagName: 'BODY'},
      addEventListener(type, fn) { docListeners.set(type, fn); }
    },
    window: {
      addEventListener(type, fn) { winListeners.set(type, fn); }
    },
    $: selector => {
      if (selector === '#gallery') return hasGallery ? {id: 'gallery'} : null;
      if (selector === '.split-window[data-role="primary"]') return primaryFrame;
      if (selector === '.split-window[data-role="secondary"]') return secondaryFrame;
      return null;
    },
    $$: selector => {
      if (selector === 'm3e-dialog') return dialogOpen ? [{open: true}] : [];
      return [];
    },
    move: (pane, delta) => calls.move.push({pane, delta}),
    startGalleryHold: delta => { calls.startHold.push(delta); return true; },
    stopGalleryHold: delta => { calls.stopHold.push(delta); },
    toggleSplit: () => { calls.toggleSplit += 1; },
    toggleMuted: () => {},
    applyMuted: () => {},
    savePreferences: () => {},
    syncVideoOptionButtons: () => {},
    leaveViewerWithTransition: () => {}
  };
  vm.runInNewContext(runtimeCoreSlice, ctx);
  function press(code, repeat = false) {
    let prevented = false;
    docListeners.get('keydown')({code, repeat, preventDefault() { prevented = true; }});
    return prevented;
  }
  function release(code) {
    docListeners.get('keyup')({code});
  }
  function blur() {
    winListeners.get('blur')();
  }
  function message(data, origin = 'http://localhost:9070') {
    winListeners.get('message')({data, origin});
  }
  return {state, calls, press, release, blur, message};
}

test('single-screen shortcuts start/stop gallery scroll without OS repeat delay, while viewer still repeats', () => {
  const gallery = createRuntimeHarness({viewerId: null, hasGallery: true});
  assert.equal(gallery.press('KeyW', false), true);
  assert.equal(gallery.press('KeyW', true), true);
  gallery.release('KeyW');
  assert.deepEqual(gallery.calls.startHold, [1]);
  assert.deepEqual(gallery.calls.stopHold, [1]);
  assert.deepEqual(gallery.calls.move, []);

  const viewer = createRuntimeHarness({viewerId: 'm1', hasGallery: true});
  assert.equal(viewer.press('KeyW', false), true);
  assert.equal(viewer.press('KeyW', true), true);
  viewer.release('KeyW');
  assert.deepEqual(viewer.calls.move, [{pane: 0, delta: 1}, {pane: 0, delta: 1}]);
  assert.deepEqual(viewer.calls.startHold, []);
});

test('split screen routes start/repeat/stop phases to primary and secondary frames independently', () => {
  const host = createRuntimeHarness({split: true, viewerId: null});
  assert.equal(host.press('KeyW', false), true);
  host.release('KeyW');
  assert.equal(host.press('KeyA', false), true);
  host.blur();
  assert.deepEqual(host.calls.postPrimary.map(e => ({...e.msg})), [
    {type: 'navigate', delta: 1, phase: 'start'},
    {type: 'navigate', delta: 1, phase: 'stop'},
    {type: 'navigate', delta: 0, phase: 'stop'}
  ]);
  assert.deepEqual(host.calls.postSecondary.map(e => ({...e.msg})), [
    {type: 'navigate', delta: -1, phase: 'start'},
    {type: 'navigate', delta: 0, phase: 'stop'}
  ]);

  const primary = createRuntimeHarness({embeddedMode: true, embeddedRole: 'primary', viewerId: null});
  assert.equal(primary.press('KeyW', false), true);
  assert.equal(primary.press('KeyS', false), true);
  primary.release('KeyS');
  assert.deepEqual(primary.calls.startHold, [1]);
  assert.deepEqual(primary.calls.postParent.map(e => ({...e.msg})), [
    {type: 'navigateSecondary', delta: 1, phase: 'start'},
    {type: 'navigateSecondary', delta: 1, phase: 'stop'}
  ]);

  const secondary = createRuntimeHarness({embeddedMode: true, embeddedRole: 'secondary', viewerId: null});
  secondary.message({type: 'navigate', delta: 1, phase: 'start'});
  secondary.message({type: 'navigate', delta: 1, phase: 'repeat'});
  secondary.message({type: 'navigate', delta: 1, phase: 'stop'});
  assert.deepEqual(secondary.calls.startHold, [1]);
  assert.deepEqual(secondary.calls.stopHold, [1]);

  const secondaryViewer = createRuntimeHarness({embeddedMode: true, embeddedRole: 'secondary', viewerId: 'm9'});
  secondaryViewer.message({type: 'navigate', delta: 1, phase: 'start'});
  secondaryViewer.message({type: 'navigate', delta: 1, phase: 'repeat'});
  assert.deepEqual(secondaryViewer.calls.move, [{pane: 0, delta: 1}, {pane: 0, delta: 1}]);
});

test('blocking dialogs suppress start but still allow stop messages to clear holds', () => {
  const modal = createRuntimeHarness({viewerId: null, dialogOpen: true});
  assert.equal(modal.press('KeyW'), false);
  assert.deepEqual(modal.calls.startHold, []);

  const settingsPopover = createRuntimeHarness({
    viewerId: null,
    toolbarPopup: {panel: {disableClose: true}}
  });
  assert.equal(settingsPopover.press('KeyW'), false);
  assert.deepEqual(settingsPopover.calls.startHold, []);

  const embeddedModal = createRuntimeHarness({embeddedMode: true, embeddedRole: 'secondary', viewerId: null, dialogOpen: true});
  embeddedModal.message({type: 'navigate', delta: 1, phase: 'start'});
  embeddedModal.message({type: 'navigate', delta: 1, phase: 'stop'});
  assert.deepEqual(embeddedModal.calls.startHold, []);
  assert.deepEqual(embeddedModal.calls.stopHold, [1]);
});

test('gallery scroll moves immediately at constant speed while held and stops immediately on release without snapping', () => {
  const winListeners = new Map();
  let now = 1000;
  let nextFrameId = 1;
  const frames = new Map();
  let riverRenders = 0;
  const state = {
    layout: 'river',
    items: Array.from({length: 18}, (_, i) => ({id: `i${i}`})),
    nextOffset: -1,
    galleryMeasuredWidth: 800
  };
  const gallery = {clientWidth: 800};
  const ctx = {
    state,
    performance: {now: () => now},
    requestAnimationFrame(fn) {
      const id = nextFrameId++;
      frames.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
    document: {
      body: {classList: {contains: () => false}},
      documentElement: {scrollHeight: 1600}
    },
    window: {
      scrollX: 0,
      scrollY: 0,
      innerHeight: 600,
      scrollTo(opts) { ctx.window.scrollY = Math.min(1000, Math.max(0, opts.top)); },
      addEventListener(type, fn) { winListeners.set(type, fn); }
    },
    $: selector => (selector === '#gallery' ? gallery : null),
    loadNextPage: async () => false,
    renderVisibleRiverRows: () => { riverRenders += 1; },
    scheduleRiverLayout: () => {},
    scheduleRiverWindow: () => {}
  };
  const api = vm.runInNewContext(galleryScrollSlice + '\n;({startGalleryHold, stopGalleryHold, cancelGalleryScroll})', ctx);

  function tick(ms) {
    now += ms;
    const batch = [...frames.entries()];
    frames.clear();
    for (const [, fn] of batch) fn(now);
  }

  // Immediate first-frame movement with zero initial delay (1400px/s * 16ms = 22.4px).
  assert.equal(api.startGalleryHold(1), true);
  assert.ok(Math.abs(ctx.window.scrollY - 22.4) < 0.01);
  assert.equal(riverRenders, 1);

  // Constant speed over 10 frames (10 * 22.4 = 224px -> total 246.4px).
  for (let i = 0; i < 10; i++) tick(16);
  assert.ok(Math.abs(ctx.window.scrollY - 246.4) < 0.05);

  // Release stops immediately at the exact current position without snapping.
  const stoppedAt = ctx.window.scrollY;
  api.stopGalleryHold(1);
  assert.equal(frames.size, 0);
  tick(16);
  assert.equal(ctx.window.scrollY, stoppedAt);

  // Scrolling upward moves immediately at the same speed and clamps cleanly at 0.
  assert.equal(api.startGalleryHold(-1), true);
  assert.ok(Math.abs(ctx.window.scrollY - (stoppedAt - 22.4)) < 0.05);
  for (let i = 0; i < 20 && frames.size; i++) tick(16);
  assert.equal(ctx.window.scrollY, 0);
  assert.equal(frames.size, 0);

  // Wheel cancels an active hold immediately.
  assert.equal(api.startGalleryHold(1), true);
  assert.ok(frames.size > 0);
  winListeners.get('wheel')();
  assert.equal(frames.size, 0);
});

test('toggleSplit allows starting split view directly from the gallery and restoreViewState preserves scrollY', async () => {
  let rendered = 0;
  let closedPopup = 0;
  const state = {
    split: false,
    splitTransition: false,
    splitViewStates: null,
    viewer: [null, null],
    zoomAnimationCancel: [null, null],
    viewerScrollY: 0
  };
  const splitCtx = {
    state,
    embeddedMode: false,
    innerWidth: 1280,
    $: selector => selector === '#gallery' ? {id: 'gallery'} : null,
    closeToolbarPopup: () => { closedPopup += 1; },
    captureViewState: () => ({media: '', galleryScrollY: 420, preferences: {}}),
    applyViewPreferences: () => {},
    renderViewer: () => { rendered += 1; },
    collapseSplit: async () => {}
  };
  const {toggleSplit} = vm.runInNewContext(toggleSplitSlice + '\n;({toggleSplit})', splitCtx);
  toggleSplit();
  assert.equal(state.split, true);
  assert.equal(rendered, 1);
  assert.equal(closedPopup, 1);
  assert.equal(state.splitViewStates.primary.galleryScrollY, 420);

  let leftWithScrollY = null;
  const restoreCtx = {
    state: {nextOffset: -1, viewerScrollY: 0},
    findItem: () => null,
    loadNextPage: async () => false,
    leaveViewer: () => { leftWithScrollY = restoreCtx.state.viewerScrollY; },
    openViewer: () => {},
    restoreViewerZoom: () => {},
    restoreViewerVideo: () => {}
  };
  const {restoreViewState} = vm.runInNewContext(restoreStateSlice + '\n;({restoreViewState})', restoreCtx);
  await restoreViewState({media: '', galleryScrollY: 420});
  assert.equal(leftWithScrollY, 420);
});
