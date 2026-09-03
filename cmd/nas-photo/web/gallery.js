async function showGallery() {
  const token = ++state.galleryToken;
  clearTimeout(state.pollTimer);
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

async function refreshGalleryItems() {
  const token = ++state.galleryToken;
  state.items = [];
  state.nextOffset = 0;
  state.pageLoadRequest = null;
  await loadPage(0, token);
  void loadRemainingPages(token);
  monitorScan(token);
}

async function loadPage(offset, token = state.galleryToken) {
  const page = await api(`/api/media?${queryString(offset)}`);
  if (token !== state.galleryToken) return;
  state.items = offset === 0 ? (page.items || []) : state.items.concat(page.items || []);
  state.total = page.total || 0;
  state.nextOffset = page.nextOffset;
  updateGalleryItems(offset > 0);
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

function updateGalleryItems(append = false) {
  const gallery = $('#gallery');
  if (!gallery) return;
  state.galleryObserver?.disconnect();
  state.galleryObserver = null;
  state.galleryWidth = 0;
  const riverPending = state.layout === 'river' && state.items.length && !append;
  gallery.className = `gallery ${state.layout} size-${state.size}${riverPending ? ' river-pending' : ''}`;
  const existingTiles = [...gallery.querySelectorAll('.tile')];
  const canAppend = append && existingTiles.length < state.items.length &&
    existingTiles.every((tile, index) => tile.dataset.id === state.items[index]?.id);
  if (!state.items.length) {
    gallery.innerHTML = `<p class="empty">${t('noMedia')}</p>`;
  } else if (canAppend) {
    gallery.insertAdjacentHTML('beforeend', state.items.slice(existingTiles.length).map(tileHTML).join(''));
  } else {
    gallery.innerHTML = state.items.map(tileHTML).join('');
  }
  bindGalleryThumbnails(gallery);
  if (state.layout === 'river') {
    scheduleRiverLayout();
    if ('ResizeObserver' in window) {
      state.galleryObserver = new ResizeObserver(entries => {
        const width = entries[0]?.contentRect.width || 0;
        if (Math.abs(width - state.galleryWidth) < 0.5) return;
        state.galleryWidth = width;
        scheduleRiverLayout();
      });
      state.galleryObserver.observe(gallery);
    }
  }
  const sortLabels = {captured: t('captured'), created: t('created'), modified: t('modified'), name: t('name'), random: t('random')};
  const filterLabels = {'': t('all'), image: t('images'), video: t('videos')};
  const subSortLabel = state.subSort === 'same-day-name' && ['captured', 'created', 'modified'].includes(state.sort)
    ? ` · ${t('sameDayName')}` : '';
  $('#selection-summary').textContent =
    `${sortLabels[state.sort]}${state.sort === 'random' ? '' : ` · ${state.order === 'asc' ? t('ascending') : t('descending')}`}${subSortLabel} / ` +
    `${state.layout === 'river' ? t('river') : t('square')} · ${{small:t('small'),medium:t('medium'),large:t('large')}[state.size]} / ` +
    `${filterLabels[state.filter]} · ${state.total}`;
}

function tileHTML(item) {
  const thumb = `/api/media/${item.id}/thumbnail${state.thumbnailVersion ? `?v=${state.thumbnailVersion}` : ''}`;
  const knownRatio = item.kind === 'video'
    ? 1
    : Number(item.width) > 0 && Number(item.height) > 0
    ? Number(item.width) / Number(item.height)
    : state.aspectRatios.get(item.id) || 4 / 3;
  return `<button class="tile" data-id="${item.id}" data-kind="${item.kind}" data-aspect-ratio="${knownRatio}" aria-label="${escapeHTML(item.name)}" data-tooltip="${t('mediaTip')}">
    <span class="thumb-fallback"></span>
    <img src="${thumb}" loading="lazy" decoding="async" alt="">
    ${item.kind === 'video' ? '<span class="play-mark" aria-hidden="true"><m3e-icon name="play_arrow"></m3e-icon></span>' : ''}
  </button>`;
}

function bindGalleryThumbnails(gallery) {
  $$('img:not([data-ratio-bound])', gallery).forEach(image => {
    image.dataset.ratioBound = '1';
    const tile = image.closest('.tile');
    const updateRatio = () => {
      if (!image.naturalWidth || !image.naturalHeight) return;
      const ratio = image.naturalWidth / image.naturalHeight;
      state.aspectRatios.set(tile.dataset.id, ratio);
      if (tile.dataset.kind !== 'video' && gallery.classList.contains('river-pending')) {
        tile.dataset.aspectRatio = String(ratio);
      }
    };
    image.addEventListener('load', updateRatio, {once: true});
    image.addEventListener('error', () => {
      image.remove();
    }, {once: true});
    if (image.complete) updateRatio();
  });
}

function scheduleRiverLayout() {
  if (state.layout !== 'river') return;
  cancelAnimationFrame(state.galleryLayoutFrame);
  state.galleryLayoutFrame = requestAnimationFrame(layoutRiverGallery);
}

function layoutRiverGallery() {
  state.galleryLayoutFrame = 0;
  const gallery = $('#gallery');
  if (!gallery || state.layout !== 'river' || !window.NasPhotoLayout) return;
  const tiles = [...gallery.querySelectorAll('.tile')];
  if (!tiles.length) return;

  const style = getComputedStyle(gallery);
  const width = gallery.clientWidth -
    (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
  if (width <= 0) return;
  const targetHeight = parseFloat(style.getPropertyValue('--river-target-height')) || 180;
  const gap = parseFloat(style.getPropertyValue('--river-gap')) || 0;
  const ratios = tiles.map(tile => Number(tile.dataset.aspectRatio) || 4 / 3);
  const rows = window.NasPhotoLayout.computeJustifiedRows(ratios, width, targetHeight, gap);
  const content = document.createDocumentFragment();

  rows.forEach(row => {
    const rowElement = document.createElement('div');
    rowElement.className = `river-row${row.justified ? ' justified' : ''}`;
    rowElement.style.gap = `${row.gap}px`;
    for (let index = row.start; index < row.end; index += 1) {
      const tile = tiles[index];
      tile.style.width = `${Math.max(1, row.widths[index - row.start])}px`;
      tile.style.height = `${Math.max(1, row.height)}px`;
      rowElement.append(tile);
    }
    content.append(rowElement);
  });
  gallery.replaceChildren(content);
  gallery.classList.remove('river-pending');
}

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
    updateGalleryItems(false);
  });
  $('#filter-menu').onclick = () => optionDialog(t('filter'), [
    [t('mediaType'), 'filter', [[t('all'), ''], [t('images'), 'image'], [t('videos'), 'video']]]
  ], {filter: state.filter}, draft => {
    state.filter = draft.filter;
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
        monitorScan(state.galleryToken);
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
  clearTimeout(state.pollTimer);
  try {
    const progress = await api('/api/index/current');
    if (token !== state.galleryToken || !$('#gallery')) return;
    const bar = $('.progress');
    const working = progress.scanning || progress.thumbnailing || progress.thumbnailCleaning;
    const thumbnailPercent = progress.thumbnailTotal > 0
      ? Math.round(progress.thumbnailDone * 100 / progress.thumbnailTotal)
      : 0;
    const cleanupPercent = progress.thumbnailCleanupTotal > 0
      ? Math.round(progress.thumbnailCleanupDone * 100 / progress.thumbnailCleanupTotal)
      : 0;
    bar.hidden = !working;
    const indeterminate = (progress.scanning && !progress.total) || (progress.thumbnailCleaning && !progress.thumbnailCleanupTotal);
    bar.mode = indeterminate ? 'indeterminate' : 'determinate';
    bar.max = 100;
    if (!indeterminate) {
      bar.value = progress.thumbnailCleaning ? cleanupPercent : (progress.thumbnailing ? thumbnailPercent : (progress.percent || 0));
    }
    if (working) {
      state.pollTimer = setTimeout(() => monitorScan(
        token,
        observedRunning || progress.scanning,
        observedThumbnailing || progress.thumbnailing,
        observedCleanup || progress.thumbnailCleaning
      ), 750);
    } else if (observedRunning) {
      if (progress.phase === 'ready') await refreshGalleryItems();
    } else if (observedThumbnailing) {
      state.thumbnailVersion = Date.now();
      updateGalleryItems(false);
      showThumbnailResult(progress);
    } else if (observedCleanup) {
      showThumbnailCleanupResult(progress);
    }
  } catch {
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
