function findItem(id) {
  return state.items.find(item => item.id === id) ||
    state.viewerItems.find(item => item?.id === id && state.viewer.includes(id));
}

function syncViewerGalleryItems(previousItems = state.items) {
  if (!state.viewer.some(Boolean)) return;
  const byID = new Map(state.items.map(item => [item.id, item]));
  state.viewer.forEach((id, paneIndex) => {
    if (!id) return;
    if (byID.has(id)) state.viewerItems[paneIndex] = byID.get(id);
    const index = state.items.findIndex(item => item.id === id);
    const oldIndex = previousItems.findIndex(item => item.id === id);
    const neighbors = state.viewerNeighbors[paneIndex];
    for (const [direction, delta] of [['previous', -1], ['next', 1]]) {
      let neighbor = index >= 0 ? state.items[index + delta] : null;
      // Keep navigation usable when the displayed file leaves the library.
      if (index < 0 && oldIndex >= 0) {
        for (let position = oldIndex + delta; position >= 0 && position < previousItems.length; position += delta) {
          neighbor = byID.get(previousItems[position].id);
          if (neighbor) break;
        }
      } else if (index < 0) {
        neighbor = byID.get(neighbors[direction]?.id);
      }
      neighbors[direction] = neighbor || null;
      const slide = $(`.viewer .pane[data-pane="${paneIndex}"] .swipe-slide-${direction}`);
      if (!slide) continue;
      const key = neighbor ? `${neighbor.id}:${mediaThumbnailURL(neighbor)}` : '';
      slide.dataset.available = String(Boolean(neighbor));
      if (slide.dataset.previewKey === key) continue;
      slide.dataset.previewKey = key;
      slide.innerHTML = swipePreviewHTML(neighbor);
    }
    const pane = $(`.viewer .pane[data-pane="${paneIndex}"]`);
    if (pane) fitSwipePreviews(pane);
  });
}

// A browser View Transition rasterizes and composites snapshots of the old
// and new media. This becomes very expensive with GPU compositing disabled.
// Move ONE already decoded thumbnail instead; no snapshots or full-screen fade.
let activePhotoMorph = null;

function photoMorphEnabled(image) {
  return !embeddedMode && !document.hidden &&
    !!image?.complete && image.naturalWidth > 0;
}

function visibleGalleryImage(id) {
  const tile = $(`.tile[data-id="${CSS.escape(id)}"]`);
  if (!tile) return null;
  const image = $('img:not([data-thumbnail-pending])', tile);
  if (!photoMorphEnabled(image)) return null;
  const rect = image.getBoundingClientRect();
  if (rect.bottom <= 0 || rect.top >= innerHeight ||
      rect.right <= 0 || rect.left >= innerWidth) return null;
  return image;
}

function viewerPhotoRect(item, pane, image = null) {
  if (!item || !pane) return null;
  const dimensions = [
    // Match the pixels being animated, even when cached index metadata
    // still has the orientation from before an EXIF rotation.
    [image?.naturalWidth, image?.naturalHeight],
    [Number(item.width), Number(item.height)]
  ].find(([width, height]) => width > 0 && height > 0);
  if (!dimensions) return null;
  const rect = pane.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const size = containedMediaSize(rect.width, rect.height, ...dimensions);
  return {
    left: rect.left + (rect.width - size.width) / 2,
    top: rect.top + (rect.height - size.height) / 2,
    width: size.width,
    height: size.height
  };
}

// Animate only an inexpensive thumbnail. Animating the geometry of a single
// position:fixed element avoids the multi-snapshot software-compositing path.
// object-fit:cover smoothly uncrops a square tile as its bounds become the
// actual aspect ratio of the full viewer image.
function animateGalleryPhoto(source, from, to, hiddenTarget = null, reverse = false) {
  if (!source?.src || !from || !to) return false;
  activePhotoMorph?.cancel();

  const ghost = document.createElement('img');
  ghost.className = 'nas-photo-photo-morph';
  ghost.alt = '';
  ghost.draggable = false;
  ghost.decoding = 'async';
  ghost.src = source.currentSrc || source.src;
  const pixels = rect => ({
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  });
  Object.assign(ghost.style, pixels(from));
  const tile = source.closest('.tile');
  const tileRadius = tile ? getComputedStyle(tile).borderRadius : '0px';
  const fromRadius = reverse ? '0px' : tileRadius;
  const toRadius = reverse ? tileRadius : '0px';
  ghost.style.borderRadius = fromRadius;
  document.body.append(ghost);

  const previousVisibility = hiddenTarget?.style.visibility;
  if (hiddenTarget) hiddenTarget.style.visibility = 'hidden';
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    ghost.remove();
    if (hiddenTarget) hiddenTarget.style.visibility = previousVisibility;
    if (activePhotoMorph?.cancel === cancel) activePhotoMorph = null;
  };
  let animation;
  const cancel = () => animation?.cancel();
  try {
    const settings = getComputedStyle(document.documentElement);
    const duration = cssTimeMilliseconds(settings.getPropertyValue('--nas-gallery-photo-morph-duration')) || 180;
    const easing = settings.getPropertyValue('--nas-gallery-photo-morph-easing').trim() || 'ease-out';
    animation = ghost.animate([
      {...pixels(from), borderRadius: fromRadius},
      {...pixels(to), borderRadius: toRadius}
    ], {duration, easing, fill:'forwards'});
    activePhotoMorph = {cancel};
    animation.addEventListener('finish', cleanup, {once:true});
    animation.addEventListener('cancel', cleanup, {once:true});
    return true;
  } catch {
    cleanup();
    return false;
  }
}

function openViewerFromTile(tile) {
  const id = tile?.dataset.id;
  if (!id) return;
  state.viewerTransitionSourceId = id;
  const item = findItem(id);
  const source = $('img:not([data-thumbnail-pending])', tile);
  // A video or unloaded thumbnail opens directly without an image morph.
  if (item?.kind !== 'image' || !photoMorphEnabled(source)) {
    activePhotoMorph?.cancel();
    openViewer(id, 0);
    return;
  }

  const from = source.getBoundingClientRect();
  openViewer(id, 0);
  const pane = $('.viewer .swipe-slide-current', app)?.closest('.pane');
  const to = viewerPhotoRect(item, pane, source);
  const stage = $('.viewer .swipe-slide-current .viewer-image-stage', app);
  animateGalleryPhoto(source, from, to, stage);
}

function leaveViewerWithTransition() {
  const id = state.viewer[0];
  const item = findItem(id);
  const thumbnail = id === state.viewerTransitionSourceId
    ? visibleGalleryImage(id) : null;
  const pane = $('.viewer .swipe-slide-current', app)?.closest('.pane');
  const from = viewerPhotoRect(item, pane, thumbnail);
  const to = thumbnail?.getBoundingClientRect();

  if (!thumbnail || item?.kind !== 'image' || state.split ||
      state.zoom[0].scale > 1.001 || !from || !to) {
    activePhotoMorph?.cancel();
    leaveViewer();
    return;
  }
  leaveViewer();
  animateGalleryPhoto(thumbnail, from, to, thumbnail, true);
}

function takeViewerSwipePreview(paneIndex, delta) {
  const pane = $(`.viewer .pane[data-pane="${paneIndex}"]`);
  if (!pane) return null;
  const slide = delta < 0 ? '.swipe-slide-previous' : '.swipe-slide-next';
  const preview = $(`${slide} .swipe-preview`, pane);
  if (!preview) return null;
  preview.remove();
  return preview;
}

function installRetainedViewerPreview(root, preview) {
  if (!preview) return;
  const placeholder = $('.viewer-image-placeholder', root);
  if (!placeholder) return;
  preview.className = 'media viewer-image-placeholder';
  preview.removeAttribute('data-media-width');
  preview.removeAttribute('data-media-height');
  preview.removeAttribute('style');
  preview.style.transform = placeholder.style.transform;
  preview.alt = '';
  preview.draggable = false;
  placeholder.replaceWith(preview);
}

function openViewer(id, paneIndex = 0, swipeOffset = 0, swipeVelocity = 0, retainedPreview = null) {
  hideTooltip();
  state.viewerItems[paneIndex] = findItem(id) || null;
  state.viewer[paneIndex] = id;
  state.activePane = paneIndex;
  state.zoomAnimationCancel[paneIndex]?.();
  state.zoomAnimationCancel[paneIndex] = null;
  state.zoom[paneIndex] = {scale:1, x:0, y:0};
  state.swipeOffset[paneIndex] = swipeOffset;
  state.swipeVelocity[paneIndex] = swipeVelocity;
  if (embeddedMode && embeddedRole === 'primary') {
    parent.postMessage({type:'primaryMedia', id}, location.origin);
  }
  const surface = $('.viewer .split-surface');
  if (surface && paneIndex === 0) {
    updateViewerPane(surface, 0, retainedPreview, true);
    return;
  }
  renderViewer();
}

function renderViewer() {
  const split = state.split && !embeddedMode && innerWidth >= 768;
  let layer = $('.viewer-layer', app);
  if (!layer) {
    state.viewerScrollY = window.scrollY;
    layer = document.createElement('div');
    layer.className = 'viewer-layer';
    app.append(layer);
    document.body.classList.add('viewer-open');
  }
  layer.innerHTML = split
    ? `<main class="viewer is-split">
        <iframe class="split-window split-window-primary" data-role="primary"
          src="${embeddedURL('primary', state.splitViewStates?.primary)}" title="${t('leftFrame')}"></iframe>
        <div class="split-divider"><m3e-icon-button variant="tonal" size="small" class="end-split" aria-label="${t('endSplit')}"
          data-tooltip="${t('endSplit')}" data-shortcut-action="splitToggle"><m3e-icon name="close"></m3e-icon></m3e-icon-button></div>
        <iframe class="split-window split-window-secondary" data-role="secondary"
          src="${embeddedURL('secondary', state.splitViewStates?.secondary)}" title="${t('rightFrame')}"></iframe>
      </main>`
    : `<main class="viewer" role="dialog" aria-modal="true">
        <div class="split-surface"></div>
      </main>`;
  if (!split) updateViewerPane($('.split-surface', layer), 0);
  $('.end-split', layer)?.addEventListener('click', event => {
    event.stopPropagation();
    toggleSplit();
  });
}

function toggleSplit() {
  if (state.splitTransition) return;
  if (embeddedMode) {
    parent.postMessage({type:'toggleSplit'}, location.origin);
    return;
  }
  if (state.split) {
    void collapseSplit();
    return;
  }
  if (!state.viewer[0] || innerWidth < 768) return;
  state.splitViewStates = {
    primary: captureViewState({preservePlaybackPosition:true}),
    secondary: captureViewState()
  };
  applyViewPreferences(state.splitViewStates.primary);
  state.zoomAnimationCancel[0]?.();
  state.zoomAnimationCancel[0] = null;
  $('.viewer video')?.pause();
  state.split = true;
  renderViewer();
}

function embeddedURL(role, snapshot = null) {
  const params = new URLSearchParams({embedded:'1', role});
  const media = snapshot?.media || (role === 'primary' ? state.viewer[0] : '');
  if (media) params.set('media', media);
  return `/?${params}${snapshot ? `#view=${encodeURIComponent(JSON.stringify(snapshot))}` : ''}`;
}

function updateViewerPane(surface, paneIndex, retainedPreview = null, preserveControls = false) {
  if (!surface) return;
  const template = document.createElement('template');
  template.innerHTML = paneHTML(state.viewer[paneIndex], paneIndex).trim();
  surface.replaceChildren(template.content);
  installRetainedViewerPreview(surface, retainedPreview);
  connectViewerPane(surface, preserveControls);
}

function connectViewerPane(root, preserveControls = false) {
  const pane = $('.pane', root);
  if (pane) bindPane(pane, preserveControls);
  $('.close-viewer', root)?.addEventListener('click', event => {
    event.stopPropagation();
    leaveViewerWithTransition();
  });
  $('.trash-media', root)?.addEventListener('click', event => {
    event.stopPropagation();
    confirmTrashMedia(state.viewer[Number(pane.dataset.pane)]);
  });
  $('.add-pane', root)?.addEventListener('click', event => {
    event.stopPropagation();
    toggleSplit();
  });
}

function leaveViewer() {
  if (embeddedMode && embeddedRole === 'primary') {
    parent.postMessage({type:'primaryGallery'}, location.origin);
  }
  const scrollY = state.viewerScrollY;
  state.viewer[0] = null;
  state.viewer[1] = null;
  state.viewerItems = [null, null];
  state.viewerNeighbors = [{previous: null, next: null}, {previous: null, next: null}];
  state.split = false;
  state.splitViewStates = null;
  $('.viewer-layer', app)?.remove();
  document.body.classList.remove('viewer-open');
  state.viewerTransitionSourceId = null;
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

const mediaLibraryChannel = typeof BroadcastChannel === 'function'
  ? new BroadcastChannel('nas-photo-library') : null;

async function applyTrashedMedia(id) {
  if (state.viewer[0] === id) {
    if (state.split) state.viewer[0] = null;
    else leaveViewer();
  }
  if ($('#gallery')) {
    try {
      await refreshGalleryItems();
    } catch (reason) {
      const status = $('#job-status');
      if (status) {
        status.hidden = false;
        status.textContent = reason.message;
      }
    }
  }
}

if (mediaLibraryChannel) {
  mediaLibraryChannel.onmessage = event => {
    if (event.data?.type === 'mediaTrashed') void applyTrashedMedia(String(event.data.id));
    if (event.data?.type === 'libraryChanged' && $('#gallery')) {
      void refreshGalleryItems().catch(() => {});
    }
  };
}

function confirmTrashMedia(id) {
  if (!id || $$('m3e-dialog').some(dialog => dialog.open)) return;
  hideTooltip();
  const dialog = createMaterialDialogShell('option-dialog trash-dialog', t('trashConfirm'));
  renderMaterialDialog(dialog, t('trashConfirm'), '<p class="error" hidden></p>', `
    <m3e-button variant="text" id="trash-no" autofocus>${t('no')}</m3e-button>
    <m3e-button variant="filled" id="trash-yes">${t('yes')}</m3e-button>`);
  $('#trash-no', dialog).onclick = () => closeMaterialDialog(dialog);
  $('#trash-yes', dialog).onclick = async () => {
    const yes = $('#trash-yes', dialog);
    const no = $('#trash-no', dialog);
    yes.disabled = true;
    no.disabled = true;
    dialog.disableClose = true;
    try {
      await api(`/api/media/${encodeURIComponent(id)}/trash`, {method:'POST'});
      closeMaterialDialog(dialog);
      mediaLibraryChannel?.postMessage({type:'mediaTrashed', id});
      await applyTrashedMedia(id);
    } catch {
      const error = $('.error', dialog);
      error.hidden = false;
      error.textContent = t('trashError');
      yes.disabled = false;
      no.disabled = false;
      dialog.disableClose = false;
    }
  };
  openMaterialDialog(dialog);
}

function paneHTML(id, index) {
  if (!id) return `<section class="pane pane-picker" data-pane="${index}"><p>${t('selectRightMedia')}</p></section>`;
  const item = findItem(id);
  if (!item) return `<section class="pane" data-pane="${index}"><p class="error">${t('mediaError')}</p></section>`;
  const source = `/api/media/${item.id}/content`;
  const thumbnail = mediaThumbnailURL(item);
  const zoom = state.zoom[index] || {scale:1, x:0, y:0};
  const transform = `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})`;
  const media = item.kind === 'video'
    ? `<video class="media" src="${source}" autoplay playsinline controls
        ${state.loop ? 'loop' : ''} ${state.muted ? 'muted' : ''}></video>`
    : `<span class="viewer-image-stage">
        <img class="media viewer-image-placeholder" src="${thumbnail}" alt="" draggable="false"
          style="transform:${transform}">
        <img class="media zoomable viewer-image-full" src="${source}" alt="${escapeHTML(item.name)}" draggable="false"
          decoding="async" style="transform:${transform}">
      </span>`;
  const itemIndex = state.items.findIndex(candidate => candidate.id === id);
  const previous = itemIndex >= 0 ? state.items[itemIndex - 1] : state.viewerNeighbors[index].previous;
  const next = itemIndex >= 0 ? state.items[itemIndex + 1] : state.viewerNeighbors[index].next;
  state.viewerNeighbors[index] = {previous: previous || null, next: next || null};
  const primaryScreen = embeddedRole !== 'secondary';
  const previousAction = primaryScreen ? 'prev1' : 'prev2';
  const nextAction = primaryScreen ? 'next1' : 'next2';
  return `<section class="pane" data-pane="${index}" tabindex="0">
    <div class="swipe-track">
      <div class="swipe-slide swipe-slide-previous" data-available="${Boolean(previous)}">${swipePreviewHTML(previous)}</div>
      <div class="swipe-slide swipe-slide-current">${media}</div>
      <div class="swipe-slide swipe-slide-next" data-available="${Boolean(next)}">${swipePreviewHTML(next)}</div>
    </div><div class="controls">
      <m3e-icon-button variant="tonal" size="small" class="close-viewer" aria-label="${t('backGallery')}" data-tooltip="${t('backGallery')}" data-shortcut-label="Esc"><m3e-icon name="close"></m3e-icon></m3e-icon-button>
      <m3e-icon-button variant="tonal" size="small" class="trash-media" aria-label="${t('trashMedia')}" data-tooltip="${t('trashMedia')}"><m3e-icon name="delete"></m3e-icon></m3e-icon-button>
      ${!embeddedMode && index === 0 && innerWidth >= 768 && !state.split ? `<m3e-icon-button variant="tonal" size="small" class="add-pane" aria-label="${t('splitToggle')}" data-tooltip="${t('addSplit')}" data-shortcut-action="splitToggle"><m3e-icon name="add"></m3e-icon></m3e-icon-button>` : ''}
      <m3e-icon-button variant="tonal" size="small" class="previous" aria-label="${t('previous')}" data-tooltip="${t('previous')}" data-shortcut-action="${previousAction}"><m3e-icon name="arrow_back"></m3e-icon></m3e-icon-button>
      <m3e-icon-button variant="tonal" size="small" class="next" aria-label="${t('next')}" data-tooltip="${t('next')}" data-shortcut-action="${nextAction}"><m3e-icon name="arrow_forward"></m3e-icon></m3e-icon-button>
      ${item.kind === 'video' ? `<div class="video-options">
        <m3e-button variant="tonal" size="small" toggle ${state.loop ? 'selected' : ''} class="loop-toggle" aria-label="${t('loopToggle')}" data-tooltip="${t('loopTip')}" data-shortcut-action="loop"><m3e-icon slot="icon" name="repeat"></m3e-icon><span class="toggle-state">${state.loop ? 'ON' : 'OFF'}</span></m3e-button>
        <m3e-button variant="tonal" size="small" toggle ${state.muted ? 'selected' : ''} class="mute-toggle" aria-label="${t('muteToggle')}"
          data-tooltip="${t('muteTip')}" data-shortcut-action="mute"><m3e-icon slot="icon" name="volume_off"></m3e-icon><span class="toggle-state">${state.muted ? 'ON' : 'OFF'}</span></m3e-button>
      </div>` : ''}
    </div></section>`;
}

function swipePreviewHTML(item) {
  if (!item) return '';
  const source = mediaThumbnailURL(item);
  return `<span class="swipe-preview-wrap">
    <img class="swipe-preview" src="${source}" alt="" draggable="false" decoding="async"
      data-media-width="${Number(item.width) || 0}" data-media-height="${Number(item.height) || 0}">
    ${item.kind === 'video' ? '<span class="swipe-preview-play" aria-hidden="true"><m3e-icon name="play_arrow"></m3e-icon></span>' : ''}
  </span>`;
}

function suppressNextViewerClick() {
  state.viewerClickSuppressUntil = performance.now() + 700;
}

function clearViewerClickSuppression() {
  state.viewerClickSuppressUntil = 0;
}

function bindPane(pane, preserveControls = false) {
  const index = Number(pane.dataset.pane);
  bindControlVisibility(pane, preserveControls);
  pane.addEventListener('pointerdown', clearViewerClickSuppression, true);
  pane.addEventListener('click', event => {
    if (performance.now() >= state.viewerClickSuppressUntil) return;
    state.viewerClickSuppressUntil = 0;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  pane.onclick = event => {
    state.activePane = index;
    const image = $('.swipe-slide-current .zoomable', pane);
    const outsideImage = image && event.target.closest('.viewer-image-stage') &&
      isPointOutsideDisplayedImage(pane, image, state.zoom[index], event.clientX, event.clientY);
    if (event.target === pane || event.target.classList.contains('swipe-slide') || outsideImage) {
      leaveViewerWithTransition();
    }
  };
  $('.previous', pane)?.addEventListener('click', event => { event.stopPropagation(); move(index, -1); });
  $('.next', pane)?.addEventListener('click', event => { event.stopPropagation(); move(index, 1); });
  $('.loop-toggle', pane)?.addEventListener('click', event => {
    event.stopPropagation();
    state.loop = !state.loop;
    savePreferences();
    $$('video').forEach(video => video.loop = state.loop);
    syncVideoOptionButtons();
  });
  $('.mute-toggle', pane)?.addEventListener('click', event => {
    event.stopPropagation();
    toggleMuted();
  });
  bindSwipe(pane, index);
}

function syncVideoOptionButtons() {
  $$('.loop-toggle').forEach(button => {
    button.selected = state.loop;
    $('.toggle-state', button).textContent = state.loop ? 'ON' : 'OFF';
  });
  $$('.mute-toggle').forEach(button => {
    button.selected = state.muted;
    $('.toggle-state', button).textContent = state.muted ? 'ON' : 'OFF';
  });
}

function applyMuted(value) {
  state.muted = Boolean(value);
  savePreferences();
  $$('video').forEach(video => video.muted = state.muted);
  syncVideoOptionButtons();
}

function toggleMuted() {
  applyMuted(!state.muted);
  if (embeddedMode) {
    parent.postMessage({type:'setMuted', value:state.muted}, location.origin);
  } else if (state.split) {
    postToRole('primary', {type:'setMuted', value:state.muted});
    postToRole('secondary', {type:'setMuted', value:state.muted});
  }
}

function bindControlVisibility(pane, preserve = false) {
  clearTimeout(state.controlsTimer);
  const hide = () => {
    pane.classList.remove('controls-visible');
    state.controlsHideAt = 0;
    hideTooltip();
  };
  const reveal = (pointerType = '') => {
    const delay = pointerType === 'touch' || pointerType === 'pen'
      ? TOUCH_CONTROL_HIDE_DELAY
      : CONTROL_HIDE_DELAY;
    pane.classList.add('controls-visible');
    clearTimeout(state.controlsTimer);
    state.controlsHideAt = performance.now() + delay;
    state.controlsTimer = setTimeout(hide, delay);
  };
  pane.addEventListener('pointerenter', event => reveal(event.pointerType));
  pane.addEventListener('pointermove', event => reveal(event.pointerType));
  pane.addEventListener('pointerdown', event => reveal(event.pointerType));
  pane.addEventListener('pointerleave', event => {
    if (event.pointerType !== 'mouse') return;
    clearTimeout(state.controlsTimer);
    hide();
  });
  pane.addEventListener('focusin', () => reveal());
  const remaining = state.controlsHideAt - performance.now();
  if (preserve && remaining > 0) {
    pane.classList.add('controls-visible');
    state.controlsTimer = setTimeout(hide, remaining);
  } else if (!preserve) {
    reveal();
  }
}

function constrainVisibleViewerZoom() {
  $$('.viewer .pane').forEach(pane => {
    fitSwipePreviews(pane);
    const image = $('.swipe-slide-current .zoomable', pane);
    if (!image) return;
    const index = Number(pane.dataset.pane);
    settleImageZoom(pane, image, index, false);
  });
}

async function move(paneIndex, delta, swipeOffset = 0, swipeVelocity = 0) {
  const current = state.viewer[paneIndex];
  let index = state.items.findIndex(item => item.id === current);
  while (index < 0 && state.nextOffset >= 0) {
    if (!await loadNextPage()) return;
    index = state.items.findIndex(item => item.id === current);
  }
  let next = index < 0 ? state.viewerNeighbors[paneIndex][delta < 0 ? 'previous' : 'next'] : state.items[index + delta];
  while (!next && delta > 0 && state.nextOffset >= 0) {
    if (!await loadNextPage()) return;
    index = state.items.findIndex(item => item.id === current);
    next = state.items[index + delta];
  }
  if (next) {
    const retainedPreview = next.kind === 'video' ? null : takeViewerSwipePreview(paneIndex, delta);
    openViewer(next.id, paneIndex, swipeOffset, swipeVelocity, retainedPreview);
  }
}
