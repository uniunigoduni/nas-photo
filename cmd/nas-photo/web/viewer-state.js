/* State transferred when a viewer is split or returned to a single screen. */
const VIEW_PREFERENCE_KEYS = [
  'sort', 'subSort', 'randomSeed', 'order', 'filter', 'filterCondition',
  'layout', 'size', 'loop', 'muted'
];

function captureViewState({preservePlaybackPosition = false} = {}) {
  if (embeddedMode && !state.viewReady) return null;
  const pane = $('.viewer .pane[data-pane="0"]');
  const image = pane ? $('.zoomable', pane) : null;
  const video = pane ? $('video', pane) : null;
  const preferences = Object.fromEntries(VIEW_PREFERENCE_KEYS.map(key => [key, state[key]]));
  const snapshot = {
    media: state.viewer[0] || '',
    language: state.language,
    preferences,
    galleryScrollY: state.viewer[0] ? state.viewerScrollY : window.scrollY
  };
  if (image) {
    const rendered = containedImageSize(pane, image);
    const zoom = state.zoom[0];
    snapshot.zoom = {
      scale: zoom.scale,
      relativeX: zoom.x / Math.max(1, rendered.width),
      relativeY: zoom.y / Math.max(1, rendered.height)
    };
  }
  if (video) {
    preferences.muted = video.muted;
    preferences.loop = video.loop;
    snapshot.video = {paused: video.paused, volume: video.volume, playbackRate: video.playbackRate};
    // Only the original left screen retains its position during reconstruction.
    if (preservePlaybackPosition) snapshot.video.currentTime = video.currentTime;
  }
  return snapshot;
}

function readEmbeddedViewState() {
  if (!embeddedMode || !location.hash.startsWith('#view=')) return null;
  try {
    const snapshot = JSON.parse(decodeURIComponent(location.hash.slice(6)));
    return snapshot && typeof snapshot === 'object' && typeof snapshot.media === 'string' ? snapshot : null;
  } catch {
    return null;
  }
}

function applyViewPreferences(snapshot) {
  if (!snapshot) return;
  for (const key of VIEW_PREFERENCE_KEYS) {
    const value = snapshot.preferences?.[key];
    if (typeof value === typeof state[key]) state[key] = value;
  }
  if (snapshot.language === 'ja' || snapshot.language === 'en') {
    state.language = snapshot.language;
    document.documentElement.lang = state.language;
  }
}

async function restoreViewState(snapshot) {
  if (!snapshot) return;
  while (snapshot.media && !findItem(snapshot.media) && state.nextOffset >= 0) {
    if (!await loadNextPage()) break;
  }
  if (!snapshot.media || !findItem(snapshot.media)) {
    leaveViewer();
    requestAnimationFrame(() => window.scrollTo(0, Math.max(0, Number(snapshot.galleryScrollY) || 0)));
    return;
  }
  openViewer(snapshot.media);
  state.viewerScrollY = Math.max(0, Number(snapshot.galleryScrollY) || 0);
  restoreViewerZoom(snapshot);
  restoreViewerVideo(snapshot);
}

function restoreViewerZoom(snapshot) {
  if (!snapshot.zoom) return;
  const pane = $('.viewer .pane[data-pane="0"]');
  const image = pane ? $('.zoomable', pane) : null;
  if (!image) return;
  const item = findItem(snapshot.media);
  let restoredZoom;
  const apply = () => {
    if (!pane.isConnected || state.viewer[0] !== snapshot.media) return;
    if (restoredZoom && state.zoom[0] !== restoredZoom) return;
    const rendered = containedMediaSize(pane.clientWidth, pane.clientHeight,
      image.naturalWidth || item.width, image.naturalHeight || item.height);
    const scale = clampValue(Number(snapshot.zoom.scale) || 1, 1, MAX_IMAGE_ZOOM);
    const maxX = Math.max(0, (rendered.width * scale - pane.clientWidth) / 2);
    const maxY = Math.max(0, (rendered.height * scale - pane.clientHeight) / 2);
    restoredZoom = {
      scale,
      x: clampValue((Number(snapshot.zoom.relativeX) || 0) * rendered.width, -maxX, maxX),
      y: clampValue((Number(snapshot.zoom.relativeY) || 0) * rendered.height, -maxY, maxY)
    };
    state.zoom[0] = restoredZoom;
    applyImageZoom(image, restoredZoom);
  };
  apply();
  if (!image.complete) image.addEventListener('load', apply, {once:true});
}

function restoreViewerVideo(snapshot) {
  if (!snapshot.video) return;
  const video = $('.viewer .pane[data-pane="0"] video');
  if (!video) return;
  video.pause();
  const apply = () => {
    if (!video.isConnected || state.viewer[0] !== snapshot.media) return;
    video.volume = clampValue(Number(snapshot.video.volume) || 0, 0, 1);
    video.playbackRate = clampValue(Number(snapshot.video.playbackRate) || 1, 0.0625, 16);
    if (Number.isFinite(snapshot.video.currentTime)) {
      const end = Number.isFinite(video.duration) ? video.duration : snapshot.video.currentTime;
      video.currentTime = clampValue(snapshot.video.currentTime, 0, Math.max(0, end));
    }
    if (!snapshot.video.paused) video.play().catch(() => {});
  };
  if (video.readyState >= 1) apply();
  else video.addEventListener('loadedmetadata', apply, {once:true});
}

function pauseSplitVideos() {
  $$('.split-window').forEach(frame => {
    frame.contentDocument?.querySelectorAll('video').forEach(video => video.pause());
  });
}

async function collapseSplit() {
  if (!state.split || state.splitTransition) return;
  state.splitTransition = true;
  const primary = $('.split-window-primary')?.contentWindow;
  const snapshot = primary?.captureViewState?.({preservePlaybackPosition:true}) || state.splitViewStates?.primary;
  pauseSplitVideos();
  try {
    applyViewPreferences(snapshot);
    await showGallery();
    state.split = false;
    if (snapshot) await restoreViewState(snapshot);
    else if (state.viewer[0]) renderViewer();
    else leaveViewer();
  } catch (reason) {
    state.split = false;
    if (state.viewer[0] && findItem(state.viewer[0])) renderViewer();
    else leaveViewer();
    const status = $('#job-status');
    if (status) {
      status.hidden = false;
      status.textContent = reason.message;
    }
  } finally {
    state.splitTransition = false;
    state.splitViewStates = null;
  }
}
