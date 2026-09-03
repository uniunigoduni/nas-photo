function findItem(id) {
  return state.items.find(item => item.id === id);
}

function materialViewTransitionsEnabled() {
  return !embeddedMode && 'startViewTransition' in document;
}

function visibleGalleryImage(id) {
  const tile = $(`.tile[data-id="${CSS.escape(id)}"]`);
  const image = $('img', tile);
  if (!image) return null;
  const rect = image.getBoundingClientRect();
  if (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) return null;
  return image;
}

function currentViewerTransitionMedia() {
  return $('.swipe-slide-current .viewer-image-placeholder', app) || $('.swipe-slide-current .media', app);
}

function openViewerFromTile(tile) {
  const id = tile?.dataset.id;
  if (!id) return;
  state.viewerTransitionSourceId = id;
  const source = $('img', tile);
  if (!source || !materialViewTransitionsEnabled()) {
    openViewer(id, 0);
    return;
  }
  source.style.viewTransitionName = 'nas-photo-media';
  let target = null;
  const transition = document.startViewTransition(() => {
    source.style.viewTransitionName = 'none';
    openViewer(id, 0);
    target = currentViewerTransitionMedia();
    if (target) target.style.viewTransitionName = 'nas-photo-media';
  });
  transition.finished.catch(() => {}).finally(() => {
    source.style.viewTransitionName = '';
    if (target) target.style.viewTransitionName = '';
  });
}

function leaveViewerWithTransition() {
  const id = state.viewer[0];
  const target = currentViewerTransitionMedia();
  const galleryImage = id && id === state.viewerTransitionSourceId ? visibleGalleryImage(id) : null;
  if (!target || !galleryImage || !materialViewTransitionsEnabled() || state.split) {
    leaveViewer();
    return;
  }
  target.style.viewTransitionName = 'nas-photo-media';
  const transition = document.startViewTransition(() => {
    target.style.viewTransitionName = 'none';
    leaveViewer();
    galleryImage.style.viewTransitionName = 'nas-photo-media';
  });
  transition.finished.catch(() => {}).finally(() => {
    target.style.viewTransitionName = '';
    galleryImage.style.viewTransitionName = '';
  });
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
          src="${embeddedURL('primary', state.viewer[0])}" title="${t('leftFrame')}"></iframe>
        <div class="split-divider"><m3e-icon-button variant="tonal" size="small" class="end-split" aria-label="${t('endSplit')}"
          data-tooltip="${t('endSplit')}" data-shortcut-action="splitToggle"><m3e-icon name="close"></m3e-icon></m3e-icon-button></div>
        <iframe class="split-window split-window-secondary" data-role="secondary"
          src="${embeddedURL('secondary')}" title="${t('rightFrame')}"></iframe>
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
  if (embeddedMode) {
    parent.postMessage({type:'toggleSplit'}, location.origin);
    return;
  }
  if (state.split) {
    state.split = false;
    if (state.viewer[0]) renderViewer(); else leaveViewer();
    return;
  }
  if (!state.viewer[0] || innerWidth < 768) return;
  state.split = true;
  renderViewer();
}

function embeddedURL(role, media = '') {
  const params = new URLSearchParams({embedded:'1', role});
  if (media) params.set('media', media);
  return `/?${params}`;
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
  state.split = false;
  $('.viewer-layer', app)?.remove();
  document.body.classList.remove('viewer-open');
  state.viewerTransitionSourceId = null;
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
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
  const previous = itemIndex > 0 ? state.items[itemIndex - 1] : null;
  const next = itemIndex >= 0 ? state.items[itemIndex + 1] : null;
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

function mediaThumbnailURL(item) {
  return `/api/media/${item.id}/thumbnail${state.thumbnailVersion ? `?v=${state.thumbnailVersion}` : ''}`;
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
  if (index < 0) return;
  let next = state.items[index + delta];
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
