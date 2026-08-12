const app = document.querySelector('#app');
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const pageParams = new URLSearchParams(location.search);
const embeddedMode = pageParams.get('embedded') === '1';
const embeddedRole = pageParams.get('role') || '';
const initialMediaId = pageParams.get('media') || '';
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const messages = {
  en: {
    language:'Language', english:'English', japanese:'Japanese',
    setupTitle:'Set a login password', setupIntro:'Enter the same password twice.',
    password:'Password', confirmPassword:'Confirm password',
    passwordHint:'Use 8–1024 characters. Use a VPN or HTTPS for remote access.',
    continue:'Continue', passwordMin:'Use at least 8 characters.', passwordMax:'Use no more than 1024 characters.',
    passwordMismatch:'Enter the same password in both fields.',
    foldersTitle:'Choose media folders', foldersIntro:'Select server folders containing images, GIFs, and videos.',
    notSelected:'No folders selected yet.', chooseFolder:'Choose folder', setupComplete:'Folder setup is complete. Sign in with your password.',
    delete:'Delete', loadingFolders:'Loading folders…', folderTitle:'Choose a folder', selectDrive:'Select a drive',
    selectThisFolder:'Select this folder', parentFolder:'Parent folder', noChildren:'No subfolders.', cancel:'Cancel', close:'Close',
    login:'Sign in', foldersResume:'Your password is already set. Sign in to continue folder setup.',
    loginError:'Enter the password you configured.',
    sort:'Sort', view:'View', filter:'Filter', rescan:'Scan', settings:'Settings',
    sortTip:'Change the sort order', viewTip:'Change gallery layout and size', filterTip:'Filter media types',
    rescanTip:'Scan the media library or generate thumbnails', settingsTip:'Open settings', loading:'Loading…',
    noMedia:'No media matches these conditions.',
    captured:'Date captured', created:'Date created', modified:'Date modified', name:'Name',
    all:'All', images:'Images & GIFs', videos:'Videos', ascending:'Ascending', descending:'Descending',
    river:'River', square:'Square', small:'Small', medium:'Medium', large:'Large',
    mediaTip:'Open this media', sortBasis:'Sort by', order:'Order', display:'Layout', size:'Size',
    mediaType:'Media type', index:'Library index', rescanNow:'Scan media folders',
    thumbnails:'Thumbnails', generateThumbnails:'Generate all missing thumbnails',
    regenerateThumbnails:'Regenerate all thumbnails',
    leftFrame:'Left NAS-PHOTO screen', rightFrame:'Right NAS-PHOTO screen',
    endSplit:'End split view', selectRightMedia:'Select media for this screen', mediaError:'Could not load this media.',
    backGallery:'Back to gallery', addSplit:'Add an independent screen on the right',
    previous:'Show previous media', next:'Show next media', loopTip:'Toggle video looping', muteTip:'Mute or unmute video audio',
    backSettings:'Back to settings', backGalleryButton:'Back to gallery', logout:'Sign out',
    shortcutSettings:'Keyboard shortcuts', shortcutSummary:'Review and customize',
    rootSettings:'Media folders', rootSummary:'Add and remove',
    languageSettings:'Language', languageSummary:'English or Japanese',
    resetSettings:'Reset password', resetSummary:'Return to initial setup',
    shortcutHint:'Select an action, then press the key you want to assign.',
    screen1Previous:'Screen 1: Previous', screen1Next:'Screen 1: Next',
    screen2Previous:'Screen 2: Previous', screen2Next:'Screen 2: Next',
    loopToggle:'Toggle loop', muteToggle:'Toggle mute', splitToggle:'Toggle split view',
    pressKey:'Press a key…', save:'Save', restoreDefaults:'Restore defaults',
    noRoots:'No media folders configured.', addFolder:'Add folder',
    resetTitle:'Reset password',
    resetInfo:'This resets the password, login sessions, media folders, index, and shortcut settings. Original media files are not changed.',
    currentPassword:'Current password', confirmImpact:'I understand what will be reset', reset:'Reset',
    confirmImpactError:'Confirm that you understand what will be reset.',
    finalResetConfirm:'Final confirmation: reset NAS-PHOTO to its initial state?',
    currentPasswordError:'Enter the current password correctly.',
    tooltipShortcut:'Shortcut', bootError:'Could not start', reload:'Reload',
    shortcutsRequired:'Configure every shortcut.', duplicateShortcut:'The same key cannot be assigned to multiple actions.',
    saveError:'Could not save settings.', readError:'Could not read the input.'
  },
  ja: {
    language:'言語', english:'English', japanese:'日本語',
    setupTitle:'ログインパスワードを設定', setupIntro:'同じパスワードを2回入力してください。',
    password:'パスワード', confirmPassword:'確認用パスワード',
    passwordHint:'8文字以上、1024文字以内で設定してください。外部アクセスにはVPNまたはHTTPSを利用してください。',
    continue:'続行', passwordMin:'パスワードは8文字以上にしてください。', passwordMax:'パスワードは1024文字以内にしてください。',
    passwordMismatch:'パスワードと確認用パスワードを同じ内容にしてください。',
    foldersTitle:'参照フォルダを設定', foldersIntro:'画像・GIF・動画を表示するサーバー側のフォルダを選択してください。',
    notSelected:'まだ選択されていません。', chooseFolder:'フォルダを選択', setupComplete:'フォルダ設定が完了しました。設定したパスワードでログインしてください。',
    delete:'削除', loadingFolders:'フォルダを読み込んでいます…', folderTitle:'フォルダを選択', selectDrive:'ドライブを選択',
    selectThisFolder:'このフォルダを選択', parentFolder:'親フォルダ', noChildren:'子フォルダはありません。', cancel:'キャンセル', close:'閉じる',
    login:'ログイン', foldersResume:'パスワード設定済みです。ログイン後、フォルダ設定を再開します。',
    loginError:'設定済みのパスワードを入力してください。',
    sort:'ソート', view:'種類とサイズ', filter:'フィルター', rescan:'スキャン', settings:'設定',
    sortTip:'並び順を変更', viewTip:'一覧の表示方法とサイズを変更', filterTip:'表示するメディアの種類を絞り込み',
    rescanTip:'メディアのスキャンまたはサムネイルの一括生成', settingsTip:'設定を開く', loading:'読み込んでいます…',
    noMedia:'条件に一致するメディアはありません。',
    captured:'撮影日', created:'作成日', modified:'変更日', name:'名前',
    all:'すべて', images:'画像・GIF', videos:'動画', ascending:'昇順', descending:'降順',
    river:'リバー', square:'正方形', small:'小', medium:'中', large:'大',
    mediaTip:'このメディアを表示', sortBasis:'基準', order:'順序', display:'表示方法', size:'大きさ',
    mediaType:'表示する種類', index:'索引', rescanNow:'メディアフォルダをスキャン',
    thumbnails:'サムネイル', generateThumbnails:'未作成のサムネイルを一括生成',
    regenerateThumbnails:'サムネイルをすべて再生成',
    leftFrame:'左側のNAS-PHOTO画面', rightFrame:'右側のNAS-PHOTO画面',
    endSplit:'画面分割を解除', selectRightMedia:'右画面のメディアを選択', mediaError:'メディアを読み込めません。',
    backGallery:'一覧へ戻る', addSplit:'独立した画面を右側に追加',
    previous:'前のメディアを表示', next:'次のメディアを表示', loopTip:'動画のループ再生を切り替え', muteTip:'動画の音声をミュートまたは解除',
    backSettings:'設定へ戻る', backGalleryButton:'一覧へ戻る', logout:'ログアウト',
    shortcutSettings:'キーボードショートカット', shortcutSummary:'確認と再設定',
    rootSettings:'参照フォルダ', rootSummary:'追加と削除',
    languageSettings:'言語', languageSummary:'Englishまたは日本語',
    resetSettings:'パスワードリセット', resetSummary:'初期状態へ戻す',
    shortcutHint:'変更する操作を押し、割り当てたいキーを入力してください。',
    screen1Previous:'画面1：前', screen1Next:'画面1：次',
    screen2Previous:'画面2：前', screen2Next:'画面2：次',
    loopToggle:'ループ切り替え', muteToggle:'ミュート切り替え', splitToggle:'画面分割の切り替え',
    pressKey:'キーを押してください…', save:'保存', restoreDefaults:'デフォルトに戻す',
    noRoots:'参照フォルダがありません。', addFolder:'フォルダを追加',
    resetTitle:'パスワードリセット',
    resetInfo:'パスワード、ログイン状態、参照フォルダ、索引、ショートカット設定を初期化します。原本メディアは変更しません。',
    currentPassword:'現在のパスワード', confirmImpact:'影響範囲を確認しました', reset:'リセットする',
    confirmImpactError:'「影響範囲を確認しました」にチェックしてください。',
    finalResetConfirm:'最終確認です。NAS-PHOTOを初期状態へ戻しますか？',
    currentPasswordError:'現在のパスワードを正しく入力してください。',
    tooltipShortcut:'ショートカット', bootError:'起動できませんでした', reload:'再読み込み',
    shortcutsRequired:'すべてのショートカットを設定してください。', duplicateShortcut:'同じキーを複数の操作へ設定できません。',
    saveError:'設定を保存できませんでした。', readError:'入力を読み取れませんでした。'
  }
};

const DEFAULT_SHORTCUTS = {
  prev1: 'KeyQ', next1: 'KeyW', prev2: 'KeyA', next2: 'KeyS',
  loop: 'KeyL', mute: 'KeyM', splitToggle: 'KeyE'
};
const CONTROL_HIDE_DELAY = 2500;
const TOUCH_CONTROL_HIDE_DELAY = 5000;
const MAX_IMAGE_ZOOM = 5;
const DOUBLE_TAP_IMAGE_ZOOM = 2.5;
const DOUBLE_TAP_DELAY = 300;
const DOUBLE_TAP_DISTANCE = 28;

const stored = JSON.parse(localStorage.getItem('nas-photo-preferences') || '{}');
const state = {
  language: localStorage.getItem('nas-photo-language') || 'en',
  items: [],
  total: 0,
  nextOffset: 0,
  sort: stored.sort || 'modified',
  order: stored.order || 'desc',
  filter: stored.filter || '',
  layout: stored.layout || 'square',
  size: stored.size || 'medium',
  loop: stored.loop ?? true,
  muted: stored.muted ?? false,
  viewer: [null, null],
  split: false,
  activePane: 0,
  shortcuts: {...DEFAULT_SHORTCUTS},
  galleryToken: 0,
  galleryLayoutFrame: 0,
  galleryObserver: null,
  galleryWidth: 0,
  aspectRatios: new Map(),
  pageLoadRequest: null,
  thumbnailVersion: 0,
  pollTimer: null,
  controlsTimer: null,
  controlsHideAt: 0,
  viewerScrollY: 0,
  zoom: [{scale:1, x:0, y:0}, {scale:1, x:0, y:0}],
  swipeOffset: [0, 0],
  viewerClickSuppressUntil: 0
};
document.documentElement.lang = state.language;

function t(key) {
  return messages[state.language]?.[key] || messages.en[key] || key;
}

function setLanguage(language) {
  state.language = language === 'ja' ? 'ja' : 'en';
  localStorage.setItem('nas-photo-language', state.language);
  document.documentElement.lang = state.language;
}

function savePreferences() {
  localStorage.setItem('nas-photo-preferences', JSON.stringify({
    sort: state.sort, order: state.order, filter: state.filter,
    layout: state.layout, size: state.size, loop: state.loop, muted: state.muted
  }));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: {'Content-Type': 'application/json', ...(options.headers || {})},
    ...options
  });
  if (!response.ok) {
    const raw = (await response.text()).trim() || `HTTP ${response.status}`;
    const knownErrors = {
      '入力を読み取れませんでした。もう一度入力してください。':'readError',
      '入力を読み取れませんでした。':'readError',
      'パスワードは8文字以上にしてください。':'passwordMin',
      'パスワードは1024文字以内にしてください。':'passwordMax',
      'パスワードと確認用パスワードを同じ内容にしてください。':'passwordMismatch',
      'すべてのショートカットを設定してください。':'shortcutsRequired',
      '同じキーを複数の操作へ設定できません。':'duplicateShortcut',
      '設定を保存できませんでした。':'saveError',
      'invalid password':'currentPasswordError'
    };
    throw new Error(knownErrors[raw] ? t(knownErrors[raw]) : raw);
  }
  return response.status === 204 ? null : response.json();
}

async function boot() {
  clearTimeout(state.pollTimer);
  const status = await api('/api/bootstrap/status');
  if (status.setupRequired) return showPasswordSetup();
  try {
    await api('/api/auth/me');
    if (status.foldersRequired) return showFolderSetup();
    await loadSettings();
    await showGallery();
    if (embeddedMode && initialMediaId) await openInitialMedia();
    return;
  } catch {
    return showLogin(status.foldersRequired);
  }
}

async function openInitialMedia() {
  while (!findItem(initialMediaId) && state.nextOffset >= 0) {
    await loadNextPage();
  }
  if (findItem(initialMediaId)) openViewer(initialMediaId, 0);
}

function showPasswordSetup() {
  app.innerHTML = `<main class="page"><section class="card auth-card">
    <div class="language-picker" aria-label="${t('language')}">
      <span>${t('language')}</span>
      <button type="button" class="${state.language === 'en' ? '' : 'secondary'}" data-language="en" aria-pressed="${state.language === 'en'}">English</button>
      <button type="button" class="${state.language === 'ja' ? '' : 'secondary'}" data-language="ja" aria-pressed="${state.language === 'ja'}">日本語</button>
    </div>
    <h1>${t('setupTitle')}</h1>
    <p>${t('setupIntro')}</p>
    <form class="stack" id="password-form">
      <label>${t('password')}<input id="password" type="password" autocomplete="new-password" autofocus></label>
      <label>${t('confirmPassword')}<input id="confirm" type="password" autocomplete="new-password"></label>
      <p class="hint">${t('passwordHint')}</p>
      <button>${t('continue')}</button><p class="error" role="alert"></p>
    </form></section></main>`;
  $$('[data-language]').forEach(button => button.onclick = () => {
    setLanguage(button.dataset.language);
    showPasswordSetup();
  });
  $('#password-form').onsubmit = async event => {
    event.preventDefault();
    const password = $('#password').value;
    const confirm = $('#confirm').value;
    const error = $('.error');
    if ([...password].length < 8) return error.textContent = t('passwordMin');
    if ([...password].length > 1024) return error.textContent = t('passwordMax');
    if (password !== confirm) return error.textContent = t('passwordMismatch');
    try {
      await api('/api/bootstrap/complete', {method: 'POST', body: JSON.stringify({password, confirm})});
      await showFolderSetup();
    } catch (reason) {
      error.textContent = reason.message;
    }
  };
}

async function showFolderSetup() {
  let roots = (await api('/api/folders/roots')) || [];
  const render = () => {
    app.innerHTML = `<main class="page"><section class="card folder-setup">
      <h1>${t('foldersTitle')}</h1>
      <p>${t('foldersIntro')}</p>
      <div class="root-list">${roots.length ? roots.map(rootRow).join('') : `<p class="empty">${t('notSelected')}</p>`}</div>
      <div class="stack"><button class="secondary" id="add-root">＋ ${t('chooseFolder')}</button>
      <button id="finish-folders" ${roots.length ? '' : 'disabled'}>${t('continue')}</button>
      <p class="error" role="alert"></p></div></section></main>`;
    $$('.delete-root').forEach(button => button.onclick = async () => {
      try {
        roots = (await api(`/api/roots/${button.dataset.id}`, {method: 'DELETE'})) || [];
        render();
      } catch (reason) {
        $('.error').textContent = reason.message;
      }
    });
    $('#add-root').onclick = () => chooseFolder('', async path => {
      try {
        roots = (await api('/api/roots', {method: 'POST', body: JSON.stringify({path})})) || [];
        render();
      } catch (reason) {
        $('.error').textContent = reason.message;
      }
    });
    $('#finish-folders').onclick = async () => {
      await api('/api/auth/logout', {method: 'POST'});
      showLogin(false, t('setupComplete'));
    };
  };
  render();
}

function rootRow(root) {
  return `<div class="root"><code title="${escapeHTML(root.path)}">${escapeHTML(root.path)}</code>
    <button class="danger delete-root" data-id="${root.id}">${t('delete')}</button></div>`;
}

async function chooseFolder(start, onChoose) {
  let path = start;
  const dialog = document.createElement('div');
  dialog.className = 'dialog';
  dialog.innerHTML = `<section class="card"><p>${t('loadingFolders')}</p></section>`;
  document.body.append(dialog);
  const render = async () => {
    try {
      const result = await api(`/api/folders/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`);
      const folders = result.folders || [];
      dialog.innerHTML = `<section class="card folder-dialog" role="dialog" aria-modal="true">
        <h2>${t('folderTitle')}</h2><p class="chosen">${escapeHTML(result.path || t('selectDrive'))}</p>
        <div class="folder-actions">
          <button id="choose-current" ${result.path ? '' : 'disabled'}>${t('selectThisFolder')}</button>
          ${result.parent ? `<button class="secondary" id="folder-up">↑ ${t('parentFolder')}</button>` : ''}
        </div>
        <div class="folder-list">${folders.map(folder => {
          const label = folder.split(/[\\/]/).filter(Boolean).pop() || folder;
          return `<button data-folder="${escapeHTML(folder)}">📁 ${escapeHTML(label)}</button>`;
        }).join('') || `<p class="empty">${t('noChildren')}</p>`}</div>
        <button class="secondary" id="folder-cancel">${t('cancel')}</button></section>`;
      $('#choose-current', dialog)?.addEventListener('click', async () => {
        await onChoose(result.path);
        dialog.remove();
      });
      $('#folder-up', dialog)?.addEventListener('click', () => { path = result.parent; render(); });
      $$('[data-folder]', dialog).forEach(button => button.onclick = () => {
        path = button.dataset.folder;
        render();
      });
      $('#folder-cancel', dialog).onclick = () => dialog.remove();
    } catch (reason) {
      dialog.innerHTML = `<section class="card"><p class="error">${escapeHTML(reason.message)}</p>
        <button id="folder-cancel">${t('close')}</button></section>`;
      $('#folder-cancel', dialog).onclick = () => dialog.remove();
    }
  };
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.remove(); });
  await render();
}

function showLogin(foldersRequired = false, notice = '') {
  app.innerHTML = `<main class="page"><section class="card auth-card">
    <h1>${t('login')}</h1>
    ${notice ? `<p class="notice">${escapeHTML(notice)}</p>` : ''}
    ${foldersRequired ? `<p>${t('foldersResume')}</p>` : ''}
    <form class="stack" id="login-form">
      <label>${t('password')}<input id="login-password" type="password" autocomplete="current-password" autofocus></label>
      <button>${t('continue')}</button><p class="error" role="alert"></p>
    </form></section></main>`;
  $('#login-form').onsubmit = async event => {
    event.preventDefault();
    try {
      await api('/api/auth/login', {method: 'POST', body: JSON.stringify({password: $('#login-password').value})});
      const status = await api('/api/bootstrap/status');
      if (status.foldersRequired) return showFolderSetup();
      await loadSettings();
      showGallery();
    } catch {
      $('.error').textContent = t('loginError');
    }
  };
}

async function loadSettings() {
  const settings = await api('/api/settings');
  state.shortcuts = {...state.shortcuts, ...(settings.shortcuts || {})};
}

function queryString(offset = 0) {
  return new URLSearchParams({
    sort: state.sort, order: state.order, filter: state.filter,
    offset: String(offset), limit: '200'
  }).toString();
}

async function showGallery() {
  const token = ++state.galleryToken;
  clearTimeout(state.pollTimer);
  document.body.classList.remove('viewer-open');
  state.items = [];
  state.nextOffset = 0;
  state.pageLoadRequest = null;
  app.innerHTML = `<div class="progress" hidden><i></i></div>
    <header class="top">
      <strong>NAS-PHOTO</strong>
      <button class="secondary" id="sort-menu" data-tooltip="${t('sortTip')}">${t('sort')}</button>
      <button class="secondary" id="view-menu" data-tooltip="${t('viewTip')}">${t('view')}</button>
      <button class="secondary" id="filter-menu" data-tooltip="${t('filterTip')}">${t('filter')}</button>
      <button class="secondary" id="scan-menu" data-tooltip="${t('rescanTip')}">${t('rescan')}</button>
      <span class="spacer"></span><button class="secondary icon-button" id="settings" aria-label="${t('settings')}" data-tooltip="${t('settingsTip')}">⚙</button>
    </header>
    <div class="selection-summary" id="selection-summary"></div>
    <main class="gallery ${state.layout} size-${state.size}" id="gallery"><p class="empty">${t('loading')}</p></main>`;
  bindGalleryControls();
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
  renderTiles(offset > 0);
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

function renderTiles(append = false) {
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
  $$('.tile', gallery).forEach(tile => tile.onclick = () => openViewer(tile.dataset.id, 0));
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
  const sortLabels = {captured: t('captured'), created: t('created'), modified: t('modified'), name: t('name')};
  const filterLabels = {'': t('all'), image: t('images'), video: t('videos')};
  $('#selection-summary').textContent =
    `${sortLabels[state.sort]} · ${state.order === 'asc' ? t('ascending') : t('descending')} / ` +
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
    ${item.kind === 'video' ? '<span class="play-mark" aria-hidden="true">▶</span>' : ''}
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

function bindGalleryControls() {
  $('#sort-menu').onclick = () => optionDialog(t('sort'), [
    [t('sortBasis'), [[t('captured'), 'captured'], [t('created'), 'created'], [t('modified'), 'modified'], [t('name'), 'name']]],
    [t('order'), [[t('ascending'), 'asc'], [t('descending'), 'desc']]]
  ], value => {
    if (value === 'asc' || value === 'desc') state.order = value; else state.sort = value;
    savePreferences(); showGallery();
  });
  $('#view-menu').onclick = () => optionDialog(t('view'), [
    [t('display'), [[t('square'), 'square'], [t('river'), 'river']]],
    [t('size'), [[t('small'), 'small'], [t('medium'), 'medium'], [t('large'), 'large']]]
  ], value => {
    if (value === 'square' || value === 'river') state.layout = value; else state.size = value;
    savePreferences(); showGallery();
  });
  $('#filter-menu').onclick = () => optionDialog(t('filter'), [
    [t('mediaType'), [[t('all'), ''], [t('images'), 'image'], [t('videos'), 'video']]]
  ], value => { state.filter = value; savePreferences(); showGallery(); });
  $('#scan-menu').onclick = () => optionDialog(t('rescan'), [
    [t('index'), [[t('rescanNow'), 'scan']]],
    [t('thumbnails'), [
      [t('generateThumbnails'), 'thumbnails'],
      [t('regenerateThumbnails'), 'regenerate-thumbnails']
    ]]
  ], async value => {
    if (value === 'scan') await api('/api/index/rescan', {method: 'POST'});
    if (value === 'thumbnails') await api('/api/thumbnails/generate', {method: 'POST'});
    if (value === 'regenerate-thumbnails') await api('/api/thumbnails/regenerate', {method: 'POST'});
    monitorScan(state.galleryToken);
  });
  $('#settings').onclick = showSettingsHome;
}

function optionDialog(title, sections, onSelect) {
  const overlay = document.createElement('div');
  overlay.className = 'dialog option-dialog';
  overlay.innerHTML = `<section class="card" role="dialog" aria-modal="true"><h2>${escapeHTML(title)}</h2>
    ${sections.map(([label, options]) => `<fieldset><legend>${escapeHTML(label)}</legend>
      ${options.map(([text, value]) => `<button class="secondary option" data-value="${escapeHTML(value)}">${escapeHTML(text)}</button>`).join('')}
    </fieldset>`).join('')}<button id="option-close">${t('close')}</button></section>`;
  document.body.append(overlay);
  $$('.option', overlay).forEach(button => button.onclick = async () => {
    overlay.remove();
    await onSelect(button.dataset.value);
  });
  $('#option-close', overlay).onclick = () => overlay.remove();
  overlay.onclick = event => { if (event.target === overlay) overlay.remove(); };
}

async function monitorScan(token, observedRunning = false, observedThumbnailing = false) {
  clearTimeout(state.pollTimer);
  try {
    const progress = await api('/api/index/current');
    if (token !== state.galleryToken || !$('#gallery')) return;
    const bar = $('.progress');
    const working = progress.scanning || progress.thumbnailing;
    const thumbnailPercent = progress.thumbnailTotal > 0
      ? Math.round(progress.thumbnailDone * 100 / progress.thumbnailTotal)
      : 0;
    bar.hidden = !working;
    bar.classList.toggle('indeterminate', progress.scanning && !progress.total);
    $('i', bar).style.width = `${progress.thumbnailing ? thumbnailPercent : (progress.percent || 0)}%`;
    if (working) {
      state.pollTimer = setTimeout(() => monitorScan(
        token,
        observedRunning || progress.scanning,
        observedThumbnailing || progress.thumbnailing
      ), 750);
    } else if (observedRunning) {
      if (progress.phase === 'ready') await refreshGalleryItems();
    } else if (observedThumbnailing) {
      state.thumbnailVersion = Date.now();
      renderTiles(false);
    }
  } catch {
    state.pollTimer = setTimeout(() => monitorScan(token, observedRunning, observedThumbnailing), 2000);
  }
}

function findItem(id) {
  return state.items.find(item => item.id === id);
}

function openViewer(id, paneIndex = 0, swipeOffset = 0) {
  hideTooltip();
  state.viewer[paneIndex] = id;
  state.activePane = paneIndex;
  state.zoom[paneIndex] = {scale:1, x:0, y:0};
  state.swipeOffset[paneIndex] = swipeOffset;
  if (embeddedMode && embeddedRole === 'primary') {
    parent.postMessage({type:'primaryMedia', id}, location.origin);
  }
  const surface = $('.viewer .split-surface');
  if (surface && paneIndex === 0) {
    surface.innerHTML = paneHTML(state.viewer[0], 0);
    bindViewerPane(surface, true);
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
        <div class="split-divider"><button class="end-split" aria-label="${t('endSplit')}"
          data-tooltip="${t('endSplit')}" data-shortcut-action="splitToggle">×</button></div>
        <iframe class="split-window split-window-secondary" data-role="secondary"
          src="${embeddedURL('secondary')}" title="${t('rightFrame')}"></iframe>
      </main>`
    : `<main class="viewer" role="dialog" aria-modal="true">
        <div class="split-surface">${paneHTML(state.viewer[0], 0)}</div>
      </main>`;
  if (!split) bindViewerPane($('.split-surface', layer));
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

function bindViewerPane(root, preserveControls = false) {
  const pane = $('.pane', root);
  if (pane) bindPane(pane, preserveControls);
  $('.close-viewer', root)?.addEventListener('click', event => {
    event.stopPropagation();
    leaveViewer();
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
  requestAnimationFrame(() => window.scrollTo(0, scrollY));
}

function paneHTML(id, index) {
  if (!id) return `<section class="pane pane-picker" data-pane="${index}"><p>${t('selectRightMedia')}</p></section>`;
  const item = findItem(id);
  if (!item) return `<section class="pane" data-pane="${index}"><p class="error">${t('mediaError')}</p></section>`;
  const source = `/api/media/${item.id}/content`;
  const zoom = state.zoom[index] || {scale:1, x:0, y:0};
  const media = item.kind === 'video'
    ? `<video class="media" src="${source}" autoplay playsinline controls
        ${state.loop ? 'loop' : ''} ${state.muted ? 'muted' : ''}></video>`
    : `<img class="media zoomable" src="${source}" alt="${escapeHTML(item.name)}" draggable="false"
        style="transform:translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})">`;
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
      <button class="close-viewer" aria-label="${t('backGallery')}" data-tooltip="${t('backGallery')}" data-shortcut-label="Esc">×</button>
      ${!embeddedMode && index === 0 && innerWidth >= 768 && !state.split ? `<button class="add-pane" aria-label="${t('splitToggle')}" data-tooltip="${t('addSplit')}" data-shortcut-action="splitToggle">＋</button>` : ''}
      <button class="previous" aria-label="${t('previous')}" data-tooltip="${t('previous')}" data-shortcut-action="${previousAction}">←</button>
      <button class="next" aria-label="${t('next')}" data-tooltip="${t('next')}" data-shortcut-action="${nextAction}">→</button>
      ${item.kind === 'video' ? `<div class="video-options">
        <button class="loop-toggle" aria-label="${t('loopToggle')}" data-tooltip="${t('loopTip')}" data-shortcut-action="loop">🔁 ${state.loop ? 'ON' : 'OFF'}</button>
        <button class="mute-toggle" aria-label="${t('muteToggle')}" aria-pressed="${state.muted}"
          data-tooltip="${t('muteTip')}" data-shortcut-action="mute">🔇 ${state.muted ? 'ON' : 'OFF'}</button>
      </div>` : ''}
    </div></section>`;
}

function swipePreviewHTML(item) {
  if (!item) return '';
  const source = `/api/media/${item.id}/thumbnail${state.thumbnailVersion ? `?v=${state.thumbnailVersion}` : ''}`;
  return `<span class="swipe-preview-wrap">
    <img class="swipe-preview" src="${source}" alt="" draggable="false" decoding="async">
    ${item.kind === 'video' ? '<span class="swipe-preview-play" aria-hidden="true">▶</span>' : ''}
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
    if (event.target === pane || event.target.classList.contains('swipe-slide')) {
      leaveViewer();
    }
  };
  $('.previous', pane)?.addEventListener('click', event => { event.stopPropagation(); move(index, -1); });
  $('.next', pane)?.addEventListener('click', event => { event.stopPropagation(); move(index, 1); });
  $('.loop-toggle', pane)?.addEventListener('click', event => {
    event.stopPropagation();
    state.loop = !state.loop;
    savePreferences();
    $$('video').forEach(video => video.loop = state.loop);
    $$('.loop-toggle').forEach(button => button.textContent = `🔁 ${state.loop ? 'ON' : 'OFF'}`);
  });
  $('.mute-toggle', pane)?.addEventListener('click', event => {
    event.stopPropagation();
    toggleMuted();
  });
  bindSwipe(pane, index);
}

function applyMuted(value) {
  state.muted = Boolean(value);
  savePreferences();
  $$('video').forEach(video => video.muted = state.muted);
  $$('.mute-toggle').forEach(button => {
    button.textContent = `🔇 ${state.muted ? 'ON' : 'OFF'}`;
    button.setAttribute('aria-pressed', String(state.muted));
  });
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

function imageZoomBounds(pane, image, scale) {
  return {
    x: Math.max(0, (image.clientWidth * scale - pane.clientWidth) / 2),
    y: Math.max(0, (image.clientHeight * scale - pane.clientHeight) / 2)
  };
}

function clampValue(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function resistBound(value, limit) {
  if (value > limit) return limit + (value - limit) * .24;
  if (value < -limit) return -limit + (value + limit) * .24;
  return value;
}

function clampImageZoom(pane, image, zoom) {
  const scale = clampValue(zoom.scale, 1, MAX_IMAGE_ZOOM);
  const bounds = imageZoomBounds(pane, image, scale);
  return {
    scale,
    x: clampValue(zoom.x, -bounds.x, bounds.x),
    y: clampValue(zoom.y, -bounds.y, bounds.y)
  };
}

function applyImageZoom(image, zoom, animate = false) {
  image.classList.toggle('is-zoomed', zoom.scale > 1.001);
  image.classList.toggle('is-zoom-settling', animate);
  image.style.transform = `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})`;
}

function settleImageZoom(pane, image, index, animate = true) {
  state.zoom[index] = clampImageZoom(pane, image, state.zoom[index]);
  applyImageZoom(image, state.zoom[index], animate);
}

function toggleImageZoomAt(pane, image, index, clientX, clientY) {
  const current = state.zoom[index];
  if (current.scale > 1.001) {
    state.zoom[index] = {scale:1, x:0, y:0};
  } else {
    const rect = pane.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const ratio = DOUBLE_TAP_IMAGE_ZOOM / current.scale;
    state.zoom[index] = clampImageZoom(pane, image, {
      scale: DOUBLE_TAP_IMAGE_ZOOM,
      x: clientX - centerX - (clientX - centerX - current.x) * ratio,
      y: clientY - centerY - (clientY - centerY - current.y) * ratio
    });
  }
  applyImageZoom(image, state.zoom[index], true);
}

function bindSwipe(pane, index) {
  const track = $('.swipe-track', pane);
  const image = $('.swipe-slide-current .zoomable', pane);
  const previousAvailable = $('.swipe-slide-previous', pane)?.dataset.available === 'true';
  const nextAvailable = $('.swipe-slide-next', pane)?.dataset.available === 'true';
  const pointers = new Map();
  let primaryPointerId = null;
  let mode = 'idle';
  let startX = 0, startY = 0, startTime = 0, lastX = 0, lastTime = 0, velocityX = 0;
  let startOffset = 0;
  let displayedOffset = Number(state.swipeOffset[index]) || 0;
  let panStart = null;
  let pinchStart = null;
  let lastTap = null;
  let suppressDblClickUntil = 0;
  const setOffset = (offset, animate = false) => {
    track.classList.toggle('is-settling', animate);
    track.style.transform = `translate3d(calc(-100% + ${offset}px), 0, 0)`;
  };
  const readOffset = () => {
    const transform = getComputedStyle(track).transform;
    if (!transform || transform === 'none') return 0;
    try {
      return new DOMMatrixReadOnly(transform).m41 + pane.clientWidth;
    } catch {
      return displayedOffset;
    }
  };
  const settleTrack = () => {
    track.classList.remove('is-dragging');
    displayedOffset = 0;
    setOffset(0, true);
  };
  const capturePointer = pointerId => {
    try { pane.setPointerCapture?.(pointerId); } catch {}
  };
  const pointerPair = () => [...pointers.values()].slice(0, 2);
  const midpoint = pair => ({
    x: (pair[0].x + pair[1].x) / 2,
    y: (pair[0].y + pair[1].y) / 2
  });
  const distance = pair => Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
  const beginPinch = () => {
    const pair = pointerPair();
    if (!image || pair.length < 2) return;
    displayedOffset = 0;
    setOffset(0);
    const middle = midpoint(pair);
    pinchStart = {
      distance: Math.max(1, distance(pair)),
      midpoint: middle,
      zoom: {...state.zoom[index]}
    };
    mode = 'pinch';
    suppressNextViewerClick();
    pointers.forEach((_, pointerId) => capturePointer(pointerId));
    image.classList.remove('is-zoom-settling');
  };
  const updatePinch = () => {
    const pair = pointerPair();
    if (!image || pair.length < 2 || !pinchStart) return;
    const middle = midpoint(pair);
    const rawScale = pinchStart.zoom.scale * distance(pair) / pinchStart.distance;
    const scale = rawScale < 1
      ? 1 - (1 - rawScale) * .2
      : rawScale > MAX_IMAGE_ZOOM
      ? MAX_IMAGE_ZOOM + (rawScale - MAX_IMAGE_ZOOM) * .2
      : rawScale;
    const rect = pane.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const contentX = (pinchStart.midpoint.x - centerX - pinchStart.zoom.x) / pinchStart.zoom.scale;
    const contentY = (pinchStart.midpoint.y - centerY - pinchStart.zoom.y) / pinchStart.zoom.scale;
    const bounds = imageZoomBounds(pane, image, scale);
    state.zoom[index] = {
      scale,
      x: resistBound(middle.x - centerX - contentX * scale, bounds.x),
      y: resistBound(middle.y - centerY - contentY * scale, bounds.y)
    };
    applyImageZoom(image, state.zoom[index]);
  };
  const continueWithRemainingPointer = () => {
    const remaining = pointers.entries().next().value;
    if (!remaining || !image) return;
    primaryPointerId = remaining[0];
    startX = lastX = remaining[1].x;
    startY = remaining[1].y;
    startTime = lastTime = performance.now();
    velocityX = 0;
    panStart = {...state.zoom[index]};
    mode = 'pan';
  };

  track.addEventListener('transitionend', event => {
    if (event.target !== track || event.propertyName !== 'transform' || primaryPointerId !== null) return;
    track.classList.remove('is-settling');
    displayedOffset = 0;
  });
  state.swipeOffset[index] = 0;
  if (displayedOffset) {
    setOffset(displayedOffset);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (primaryPointerId === null) settleTrack();
    }));
  }
  if (image) {
    state.zoom[index] = clampImageZoom(pane, image, state.zoom[index]);
    applyImageZoom(image, state.zoom[index]);
    image.addEventListener('load', () => settleImageZoom(pane, image, index, false), {once:true});
    image.addEventListener('dblclick', event => {
      event.preventDefault();
      event.stopPropagation();
      if (performance.now() < suppressDblClickUntil) return;
      displayedOffset = 0;
      setOffset(0);
      toggleImageZoomAt(pane, image, index, event.clientX, event.clientY);
    });
    image.addEventListener('contextmenu', event => {
      event.preventDefault();
      state.zoom[index] = {scale:1, x:0, y:0};
      applyImageZoom(image, state.zoom[index], true);
    });
  }

  pane.addEventListener('pointerdown', event => {
    const media = event.target.closest('.media, .swipe-preview');
    const continuingSettle = track.classList.contains('is-settling');
    if (event.button !== 0 || !media || (!continuingSettle && !media.closest('.swipe-slide-current'))) return;
    const video = event.target.closest('video');
    if (video && event.clientY >= video.getBoundingClientRect().bottom - 64) return;
    if (continuingSettle) {
      displayedOffset = readOffset();
      setOffset(displayedOffset);
    }
    pointers.set(event.pointerId, {x:event.clientX, y:event.clientY, pointerType:event.pointerType});
    if (image && pointers.size === 2) {
      beginPinch();
      event.preventDefault();
      return;
    }
    if (pointers.size > 1) return;
    primaryPointerId = event.pointerId;
    mode = 'pending';
    startOffset = displayedOffset;
    startX = lastX = event.clientX;
    startY = event.clientY;
    startTime = lastTime = performance.now();
    velocityX = 0;
    panStart = image ? {...state.zoom[index]} : null;
  });

  pane.addEventListener('pointermove', event => {
    const point = pointers.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX;
    point.y = event.clientY;
    if (mode === 'pinch') {
      updatePinch();
      event.preventDefault();
      return;
    }
    if (event.pointerId !== primaryPointerId || mode === 'ignored') return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (mode === 'pending') {
      if (Math.hypot(dx, dy) < 8) return;
      if (image && state.zoom[index].scale > 1.001) {
        mode = 'pan';
        image.classList.remove('is-zoom-settling');
      } else if (Math.abs(dx) > Math.abs(dy) * 1.15) {
        mode = 'swipe';
        track.classList.add('is-dragging');
      } else {
        mode = 'ignored';
        return;
      }
      suppressNextViewerClick();
      capturePointer(event.pointerId);
    }
    if (mode === 'pan' && image && panStart) {
      const bounds = imageZoomBounds(pane, image, state.zoom[index].scale);
      state.zoom[index] = {
        scale: state.zoom[index].scale,
        x: resistBound(panStart.x + dx, bounds.x),
        y: resistBound(panStart.y + dy, bounds.y)
      };
      applyImageZoom(image, state.zoom[index]);
      event.preventDefault();
      return;
    }
    if (mode !== 'swipe') return;
    const now = performance.now();
    const elapsed = now - lastTime;
    if (elapsed > 0) velocityX = (event.clientX - lastX) / elapsed;
    lastX = event.clientX;
    lastTime = now;
    const atEdge = (dx > 0 && !previousAvailable) || (dx < 0 && !nextAvailable);
    displayedOffset = startOffset + (atEdge ? dx * .28 : dx);
    setOffset(displayedOffset);
    event.preventDefault();
  });

  pane.addEventListener('pointerup', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (mode === 'pinch') {
      suppressNextViewerClick();
      if (pointers.size) {
        continueWithRemainingPointer();
      } else if (image) {
        primaryPointerId = null;
        settleImageZoom(pane, image, index);
        mode = 'idle';
      }
      event.preventDefault();
      return;
    }
    if (event.pointerId !== primaryPointerId) return;
    primaryPointerId = null;
    if (mode === 'swipe') {
      suppressNextViewerClick();
      const dx = event.clientX - startX;
      const elapsed = performance.now() - startTime;
      const distanceThreshold = Math.min(pane.clientWidth * .22, 140);
      const fastSwipe = elapsed < 700 && Math.abs(velocityX) >= .45 && Math.abs(dx) >= 28;
      const direction = Math.abs(dx) >= distanceThreshold || fastSwipe ? (dx < 0 ? 1 : -1) : 0;
      const canMove = direction < 0 ? previousAvailable : direction > 0 ? nextAvailable : false;
      if (canMove) {
        track.classList.remove('is-dragging');
        move(index, direction, displayedOffset + direction * pane.clientWidth);
      } else {
        settleTrack();
      }
      event.preventDefault();
    } else if (mode === 'pan' && image) {
      suppressNextViewerClick();
      settleImageZoom(pane, image, index);
      event.preventDefault();
    } else if (mode === 'pending' && image && event.pointerType === 'touch') {
      const now = performance.now();
      if (lastTap && now - lastTap.time <= DOUBLE_TAP_DELAY &&
          Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) <= DOUBLE_TAP_DISTANCE) {
        displayedOffset = 0;
        setOffset(0);
        toggleImageZoomAt(pane, image, index, event.clientX, event.clientY);
        suppressNextViewerClick();
        suppressDblClickUntil = now + 500;
        lastTap = null;
        event.preventDefault();
      } else {
        lastTap = {time:now, x:event.clientX, y:event.clientY};
      }
    }
    mode = 'idle';
  });

  pane.addEventListener('pointercancel', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.clear();
    primaryPointerId = null;
    if (mode === 'swipe') settleTrack();
    if ((mode === 'pan' || mode === 'pinch') && image) settleImageZoom(pane, image, index);
    mode = 'idle';
  });
}

function constrainVisibleViewerZoom() {
  $$('.viewer .pane').forEach(pane => {
    const image = $('.swipe-slide-current .zoomable', pane);
    if (!image) return;
    const index = Number(pane.dataset.pane);
    settleImageZoom(pane, image, index, false);
  });
}

async function move(paneIndex, delta, swipeOffset = 0) {
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
  if (next) openViewer(next.id, paneIndex, swipeOffset);
}

function showSettingsHome() {
  clearTimeout(state.pollTimer);
  app.innerHTML = `<main class="page settings"><header class="settings-header">
    <button id="settings-back">← ${t('backGalleryButton')}</button><button class="secondary" id="logout">${t('logout')}</button>
    </header><section class="settings-grid">
      <button data-settings="shortcuts"><strong>${t('shortcutSettings')}</strong><span>${t('shortcutSummary')}</span></button>
      <button data-settings="roots"><strong>${t('rootSettings')}</strong><span>${t('rootSummary')}</span></button>
      <button data-settings="language"><strong>${t('languageSettings')}</strong><span>${t('languageSummary')}</span></button>
      <button class="danger" data-settings="reset"><strong>${t('resetSettings')}</strong><span>${t('resetSummary')}</span></button>
    </section></main>`;
  $('#settings-back').onclick = showGallery;
  $('#logout').onclick = async () => { await api('/api/auth/logout', {method: 'POST'}); showLogin(); };
  $('[data-settings="shortcuts"]').onclick = showShortcutSettings;
  $('[data-settings="roots"]').onclick = showRootSettings;
  $('[data-settings="language"]').onclick = showLanguageSettings;
  $('[data-settings="reset"]').onclick = showResetSettings;
}

async function showShortcutSettings() {
  const settings = await api('/api/settings');
  const shortcuts = {...state.shortcuts, ...(settings.shortcuts || {})};
  const labels = {
    prev1:t('screen1Previous'), next1:t('screen1Next'),
    prev2:t('screen2Previous'), next2:t('screen2Next'),
    loop:t('loopToggle'), mute:t('muteToggle'),
    splitToggle:t('splitToggle')
  };
  app.innerHTML = `<main class="page settings"><button id="sub-back">← ${t('backSettings')}</button><section class="card">
    <h1>${t('shortcutSettings')}</h1><p class="hint">${t('shortcutHint')}</p>
    <div class="shortcut-list">${Object.entries(labels).map(([key,label]) =>
      `<button class="secondary shortcut" data-shortcut="${key}"><span>${label}</span><kbd>${escapeHTML(shortcuts[key])}</kbd></button>`
    ).join('')}</div><div class="settings-actions">
      <button class="secondary" id="default-shortcuts">${t('restoreDefaults')}</button>
      <button id="save-shortcuts">${t('save')}</button>
    </div><p class="error"></p></section></main>`;
  $('#sub-back').onclick = showSettingsHome;
  $$('.shortcut').forEach(button => button.onclick = () => {
    button.querySelector('kbd').textContent = t('pressKey');
    const capture = event => {
      event.preventDefault();
      shortcuts[button.dataset.shortcut] = event.code;
      button.querySelector('kbd').textContent = event.code;
      document.removeEventListener('keydown', capture, true);
    };
    document.addEventListener('keydown', capture, true);
  });
  $('#default-shortcuts').onclick = () => {
    Object.assign(shortcuts, DEFAULT_SHORTCUTS);
    $$('.shortcut').forEach(button => {
      button.querySelector('kbd').textContent = shortcuts[button.dataset.shortcut];
    });
  };
  $('#save-shortcuts').onclick = async () => {
    try {
      state.shortcuts = await api('/api/settings/shortcuts', {method:'PATCH', body:JSON.stringify(shortcuts)});
      localStorage.setItem('nas-photo-shortcuts-sync', JSON.stringify({
        shortcuts: state.shortcuts,
        updatedAt: Date.now()
      }));
      showSettingsHome();
    } catch (reason) {
      $('.error').textContent = reason.message;
    }
  };
}

function showLanguageSettings() {
  app.innerHTML = `<main class="page settings"><button id="sub-back">← ${t('backSettings')}</button><section class="card">
    <h1>${t('languageSettings')}</h1>
    <div class="language-options">
      <button data-language="en" class="${state.language === 'en' ? '' : 'secondary'}" aria-pressed="${state.language === 'en'}">English</button>
      <button data-language="ja" class="${state.language === 'ja' ? '' : 'secondary'}" aria-pressed="${state.language === 'ja'}">日本語</button>
    </div></section></main>`;
  $('#sub-back').onclick = showSettingsHome;
  $$('[data-language]').forEach(button => button.onclick = () => {
    setLanguage(button.dataset.language);
    showSettingsHome();
  });
}

async function showRootSettings() {
  const settings = await api('/api/settings');
  const roots = settings.roots || [];
  app.innerHTML = `<main class="page settings"><button id="sub-back">← ${t('backSettings')}</button><section class="card">
    <h1>${t('rootSettings')}</h1><div class="root-list">${roots.map(rootRow).join('') || `<p class="empty">${t('noRoots')}</p>`}</div>
    <button id="settings-add-root">＋ ${t('addFolder')}</button><p class="error"></p></section></main>`;
  $('#sub-back').onclick = showSettingsHome;
  $$('.delete-root').forEach(button => button.onclick = async () => {
    await api(`/api/roots/${button.dataset.id}`, {method:'DELETE'});
    showRootSettings();
  });
  $('#settings-add-root').onclick = () => chooseFolder('', async path => {
    try {
      await api('/api/roots', {method:'POST', body:JSON.stringify({path})});
      showRootSettings();
    } catch (reason) {
      $('.error').textContent = reason.message;
    }
  });
}

function showResetSettings() {
  app.innerHTML = `<main class="page settings"><button id="sub-back">← ${t('backSettings')}</button><section class="card">
    <h1>${t('resetTitle')}</h1>
    <p>${t('resetInfo')}</p>
    <label>${t('currentPassword')}<input id="reset-password" type="password"></label>
    <label class="confirm-check"><input id="reset-confirm" type="checkbox"> ${t('confirmImpact')}</label>
    <button class="danger" id="reset-app">${t('reset')}</button><p class="error"></p></section></main>`;
  $('#sub-back').onclick = showSettingsHome;
  $('#reset-app').onclick = async () => {
    if (!$('#reset-confirm').checked) return $('.error').textContent = t('confirmImpactError');
    if (!confirm(t('finalResetConfirm'))) return;
    try {
      await api('/api/settings/reset', {method:'POST', body:JSON.stringify({password:$('#reset-password').value})});
      localStorage.removeItem('nas-photo-preferences');
      boot();
    } catch {
      $('.error').textContent = t('currentPasswordError');
    }
  };
}

let tooltipTimer = null;
let tooltipTarget = null;
let tooltipNode = null;

function shortcutLabel(code) {
  const labels = {
    Space: 'Space', Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→',
    ArrowUp: '↑', ArrowDown: '↓'
  };
  return labels[code] || String(code || '').replace(/^Key/, '').replace(/^Digit/, '');
}

function tooltipText(button) {
  const description = button.dataset.tooltip ||
    button.getAttribute('aria-label') ||
    button.textContent.replace(/\s+/g, ' ').trim();
  const shortcutCode = button.dataset.shortcutAction
    ? state.shortcuts[button.dataset.shortcutAction]
    : button.dataset.shortcutLabel;
  return shortcutCode
    ? `${description} (${t('tooltipShortcut')}: ${shortcutLabel(shortcutCode)})`
    : description;
}

function showTooltip(button) {
  if (!button.isConnected) return;
  tooltipTarget = button;
  if (!tooltipNode) {
    tooltipNode = document.createElement('div');
    tooltipNode.className = 'hover-tooltip';
    tooltipNode.setAttribute('role', 'tooltip');
    document.body.append(tooltipNode);
  }
  tooltipNode.textContent = tooltipText(button);
  tooltipNode.hidden = false;
  tooltipNode.classList.add('is-visible');
  const targetRect = button.getBoundingClientRect();
  const tipRect = tooltipNode.getBoundingClientRect();
  const left = Math.max(8, Math.min(
    innerWidth - tipRect.width - 8,
    targetRect.left + (targetRect.width - tipRect.width) / 2
  ));
  const above = targetRect.top - tipRect.height - 10;
  const top = above >= 8
    ? above
    : Math.min(innerHeight - tipRect.height - 8, targetRect.bottom + 10);
  tooltipNode.style.left = `${left}px`;
  tooltipNode.style.top = `${Math.max(8, top)}px`;
}

function hideTooltip() {
  clearTimeout(tooltipTimer);
  tooltipTimer = null;
  tooltipTarget = null;
  if (tooltipNode) {
    tooltipNode.hidden = true;
    tooltipNode.classList.remove('is-visible');
  }
}

function tooltipButton(target) {
  const button = target.closest?.('button');
  if (!button) return null;
  return button.matches('[data-tooltip]') ||
    button.closest('.viewer, .top, .gallery, .load-area, .option-dialog')
    ? button
    : null;
}

function installTooltipSystem() {
  document.addEventListener('pointerover', event => {
    const button = tooltipButton(event.target);
    if (!button || tooltipTarget === button) return;
    hideTooltip();
    tooltipTarget = button;
    tooltipTimer = setTimeout(() => showTooltip(button), 750);
  });
  document.addEventListener('pointerout', event => {
    const button = tooltipButton(event.target);
    if (!button || button.contains(event.relatedTarget)) return;
    hideTooltip();
  });
  document.addEventListener('pointerdown', hideTooltip);
  document.addEventListener('focusin', event => {
    const button = tooltipButton(event.target);
    if (!button) return;
    hideTooltip();
    tooltipTarget = button;
    tooltipTimer = setTimeout(() => showTooltip(button), 500);
  });
  document.addEventListener('focusout', hideTooltip);
}

document.addEventListener('keydown', event => {
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
  const action = Object.entries(state.shortcuts).find(([, code]) => code === event.code)?.[0];
  if (action === 'splitToggle') {
    event.preventDefault();
    toggleSplit();
    return;
  }
  if (action === 'mute') {
    event.preventDefault();
    toggleMuted();
    return;
  }
  if (embeddedMode) {
    const primaryAction = action === 'prev1' || action === 'next1';
    const secondaryAction = action === 'prev2' || action === 'next2';
    const controlsThisScreen =
      (embeddedRole === 'primary' && primaryAction) ||
      (embeddedRole === 'secondary' && secondaryAction);
    if (controlsThisScreen) {
      if (state.viewer[0]) {
        event.preventDefault();
        move(0, action === 'prev1' || action === 'prev2' ? -1 : 1);
      }
      return;
    }
    if (primaryAction || secondaryAction) {
      event.preventDefault();
      parent.postMessage({
        type: primaryAction ? 'navigatePrimary' : 'navigateSecondary',
        delta:action === 'prev1' || action === 'prev2' ? -1 : 1
      }, location.origin);
      return;
    }
  }
  if (state.split && (action === 'prev1' || action === 'next1' ||
      action === 'prev2' || action === 'next2')) {
    event.preventDefault();
    const primaryAction = action === 'prev1' || action === 'next1';
    postToRole(primaryAction ? 'primary' : 'secondary', {
      type:'navigate',
      delta:action === 'prev1' || action === 'prev2' ? -1 : 1
    });
    return;
  }
  if (!state.viewer[0]) return;
  if (action === 'prev1') move(0, -1);
  if (action === 'next1') move(0, 1);
  if (action === 'loop') {
    state.loop = !state.loop;
    savePreferences();
    $$('video').forEach(video => video.loop = state.loop);
    $$('.loop-toggle').forEach(button => button.textContent = `🔁 ${state.loop ? 'ON' : 'OFF'}`);
    if (state.split) postToSplit({type:'setLoop', value:state.loop});
  }
  if (event.code === 'Space') {
    event.preventDefault();
    $$('video').forEach(video => video.paused ? video.play().catch(() => {}) : video.pause());
    if (state.split) postToSplit({type:'togglePlayback'});
  }
  if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
    const video = $(`.pane[data-pane="${state.activePane}"] video`);
    if (video) video.currentTime = Math.max(0, video.currentTime + (event.code === 'ArrowLeft' ? -10 : 10));
  }
  if (event.code === 'Escape') leaveViewer();
});

function postToSplit(message) {
  postToRole('secondary', message);
}

function postToRole(role, message) {
  $(`.split-window[data-role="${role}"]`)?.contentWindow?.postMessage(message, location.origin);
}

window.addEventListener('message', event => {
  if (event.origin !== location.origin) return;
  if (!embeddedMode && event.data?.type === 'toggleSplit') {
    toggleSplit();
    return;
  }
  if (!embeddedMode && event.data?.type === 'setMuted') {
    applyMuted(event.data.value);
    if (state.split) {
      postToRole('primary', {type:'setMuted', value:state.muted});
      postToRole('secondary', {type:'setMuted', value:state.muted});
    }
    return;
  }
  if (!embeddedMode && state.split && event.data?.type === 'primaryMedia') {
    state.viewer[0] = String(event.data.id || '');
    return;
  }
  if (!embeddedMode && state.split && event.data?.type === 'primaryGallery') {
    state.viewer[0] = null;
    return;
  }
  if (!embeddedMode && state.split &&
      (event.data?.type === 'navigatePrimary' || event.data?.type === 'navigateSecondary')) {
    postToRole(event.data.type === 'navigatePrimary' ? 'primary' : 'secondary', {
      type:'navigate',
      delta:Number(event.data.delta) || 0
    });
    return;
  }
  if (!embeddedMode) return;
  if (event.data?.type === 'navigate' && state.viewer[0]) move(0, Number(event.data.delta) || 0);
  if (event.data?.type === 'setLoop') {
    state.loop = Boolean(event.data.value);
    savePreferences();
    $$('video').forEach(video => video.loop = state.loop);
    $$('.loop-toggle').forEach(button => button.textContent = `🔁 ${state.loop ? 'ON' : 'OFF'}`);
  }
  if (event.data?.type === 'setMuted') applyMuted(event.data.value);
  if (event.data?.type === 'togglePlayback') {
    $$('video').forEach(video => video.paused ? video.play().catch(() => {}) : video.pause());
  }
});

window.addEventListener('resize', () => {
  scheduleRiverLayout();
  if (innerWidth < 768 && state.split) {
    state.split = false;
    if (state.viewer[0]) renderViewer(); else leaveViewer();
  }
  requestAnimationFrame(constrainVisibleViewerZoom);
});

window.addEventListener('storage', event => {
  if (event.key === 'nas-photo-language' && event.newValue) {
    state.language = event.newValue === 'ja' ? 'ja' : 'en';
    document.documentElement.lang = state.language;
    return;
  }
  if (event.key !== 'nas-photo-shortcuts-sync' || !event.newValue) return;
  try {
    const update = JSON.parse(event.newValue);
    if (update.shortcuts) state.shortcuts = {...state.shortcuts, ...update.shortcuts};
  } catch {
    // Ignore malformed cross-window updates.
  }
});

installTooltipSystem();
boot().catch(reason => {
  app.innerHTML = `<main class="page"><section class="card"><h1>NAS-PHOTO</h1>
    <p class="error">${t('bootError')}: ${escapeHTML(reason.message)}</p>
    <button onclick="location.reload()">${t('reload')}</button></section></main>`;
});
