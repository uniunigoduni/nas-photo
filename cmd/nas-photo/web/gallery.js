async function showGallery() {
  if ($('#gallery')) {
    updateGalleryLabels();
    updateGalleryItems();
    return refreshGalleryItems();
  }
  const token = ++state.galleryToken;
  clearTimeout(state.pollTimer);
  state.galleryRefreshRequest?.controller.abort();
  state.galleryRefreshRequest = null;
  state.scanMonitorToken++;
  state.scanWatch = {scan: false, thumbnails: false, cleanup: false};
  state.galleryObserver?.disconnect();
  state.galleryObserver = null;
  cancelAnimationFrame(state.galleryRenderFrame);
  state.galleryRenderFrame = 0;
  state.galleryRiverGeometry = null;
  state.galleryRiverRange = null;
  state.galleryQuery = queryString();
  document.body.classList.remove('viewer-open');
  state.items = [];
  state.nextOffset = 0;
  state.pageLoadRequest = null;
  app.innerHTML = `<m3e-linear-progress-indicator class="progress" variant="wavy" mode="indeterminate" aria-label="${t('loading')}" hidden></m3e-linear-progress-indicator>
    <p class="notice job-status" id="job-status" hidden></p>
    <header class="top-shell"><div class="top-layout">
      <strong class="top-title">NAS-PHOTO</strong>
      <div class="top top-actions" aria-label="NAS-PHOTO">
        <m3e-button variant="tonal" size="small" id="sort-menu" data-tooltip="${t('sortTip')}"><m3e-icon slot="icon" name="sort"></m3e-icon>${t('sort')}</m3e-button>
        <m3e-button variant="tonal" size="small" id="view-menu" data-tooltip="${t('viewTip')}"><m3e-icon slot="icon" name="grid_view"></m3e-icon>${t('view')}</m3e-button>
        <m3e-button variant="tonal" size="small" id="filter-menu" data-tooltip="${t('filterTip')}"><m3e-icon slot="icon" name="filter_alt"></m3e-icon>${t('filter')}</m3e-button>
        <m3e-button variant="tonal" size="small" id="scan-menu" data-tooltip="${t('rescanTip')}"><m3e-icon slot="icon" name="sync"></m3e-icon>${t('rescan')}</m3e-button>
      </div>
      <m3e-icon-button variant="tonal" size="small" id="settings" aria-label="${t('settings')}" data-tooltip="${t('settingsTip')}"><m3e-icon name="settings"></m3e-icon></m3e-icon-button>
    </div></header>
    <div class="selection-summary" id="selection-summary"></div>
    <main class="gallery ${state.layout} size-${state.size}" id="gallery"><p class="empty">${t('loading')}</p></main>`;
  connectGalleryShell();
  try {
    await loadPage(0, token);
    void loadRemainingPages(token);
    monitorScan(token);
  } catch (reason) {
    if (token === state.galleryToken) $('#gallery').innerHTML = `<p class="error">${escapeHTML(reason.message)}</p>`;
  }
}

async function refreshGalleryItems({broadcast = false} = {}) {
  const gallery = $('#gallery');
  if (!gallery) return;
  state.galleryRefreshRequest?.controller.abort();
  const request = {controller: new AbortController(), query: queryString()};
  state.galleryRefreshRequest = request;
  const params = new URLSearchParams(request.query);
  params.set('snapshot', '1');
  try {
    // Keep the published items and DOM usable until the complete replacement is ready.
    const page = await api(`/api/media?${params}`, {signal: request.controller.signal});
    if (state.galleryRefreshRequest !== request || $('#gallery') !== gallery) return;
    const preserveAnchor = state.galleryQuery === request.query;
    const token = ++state.galleryToken;
    const previousItems = state.items;
    state.galleryQuery = request.query;
    state.items = page.items || [];
    state.total = page.total || 0;
    state.nextOffset = -1;
    state.pageLoadRequest = null;
    updateGalleryItems(preserveAnchor);
    syncViewerGalleryItems(previousItems);
    if (broadcast) mediaLibraryChannel?.postMessage({type: 'libraryChanged'});
    monitorScan(token);
  } catch (reason) {
    if (request.controller.signal.aborted || state.galleryRefreshRequest !== request) return;
    const status = $('#job-status');
    if (status && $('#gallery') === gallery) {
      status.hidden = false;
      status.textContent = reason.message;
    }
    throw reason;
  } finally {
    if (state.galleryRefreshRequest === request) state.galleryRefreshRequest = null;
  }
}

async function loadPage(offset, token = state.galleryToken) {
  const params = new URLSearchParams(state.galleryQuery || queryString());
  params.set('offset', String(offset));
  const page = await api(`/api/media?${params}`);
  if (token !== state.galleryToken) return;
  const previousItems = state.items;
  state.items = offset === 0 ? (page.items || []) : state.items.concat(page.items || []);
  state.total = page.total || 0;
  state.nextOffset = page.nextOffset;
  updateGalleryItems();
  syncViewerGalleryItems(previousItems);
}

async function loadNextPage(token = state.galleryToken) {
  if (token !== state.galleryToken || state.nextOffset < 0) return false;
  if (state.pageLoadRequest?.token === token) {
    await state.pageLoadRequest.promise;
    return token === state.galleryToken;
  }

  const offset = state.nextOffset;
  const request = {token, promise: loadPage(offset, token)};
  state.pageLoadRequest = request;
  try {
    await request.promise;
    return token === state.galleryToken;
  } finally {
    if (state.pageLoadRequest === request) state.pageLoadRequest = null;
  }
}

async function loadRemainingPages(token = state.galleryToken) {
  try {
    while (token === state.galleryToken && state.nextOffset >= 0) {
      if (!await loadNextPage(token)) return;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  } catch (reason) {
    const gallery = $('#gallery');
    if (token === state.galleryToken && gallery) {
      gallery.insertAdjacentHTML('beforeend', `<p class="error">${escapeHTML(reason.message)}</p>`);
    }
  }
}

function captureGalleryPosition(gallery, ids) {
  const viewerOpen = document.body.classList.contains('viewer-open');
  const scrollY = viewerOpen ? state.viewerScrollY : window.scrollY;
  const viewportTop = scrollY - window.scrollY;
  let anchor = null;
  for (const tile of gallery.querySelectorAll('.tile')) {
    if (ids && !ids.has(tile.dataset.id)) continue;
    const rect = tile.getBoundingClientRect();
    if (rect.bottom > viewportTop) {
      anchor = {tile, offset: rect.top - viewportTop};
      break;
    }
  }
  return {scrollY, anchor, focus: gallery.contains(document.activeElement) ? document.activeElement : null};
}

function restoreGalleryPosition(position) {
  let scrollY = position.scrollY;
  if (position.anchor?.tile.isConnected) {
    scrollY = position.anchor.tile.getBoundingClientRect().top + window.scrollY - position.anchor.offset;
  }
  if (document.body.classList.contains('viewer-open')) state.viewerScrollY = Math.max(0, scrollY);
  else if (Math.abs(window.scrollY - scrollY) > 0.5) {
    window.scrollTo({top: Math.max(0, scrollY), left: window.scrollX, behavior: 'instant'});
  }
  if (position.focus?.isConnected && document.activeElement !== position.focus) {
    position.focus.focus({preventScroll: true});
  }
}

function reconcileGalleryChildren(parent, children) {
  let cursor = parent.firstChild;
  for (const child of children) {
    if (child === cursor) cursor = cursor.nextSibling;
    else parent.insertBefore(child, cursor);
  }
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }
}

function updateGalleryItems(preserveAnchor = true) {
  const gallery = $('#gallery');
  if (!gallery) return;
  if (state.layout === 'river') {
    updateRiverGallery(preserveAnchor);
    return;
  }
  state.galleryObserver?.disconnect();
  state.galleryObserver = null;
  state.galleryRiverGeometry = null;
  state.galleryRiverRange = null;
  const ids = new Set(state.items.map(item => item.id));
  const position = captureGalleryPosition(gallery, ids);
  if (!preserveAnchor) position.anchor = null;
  const existingTiles = new Map([...gallery.querySelectorAll('.tile')].map(tile => [tile.dataset.id, tile]));
  let geometryChanged = Boolean(state.galleryLayoutFrame);
  const tiles = state.items.map(item => {
    let tile = existingTiles.get(item.id);
    if (!tile || tile.dataset.kind !== item.kind) {
      const template = document.createElement('template');
      template.innerHTML = tileHTML(item).trim();
      tile = template.content.firstElementChild;
      geometryChanged = true;
    } else {
      if (tile.getAttribute('aria-label') !== item.name) tile.setAttribute('aria-label', item.name);
      if (tile.dataset.tooltip !== t('mediaTip')) tile.dataset.tooltip = t('mediaTip');
      const source = mediaThumbnailURL(item);
      const contentVersion = mediaContentVersion(item);
      if (tile.dataset.contentVersion !== contentVersion) {
        tile.dataset.contentVersion = contentVersion;
        state.aspectRatios.delete(item.id);
        state.aspectRatioVersions.delete(item.id);
      }
      if (tile.dataset.thumbnailSource !== source) {
        replaceGalleryThumbnail(tile, source);
      }
      const ratio = String(galleryAspectRatio(item));
      if (tile.dataset.aspectRatio !== ratio) {
        tile.dataset.aspectRatio = ratio;
        geometryChanged = true;
      }
    }
    return tile;
  });
  const className = `gallery ${state.layout} size-${state.size}`;
  geometryChanged ||= gallery.className !== className || existingTiles.size !== tiles.length ||
    [...existingTiles.values()].some((tile, index) => tile !== tiles[index]);
  if (gallery.className !== className) gallery.className = className;
  cancelAnimationFrame(state.galleryLayoutFrame);
  state.galleryLayoutFrame = 0;
  if (!state.items.length) {
    const empty = gallery.querySelector(':scope > .empty') || document.createElement('p');
    empty.className = 'empty';
    empty.textContent = t('noMedia');
    reconcileGalleryChildren(gallery, [empty]);
  } else if (geometryChanged) {
    tiles.forEach(tile => {
      tile.style.removeProperty('width');
      tile.style.removeProperty('height');
    });
    reconcileGalleryChildren(gallery, tiles);
  }
  $$(':scope > .error', gallery).forEach(error => error.remove());
  bindGalleryThumbnails(gallery);
  restoreGalleryPosition(position);
  updateGallerySummary();
}

function updateGalleryLabels() {
  const labels = [['sort-menu', 'sort', 'sortTip'], ['view-menu', 'view', 'viewTip'],
    ['filter-menu', 'filter', 'filterTip'], ['scan-menu', 'rescan', 'rescanTip']];
  labels.forEach(([id, label, tip]) => {
    const button = $(`#${id}`);
    if (!button) return;
    button.lastChild.textContent = t(label);
    button.dataset.tooltip = t(tip);
  });
  const settings = $('#settings');
  settings?.setAttribute('aria-label', t('settings'));
  if (settings) settings.dataset.tooltip = t('settingsTip');
  $('.progress')?.setAttribute('aria-label', t('loading'));
}

function updateGallerySummary() {
  const sortLabels = {captured: t('captured'), created: t('created'), modified: t('modified'), name: t('name'), random: t('random')};
  const filterLabels = {'': t('all'), image: t('images'), video: t('videos')};
  const filterConditionLabel = state.filterCondition === 'duplicates' ? ` · ${t('duplicates')}` : '';
  const subSortLabel = state.subSort === 'same-day-name' && ['captured', 'created', 'modified'].includes(state.sort)
    ? ` · ${t('sameDayName')}` : '';
  $('#selection-summary').textContent =
    `${sortLabels[state.sort]}${state.sort === 'random' ? '' : ` · ${state.order === 'asc' ? t('ascending') : t('descending')}`}${subSortLabel} / ` +
    `${state.layout === 'river' ? t('river') : t('square')} · ${{small:t('small'),medium:t('medium'),large:t('large')}[state.size]} / ` +
    `${filterLabels[state.filter]}${filterConditionLabel} · ${state.total}`;
}

function galleryAspectRatio(item) {
  if (item.kind === 'video') return 1;
  const decodedRatio = state.aspectRatioVersions.get(item.id) === mediaContentVersion(item)
    ? state.aspectRatios.get(item.id) : null;
  return decodedRatio || (Number(item.width) > 0 && Number(item.height) > 0
    ? Number(item.width) / Number(item.height) : 4 / 3);
}

function tileHTML(item) {
  const thumb = mediaThumbnailURL(item);
  return `<button class="tile" draggable="true" data-id="${item.id}" data-kind="${item.kind}" data-aspect-ratio="${galleryAspectRatio(item)}" data-content-version="${escapeHTML(mediaContentVersion(item))}" data-thumbnail-source="${escapeHTML(thumb)}" aria-label="${escapeHTML(item.name)}" data-tooltip="${t('mediaTip')}">
    <span class="thumb-fallback"></span>
    <img src="${escapeHTML(thumb)}" draggable="false" loading="lazy" decoding="async" alt="">
    ${item.kind === 'video' ? '<span class="play-mark" aria-hidden="true"><m3e-icon name="play_arrow"></m3e-icon></span>' : ''}
  </button>`;
}

function replaceGalleryThumbnail(tile, source) {
  $('img[data-thumbnail-pending]', tile)?.remove();
  tile.dataset.thumbnailSource = source;
  const current = $('img', tile);
  const image = new Image();
  image.draggable = false;
  image.alt = '';
  image.decoding = 'async';
  image.loading = 'lazy';
  if (!current) {
    image.src = source;
    tile.append(image);
    return;
  }
  // Load a second image without covering the displayed thumbnail. Native lazy
  // loading still prioritizes visible tiles when all thumbnails are regenerated.
  image.dataset.thumbnailPending = '1';
  image.style.opacity = '0';
  const discard = () => {
    const active = $('img[data-thumbnail-pending]', tile) === image;
    image.remove();
    if (active && tile.dataset.thumbnailSource === source) tile.dataset.thumbnailSource = '';
  };
  image.onload = async () => {
    try { await image.decode(); } catch { discard(); return; }
    if (!image.isConnected || tile.dataset.thumbnailSource !== source) return;
    delete image.dataset.thumbnailPending;
    image.style.removeProperty('opacity');
    if (current.isConnected) current.replaceWith(image);
    bindGalleryThumbnails(tile);
  };
  image.onerror = discard;
  image.src = source;
  tile.append(image);
}

function bindGalleryThumbnails(gallery) {
  $$('img:not([data-ratio-bound]):not([data-thumbnail-pending])', gallery).forEach(image => {
    image.dataset.ratioBound = '1';
    const tile = image.closest('.tile');
    const updateRatio = () => {
      if (!image.naturalWidth || !image.naturalHeight || $('img[data-thumbnail-pending]', tile)) return;
      const ratio = image.naturalWidth / image.naturalHeight;
      state.aspectRatios.set(tile.dataset.id, ratio);
      state.aspectRatioVersions.set(tile.dataset.id, tile.dataset.contentVersion);
      if (tile.dataset.kind !== 'video' && Math.abs(Number(tile.dataset.aspectRatio) - ratio) > 0.001) {
        tile.dataset.aspectRatio = String(ratio);
        scheduleRiverLayout();
      }
    };
    image.addEventListener('load', updateRatio, {once: true});
    image.addEventListener('error', () => {
      image.remove();
      if (!$('img[data-thumbnail-pending]', tile)) tile.dataset.thumbnailSource = '';
    }, {once: true});
    if (image.complete) updateRatio();
  });
}

// River geometry is calculated for the complete sorted list, but only rows near
// the viewport become DOM nodes. The exact existing row-breaking algorithm is kept.
function updateRiverGallery(preserveAnchor = true) {
  const gallery = $('#gallery');
  if (!gallery || !window.NasPhotoLayout) return;
  cancelAnimationFrame(state.galleryLayoutFrame);
  state.galleryLayoutFrame = 0;
  const ids = new Set(state.items.map(item => item.id));
  const position = captureGalleryPosition(gallery, ids);
  if (!preserveAnchor) position.anchor = null;

  gallery.className = `gallery river size-${state.size}`;
  const style = getComputedStyle(gallery);
  const width = Math.max(1, gallery.clientWidth -
    (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0));
  const gap = parseFloat(style.getPropertyValue('--river-gap')) || 0;
  const targetHeight = parseFloat(style.getPropertyValue('--river-target-height')) || 180;
  const rows = window.NasPhotoLayout.computeJustifiedRows(
    state.items.map(galleryAspectRatio), width, targetHeight, gap);
  const totalHeight = window.NasPhotoLayout.positionJustifiedRows(rows, gap);
  state.galleryRiverGeometry = {
    rows, totalHeight, gap, paddingTop: parseFloat(style.paddingTop) || 0
  };
  state.galleryMeasuredWidth = gallery.clientWidth;
  state.galleryRiverVersion++;
  state.galleryRiverRange = null;

  if (!rows.length) {
    const empty = gallery.querySelector(':scope > .empty') || document.createElement('p');
    empty.className = 'empty';
    empty.textContent = t('noMedia');
    reconcileGalleryChildren(gallery, [empty]);
  } else {
    // Publish the new complete height first. Otherwise window.scrollTo() can
    // clamp to the *old* scroll range when fresh items were inserted above us.
    renderVisibleRiverRows(true);
    // The old first visible photo, not an index, is the stable refresh anchor.
    // This also works when that photo is removed from the DOM by virtualization.
    if (position.anchor) {
      const id = position.anchor.tile.dataset.id;
      const index = state.items.findIndex(item => item.id === id);
      const row = window.NasPhotoLayout.justifiedRowForItem(rows, index);
      if (row) {
        const galleryTop = gallery.getBoundingClientRect().top + window.scrollY;
        const scrollY = Math.max(0, galleryTop + state.galleryRiverGeometry.paddingTop +
          row.top - position.anchor.offset);
        if (document.body.classList.contains('viewer-open')) {
          if (Math.abs(state.viewerScrollY - scrollY) > 0.5) {
            state.viewerScrollY = scrollY;
            renderVisibleRiverRows();
          }
        } else if (Math.abs(window.scrollY - scrollY) > 0.5) {
          window.scrollTo({top: scrollY, left: window.scrollX, behavior: 'instant'});
          renderVisibleRiverRows();
        }
      }
    }
  }
  if (position.focus && !position.focus.isConnected) {
    const focusedId = position.focus.closest('.tile')?.dataset.id;
    const replacement = focusedId && gallery.querySelector(
      `.tile[data-id="${CSS.escape(focusedId)}"]`);
    replacement?.focus({preventScroll: true});
  }
  updateGallerySummary();

  if (!state.galleryObserver && 'ResizeObserver' in window) {
    state.galleryObserver = new ResizeObserver(() => {
      if (!gallery.isConnected || state.layout !== 'river') return;
      if (Math.abs(gallery.clientWidth - state.galleryMeasuredWidth) < 0.5) return;
      scheduleRiverLayout();
    });
    state.galleryObserver.observe(gallery);
  }
}

function scheduleRiverLayout() {
  if (state.layout !== 'river') return;
  cancelAnimationFrame(state.galleryLayoutFrame);
  state.galleryLayoutFrame = requestAnimationFrame(() => {
    state.galleryLayoutFrame = 0;
    updateRiverGallery();
  });
}

function scheduleRiverWindow() {
  if (state.layout !== 'river' || state.galleryRenderFrame) return;
  state.galleryRenderFrame = requestAnimationFrame(() => {
    state.galleryRenderFrame = 0;
    renderVisibleRiverRows();
  });
}

function renderVisibleRiverRows(force = false) {
  const gallery = $('#gallery');
  const geometry = state.galleryRiverGeometry;
  if (!gallery || !geometry?.rows.length || state.layout !== 'river') return;
  const {rows, gap, totalHeight, paddingTop} = geometry;
  const galleryTop = gallery.getBoundingClientRect().top + window.scrollY + paddingTop;
  const scrollY = document.body.classList.contains('viewer-open')
    ? state.viewerScrollY : window.scrollY;
  const overscan = Math.max(window.innerHeight * 1.5, 700);
  const range = window.NasPhotoLayout.visibleJustifiedRows(
    rows, scrollY - galleryTop - overscan,
    scrollY - galleryTop + window.innerHeight + overscan);
  if (!force && state.galleryRiverRange?.start === range.start &&
      state.galleryRiverRange?.end === range.end &&
      state.galleryRiverRange?.version === state.galleryRiverVersion) return;

  const previousRows = new Map(
    [...gallery.querySelectorAll(':scope > .river-row')]
      .map(row => [Number(row.dataset.riverIndex), row]));
  const existingTiles = new Map(
    [...gallery.querySelectorAll('.tile')].map(tile => [tile.dataset.id, tile]));
  const desired = [];

  if (range.start > 0) {
    const spacer = gallery.querySelector(':scope > .river-spacer-start') ||
      document.createElement('div');
    spacer.className = 'river-spacer river-spacer-start';
    spacer.style.height = `${rows[range.start].top}px`;
    spacer.setAttribute('aria-hidden', 'true');
    desired.push(spacer);
  }

  for (let rowIndex = range.start; rowIndex < range.end; rowIndex++) {
    const row = rows[rowIndex];
    const element = previousRows.get(rowIndex) || document.createElement('div');
    element.className = `river-row${row.justified ? ' justified' : ''}`;
    element.dataset.riverIndex = String(rowIndex);
    element.style.gap = `${row.gap}px`;
    element.style.marginBottom = rowIndex + 1 === rows.length ? '0px' : `${gap}px`;
    const tiles = [];
    for (let index = row.start; index < row.end; index++) {
      const item = state.items[index];
      let tile = existingTiles.get(item.id);
      if (!tile || tile.dataset.kind !== item.kind) {
        const template = document.createElement('template');
        template.innerHTML = tileHTML(item).trim();
        tile = template.content.firstElementChild;
      } else {
        if (tile.getAttribute('aria-label') !== item.name) tile.setAttribute('aria-label', item.name);
        if (tile.dataset.tooltip !== t('mediaTip')) tile.dataset.tooltip = t('mediaTip');
        const contentVersion = mediaContentVersion(item);
        if (tile.dataset.contentVersion !== contentVersion) {
          tile.dataset.contentVersion = contentVersion;
          state.aspectRatios.delete(item.id);
          state.aspectRatioVersions.delete(item.id);
        }
        const source = mediaThumbnailURL(item);
        if (tile.dataset.thumbnailSource !== source) replaceGalleryThumbnail(tile, source);
      }
      tile.dataset.aspectRatio = String(galleryAspectRatio(item));
      tile.style.width = `${Math.max(1, row.widths[index - row.start])}px`;
      tile.style.height = `${Math.max(1, row.height)}px`;
      tiles.push(tile);
    }
    reconcileGalleryChildren(element, tiles);
    desired.push(element);
  }

  if (range.end < rows.length) {
    const spacer = gallery.querySelector(':scope > .river-spacer-end') ||
      document.createElement('div');
    spacer.className = 'river-spacer river-spacer-end';
    const lastRow = rows[range.end - 1];
    spacer.style.height = `${Math.max(0, totalHeight - lastRow.bottom - gap)}px`;
    spacer.setAttribute('aria-hidden', 'true');
    desired.push(spacer);
  }
  reconcileGalleryChildren(gallery, desired);
  state.galleryRiverRange = {...range, version: state.galleryRiverVersion};
  bindGalleryThumbnails(gallery);
}

window.addEventListener('scroll', scheduleRiverWindow, {passive: true});
window.addEventListener('resize', () => {
  const gallery = $('#gallery');
  if (!gallery || state.layout !== 'river') return;
  if (Math.abs(gallery.clientWidth - state.galleryMeasuredWidth) > 0.5) scheduleRiverLayout();
  else scheduleRiverWindow();
}, {passive: true});

function connectGalleryShell() {
  const gallery = $('#gallery');
  if (gallery) gallery.onclick = event => {
    const tile = event.target.closest('.tile');
    if (tile && gallery.contains(tile)) openViewerFromTile(tile);
  };
  $('#sort-menu').onclick = showSortDialog;
  $('#view-menu').onclick = () => optionDialog(t('view'), [
    [t('display'), 'layout', [[t('square'), 'square'], [t('river'), 'river']]],
    [t('size'), 'size', [[t('small'), 'small'], [t('medium'), 'medium'], [t('large'), 'large']]]
  ], {layout: state.layout, size: state.size}, draft => {
    state.layout = draft.layout;
    state.size = draft.size;
    savePreferences();
    updateGalleryItems();
  });
  $('#filter-menu').onclick = () => optionDialog(t('filter'), [
    [t('mediaType'), 'filter', [[t('all'), ''], [t('images'), 'image'], [t('videos'), 'video']]],
    [t('filterCondition'), 'filterCondition', [[t('noFilterCondition'), ''], [t('duplicates'), 'duplicates']]]
  ], {filter: state.filter, filterCondition: state.filterCondition}, draft => {
    state.filter = draft.filter;
    state.filterCondition = draft.filterCondition;
    savePreferences();
    return refreshGalleryItems();
  });
  $('#scan-menu').onclick = () => actionDialog(t('rescan'), [
    [t('index'), [[t('rescanNow'), 'scan']]],
    [t('thumbnails'), [
      [t('generateThumbnails'), 'thumbnails'],
      [t('regenerateThumbnails'), 'regenerate-thumbnails'],
      [t('cleanupThumbnails'), 'cleanup-thumbnails']
    ]]
  ], async value => {
    const status = $('#job-status');
    try {
      if (value === 'scan') {
        await api('/api/index/rescan', {method: 'POST'});
        monitorScan(state.galleryToken, true);
        return;
      }
      if (value === 'cleanup-thumbnails') {
        await api('/api/thumbnails/cleanup', {method: 'POST'});
        status.hidden = false;
        status.textContent = t('thumbnailCleanupWorking');
        monitorScan(state.galleryToken, false, false, true);
        return;
      }
      if (value === 'thumbnails') await api('/api/thumbnails/generate', {method: 'POST'});
      if (value === 'regenerate-thumbnails') await api('/api/thumbnails/regenerate', {method: 'POST'});
      status.hidden = false;
      status.textContent = t('thumbnailWorking');
      monitorScan(state.galleryToken, false, true);
    } catch (reason) {
      status.hidden = false;
      status.textContent = reason.message;
    }
  });
  $('#settings').onclick = openSettingsDialog;
}

async function monitorScan(token, observedRunning = false, observedThumbnailing = false, observedCleanup = false) {
  if (token !== state.galleryToken || !$('#gallery')) return;
  observedRunning ||= state.scanWatch.scan;
  observedThumbnailing ||= state.scanWatch.thumbnails;
  observedCleanup ||= state.scanWatch.cleanup;
  state.scanWatch.scan = observedRunning;
  state.scanWatch.thumbnails = observedThumbnailing;
  state.scanWatch.cleanup = observedCleanup;
  const monitorToken = ++state.scanMonitorToken;
  clearTimeout(state.pollTimer);
  try {
    const progress = await api('/api/index/current');
    if (token !== state.galleryToken || monitorToken !== state.scanMonitorToken || !$('#gallery')) return;
    const bar = $('.progress');
    const scanning = progress.scanning || progress.scanPending;
    const working = scanning || progress.thumbnailing || progress.thumbnailCleaning;
    const thumbnailPercent = progress.thumbnailTotal > 0
      ? Math.round(progress.thumbnailDone * 100 / progress.thumbnailTotal)
      : 0;
    const cleanupPercent = progress.thumbnailCleanupTotal > 0
      ? Math.round(progress.thumbnailCleanupDone * 100 / progress.thumbnailCleanupTotal)
      : 0;
    bar.hidden = !working;
    const indeterminate = (scanning && (!progress.scanning || !progress.total)) || (progress.thumbnailCleaning && !progress.thumbnailCleanupTotal);
    bar.mode = indeterminate ? 'indeterminate' : 'determinate';
    bar.max = 100;
    if (!indeterminate) {
      bar.value = progress.thumbnailCleaning ? cleanupPercent : (progress.thumbnailing ? thumbnailPercent : (progress.percent || 0));
    }
    state.scanWatch.scan = observedRunning || scanning;
    state.scanWatch.thumbnails = observedThumbnailing || progress.thumbnailing;
    state.scanWatch.cleanup = observedCleanup || progress.thumbnailCleaning;
    if (!working && observedThumbnailing) {
      state.scanWatch.thumbnails = false;
      state.thumbnailVersion = Date.now();
      updateGalleryItems();
      showThumbnailResult(progress);
    }
    if (!working && observedCleanup) {
      state.scanWatch.cleanup = false;
      showThumbnailCleanupResult(progress);
    }
    if (working) {
      state.pollTimer = setTimeout(() => monitorScan(
        token,
        observedRunning || scanning,
        observedThumbnailing || progress.thumbnailing,
        observedCleanup || progress.thumbnailCleaning
      ), 250);
    } else if (observedRunning) {
      state.scanWatch.scan = false;
      if (progress.phase === 'ready') {
        await refreshGalleryItems();
        mediaLibraryChannel?.postMessage({type: 'libraryChanged'});
      }
    }
  } catch {
    if (token !== state.galleryToken || monitorToken !== state.scanMonitorToken || !$('#gallery')) return;
    state.scanWatch.scan ||= observedRunning;
    state.pollTimer = setTimeout(() => monitorScan(token, observedRunning, observedThumbnailing, observedCleanup), 2000);
  }
}

function showThumbnailCleanupResult(progress) {
  const status = $('#job-status');
  if (!status) return;
  const total = Number(progress.thumbnailCleanupTotal) || 0;
  const removed = Number(progress.thumbnailCleanupRemoved) || 0;
  const errors = Number(progress.thumbnailCleanupErrors) || 0;
  const detail = (progress.thumbnailCleanupErrorDetails || [])[0];
  status.hidden = false;
  if (errors) {
    status.textContent = state.language === 'ja'
      ? `${total}件を確認し、${removed}件を削除、${errors}件の削除に失敗しました。${detail ? ` ${detail}` : ''}`
      : `Checked ${total} thumbnails; removed ${removed}; ${errors} deletions failed.${detail ? ` ${detail}` : ''}`;
    return;
  }
  status.textContent = state.language === 'ja'
    ? (removed ? `${total}件を確認し、不要なサムネイルを${removed}件削除しました。` : `${total}件を確認しました。不要なサムネイルはありません。`)
    : (removed ? `Checked ${total} thumbnails and removed ${removed} unused files.` : `Checked ${total} thumbnails. No unused thumbnails were found.`);
}

function showThumbnailResult(progress) {
  const status = $('#job-status');
  if (!status) return;
  const done = Number(progress.thumbnailDone) || 0;
  const total = Number(progress.thumbnailTotal) || 0;
  const errors = Number(progress.thumbnailErrors) || 0;
  const succeeded = Math.max(0, done - errors);
  const detail = (progress.thumbnailErrorDetails || [])[0];
  status.hidden = false;
  if (errors) {
    status.textContent = state.language === 'ja'
      ? `${total}件中${succeeded}件を生成、${errors}件失敗しました。${detail ? ` ${detail}` : ''}`
      : `Generated ${succeeded} of ${total} thumbnails; ${errors} failed.${detail ? ` ${detail}` : ''}`;
    return;
  }
  status.textContent = state.language === 'ja'
    ? (total ? `${total}件のサムネイルを生成しました。` : '生成が必要なサムネイルはありません。')
    : (total ? `Generated ${total} thumbnails.` : 'No thumbnails needed to be generated.');
}
