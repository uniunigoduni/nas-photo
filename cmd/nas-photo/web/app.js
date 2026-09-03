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
    captured:'Date captured', created:'Date created', modified:'Date modified', name:'Name', random:'Random',
    all:'All', images:'Images & GIFs', videos:'Videos', ascending:'Ascending', descending:'Descending',
    river:'River', square:'Square', small:'Small', medium:'Medium', large:'Large',
    mediaTip:'Open this media', sortBasis:'Sort by', order:'Order', display:'Layout', size:'Size',
    mediaType:'Media type', index:'Library index', rescanNow:'Scan media folders', applySort:'Apply',
    subSort:'Secondary', noSubSort:'None', sameDayName:'Name within same day',
    thumbnails:'Thumbnails', generateThumbnails:'Generate all missing thumbnails',
    regenerateThumbnails:'Regenerate all thumbnails', cleanupThumbnails:'Find and delete unused thumbnails',
    thumbnailWorking:'Generating thumbnails…', thumbnailCleanupWorking:'Checking thumbnail cache…',
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
    captured:'撮影日', created:'作成日', modified:'変更日', name:'名前', random:'ランダム',
    all:'すべて', images:'画像・GIF', videos:'動画', ascending:'昇順', descending:'降順',
    river:'リバー', square:'正方形', small:'小', medium:'中', large:'大',
    mediaTip:'このメディアを表示', sortBasis:'基準', order:'順序', display:'表示方法', size:'大きさ',
    mediaType:'表示する種類', index:'索引', rescanNow:'メディアフォルダをスキャン', applySort:'変更',
    subSort:'サブ基準', noSubSort:'なし', sameDayName:'同日中は名前順',
    thumbnails:'サムネイル', generateThumbnails:'未作成のサムネイルを一括生成',
    regenerateThumbnails:'サムネイルをすべて再生成', cleanupThumbnails:'不要なサムネイルを調査して削除',
    thumbnailWorking:'サムネイルを生成しています…', thumbnailCleanupWorking:'サムネイルキャッシュを確認しています…',
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
const GESTURE_AXIS_HYSTERESIS = 10;
const GESTURE_VELOCITY_SAMPLE_MS = 50;
const GESTURE_MIN_SWIPE_SPEED = 0.5;
const GESTURE_END_FRICTION = 0.35;
const GESTURE_LOWER_ZOOM_FRICTION = 0.15;
const GESTURE_UPPER_ZOOM_FRICTION = 0.05;
const GESTURE_SWIPE_SPRING_FREQUENCY = 30;
const GESTURE_PAN_SPRING_FREQUENCY = 12;
const GESTURE_ZOOM_SPRING_FREQUENCY = 40;
const WHEEL_ZOOM_SENSITIVITY = 0.0025;

const stored = JSON.parse(localStorage.getItem('nas-photo-preferences') || '{}');
const state = {
  language: localStorage.getItem('nas-photo-language') || 'en',
  items: [],
  total: 0,
  nextOffset: 0,
  sort: stored.sort || 'modified',
  subSort: stored.subSort || '',
  randomSeed: stored.randomSeed || createRandomSeed(),
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
  viewerTransitionSourceId: null,
  zoom: [{scale:1, x:0, y:0}, {scale:1, x:0, y:0}],
  zoomAnimationCancel: [null, null],
  swipeOffset: [0, 0],
  swipeVelocity: [0, 0],
  viewerClickSuppressUntil: 0
};
document.documentElement.lang = state.language;

function t(key) {
  return messages[state.language]?.[key] || messages.en[key] || key;
}

function createRandomSeed() {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return `${values[0].toString(36)}-${values[1].toString(36)}`;
}

function setLanguage(language) {
  state.language = language === 'ja' ? 'ja' : 'en';
  localStorage.setItem('nas-photo-language', state.language);
  document.documentElement.lang = state.language;
}

function savePreferences() {
  localStorage.setItem('nas-photo-preferences', JSON.stringify({
    sort: state.sort, subSort: state.subSort, randomSeed: state.randomSeed, order: state.order, filter: state.filter,
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
      <m3e-button type="button" variant="tonal" toggle ${state.language === 'en' ? 'selected' : ''} data-language="en">English</m3e-button>
      <m3e-button type="button" variant="tonal" toggle ${state.language === 'ja' ? 'selected' : ''} data-language="ja">日本語</m3e-button>
    </div>
    <h1>${t('setupTitle')}</h1>
    <p>${t('setupIntro')}</p>
    <form class="stack" id="password-form">
      <label>${t('password')}<input id="password" type="password" autocomplete="new-password" autofocus></label>
      <label>${t('confirmPassword')}<input id="confirm" type="password" autocomplete="new-password"></label>
      <p class="hint">${t('passwordHint')}</p>
      <m3e-button variant="filled" type="submit">${t('continue')}</m3e-button><p class="error" role="alert"></p>
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
      <div class="stack"><m3e-button variant="tonal" id="add-root"><m3e-icon slot="icon" name="folder"></m3e-icon>${t('chooseFolder')}</m3e-button>
      <m3e-button variant="filled" id="finish-folders" ${roots.length ? '' : 'disabled'}>${t('continue')}</m3e-button>
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
    <m3e-button variant="filled" class="danger delete-root" data-id="${root.id}"><m3e-icon slot="icon" name="delete"></m3e-icon>${t('delete')}</m3e-button></div>`;
}

async function chooseFolder(start, onChoose) {
  let path = start;
  const dialog = createMaterialDialogShell('option-dialog folder-dialog', t('folderTitle'));
  const render = async () => {
    try {
      const result = await api(`/api/folders/browse${path ? `?path=${encodeURIComponent(path)}` : ''}`);
      const folders = result.folders || [];
      renderMaterialDialog(dialog, t('folderTitle'), `
        <p class="chosen">${escapeHTML(result.path || t('selectDrive'))}</p>
        <div class="folder-actions">
          <m3e-button variant="filled" id="choose-current" ${result.path ? '' : 'disabled'}>${t('selectThisFolder')}</m3e-button>
          ${result.parent ? `<m3e-button variant="tonal" id="folder-up"><m3e-icon slot="icon" name="keyboard_arrow_up"></m3e-icon>${t('parentFolder')}</m3e-button>` : ''}
        </div>
        <div class="folder-list">${folders.map(folder => {
          const label = folder.split(/[\\/]/).filter(Boolean).pop() || folder;
          return `<m3e-button variant="tonal" data-folder="${escapeHTML(folder)}"><m3e-icon slot="icon" name="folder"></m3e-icon>${escapeHTML(label)}</m3e-button>`;
        }).join('') || `<p class="empty">${t('noChildren')}</p>`}</div>`,
        `<m3e-button variant="text" id="folder-cancel">${t('cancel')}</m3e-button>`,
        {singleActions: true});
      $('#choose-current', dialog)?.addEventListener('click', async () => { await onChoose(result.path); closeMaterialDialog(dialog); });
      $('#folder-up', dialog)?.addEventListener('click', () => { path = result.parent; render(); });
      $$('[data-folder]', dialog).forEach(button => button.onclick = () => { path = button.dataset.folder; render(); });
      $('#folder-cancel', dialog).onclick = () => closeMaterialDialog(dialog);
    } catch (reason) {
      renderMaterialDialog(dialog, t('folderTitle'), `<p class="error">${escapeHTML(reason.message)}</p>`,
        `<m3e-button variant="text" id="folder-cancel">${t('close')}</m3e-button>`, {singleActions: true});
      $('#folder-cancel', dialog).onclick = () => closeMaterialDialog(dialog);
    }
  };
  await render();
  openMaterialDialog(dialog);
}

function showLogin(foldersRequired = false, notice = '') {
  app.innerHTML = `<main class="page"><section class="card auth-card">
    <h1>${t('login')}</h1>
    ${notice ? `<p class="notice">${escapeHTML(notice)}</p>` : ''}
    ${foldersRequired ? `<p>${t('foldersResume')}</p>` : ''}
    <form class="stack" id="login-form">
      <label>${t('password')}<input id="login-password" type="password" autocomplete="current-password" autofocus></label>
      <m3e-button variant="filled" type="submit">${t('continue')}</m3e-button><p class="error" role="alert"></p>
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
    sort: state.sort, subsort: state.subSort, order: state.order, seed: state.randomSeed, filter: state.filter,
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
  $$('.tile', gallery).forEach(tile => tile.onclick = () => openViewerFromTile(tile));
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

function bindGalleryControls() {
  $('#sort-menu').onclick = showSortDialog;
  $('#view-menu').onclick = () => optionDialog(t('view'), [
    [t('display'), 'layout', [[t('square'), 'square'], [t('river'), 'river']]],
    [t('size'), 'size', [[t('small'), 'small'], [t('medium'), 'medium'], [t('large'), 'large']]]
  ], {layout: state.layout, size: state.size}, draft => {
    state.layout = draft.layout;
    state.size = draft.size;
    savePreferences();
    showGallery();
  });
  $('#filter-menu').onclick = () => optionDialog(t('filter'), [
    [t('mediaType'), 'filter', [[t('all'), ''], [t('images'), 'image'], [t('videos'), 'video']]]
  ], {filter: state.filter}, draft => {
    state.filter = draft.filter;
    savePreferences();
    showGallery();
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

function closeMaterialDialog(dialog) {
  if (!dialog) return;
  if (dialog.open) dialog.open = false;
  else dialog.remove();
}

function createMaterialDialogShell(className = 'option-dialog', title = '') {
  const dialog = document.createElement('m3e-dialog');
  dialog.className = className;
  dialog.innerHTML = `<span slot="header" class="dialog-shell-header"></span>
    <div class="dialog-shell-content"></div>
    <div slot="actions" class="dialog-actions dialog-shell-actions"></div>`;
  if (title) dialog.setAttribute('aria-label', title);
  return dialog;
}

function renderMaterialDialog(dialog, title, body, actions, options = {}) {
  const header = dialog.querySelector(':scope > .dialog-shell-header');
  const content = dialog.querySelector(':scope > .dialog-shell-content');
  const actionBar = dialog.querySelector(':scope > .dialog-shell-actions');
  if (!header || !content || !actionBar) throw new Error('Material dialog shell is incomplete');
  dialog.setAttribute('aria-label', title);
  header.textContent = title;
  content.className = `dialog-shell-content${options.contentClass ? ` ${options.contentClass}` : ''}`;
  content.innerHTML = body;
  actionBar.className = `dialog-actions dialog-shell-actions${options.singleActions ? ' dialog-actions-single' : ''}`;
  actionBar.innerHTML = actions;
}

function openMaterialDialog(dialog) {
  if (!dialog || dialog.isConnected) return;
  dialog.addEventListener('closed', () => dialog.remove(), {once: true});
  document.body.append(dialog);
  dialog.open = true;
}

function showSortDialog() {
  const overlay = createMaterialDialogShell('option-dialog sort-dialog', t('sort'));
  const draft = {sort: state.sort, order: state.order, subSort: state.subSort, randomSeed: state.randomSeed};
  const isDateSort = () => ['captured', 'created', 'modified'].includes(draft.sort);
  const choice = (label, group, value, selected, disabled = false) =>
    `<m3e-button class="sort-choice" variant="tonal" size="small" toggle ${selected ? 'selected' : ''}
      data-group="${group}" data-value="${escapeHTML(value)}" ${disabled ? 'disabled' : ''}>${escapeHTML(label)}</m3e-button>`;
  renderMaterialDialog(overlay, t('sort'), `<div class="sort-dialog-sections">
    <div class="option-section"><div class="option-legend">${escapeHTML(t('sortBasis'))}</div>
      <div class="sort-choice-grid sort-basis-grid" role="group" aria-label="${escapeHTML(t('sortBasis'))}">
        ${choice(t('captured'), 'sort', 'captured', draft.sort === 'captured')}
        ${choice(t('created'), 'sort', 'created', draft.sort === 'created')}
        ${choice(t('modified'), 'sort', 'modified', draft.sort === 'modified')}
        ${choice(t('name'), 'sort', 'name', draft.sort === 'name')}
        ${choice(t('random'), 'sort', 'random', draft.sort === 'random')}
      </div></div>
    <div class="option-section"><div class="option-legend">${escapeHTML(t('subSort'))}</div>
      <div class="sort-choice-grid" role="group" aria-label="${escapeHTML(t('subSort'))}">
        ${choice(t('noSubSort'), 'subsort', '', draft.subSort === '')}
        ${choice(t('sameDayName'), 'subsort', 'same-day-name', draft.subSort === 'same-day-name', !isDateSort())}
      </div></div>

    <div class="option-section"><div class="option-legend">${escapeHTML(t('order'))}</div>
      <div class="sort-choice-grid" role="group" aria-label="${escapeHTML(t('order'))}">
        ${choice(t('ascending'), 'order', 'asc', draft.order === 'asc')}
        ${choice(t('descending'), 'order', 'desc', draft.order === 'desc')}
      </div></div></div>`, `
    <m3e-button variant="text" id="sort-cancel">${escapeHTML(t('cancel'))}</m3e-button>
    <m3e-button variant="filled" id="sort-apply">${escapeHTML(t('applySort'))}</m3e-button>`);
  const sync = () => {
    $$('[data-group="sort"]', overlay).forEach(button => button.selected = button.dataset.value === draft.sort);
    $$('[data-group="order"]', overlay).forEach(button => button.selected = button.dataset.value === draft.order);
    $$('[data-group="subsort"]', overlay).forEach(button => {
      button.selected = button.dataset.value === draft.subSort;
      if (button.dataset.value === 'same-day-name') button.disabled = !isDateSort();
    });
  };
  const bindChoice = (selector, updateDraft) => {
    $$(selector, overlay).forEach(button => button.onbeforeinput = event => {
      event.preventDefault();
      updateDraft(button);
      sync();
    });
  };
  bindChoice('[data-group="sort"]', button => {
    const previous = draft.sort;
    draft.sort = button.dataset.value;
    if (!isDateSort()) draft.subSort = '';
    if (draft.sort === 'random' && previous !== 'random') draft.randomSeed = createRandomSeed();
  });
  bindChoice('[data-group="order"]', button => { draft.order = button.dataset.value; });
  bindChoice('[data-group="subsort"]', button => { draft.subSort = button.dataset.value; });
  $('#sort-cancel', overlay).onclick = () => closeMaterialDialog(overlay);
  $('#sort-apply', overlay).onclick = () => {
    state.sort = draft.sort;
    state.order = draft.order;
    state.subSort = draft.subSort;
    state.randomSeed = draft.randomSeed;
    savePreferences();
    closeMaterialDialog(overlay);
    showGallery();
  };
  openMaterialDialog(overlay);
}

function optionDialog(title, sections, initialValues, onSave) {
  const overlay = createMaterialDialogShell('option-dialog', title);
  const draft = {...initialValues};
  const choice = (label, group, value, selected, disabled = false) =>
    `<m3e-button variant="tonal" size="small" class="option" toggle ${selected ? 'selected' : ''}
      data-group="${escapeHTML(group)}" data-value="${escapeHTML(value)}" ${disabled ? 'disabled' : ''}>${escapeHTML(label)}</m3e-button>`;
  renderMaterialDialog(overlay, title, `<div class="option-dialog-sections">${sections.map(([label, group, options]) => `<div class="option-section">
    <div class="option-legend">${escapeHTML(label)}</div>

    <div class="option-choice-grid" role="group" aria-label="${escapeHTML(label)}">
      ${options.map(([optionText, value, disabled = false]) => choice(optionText, group, value,
        Object.prototype.hasOwnProperty.call(draft, group) && draft[group] === value, disabled)).join('')}
    </div></div>`).join('')}</div>`, `
    <m3e-button variant="text" id="option-close">${escapeHTML(t('close'))}</m3e-button>
    <m3e-button variant="filled" id="option-save" ${Object.keys(draft).length ? '' : 'disabled'}>${escapeHTML(t('save'))}</m3e-button>`);
  $$('.option', overlay).forEach(button => button.onbeforeinput = event => {
    event.preventDefault();
    draft[button.dataset.group] = button.dataset.value;
    $$('.option', overlay).forEach(candidate => {
      if (candidate.dataset.group === button.dataset.group) candidate.selected = candidate.dataset.value === button.dataset.value;
    });
  });
  $('#option-close', overlay).onclick = () => closeMaterialDialog(overlay);
  $('#option-save', overlay).onclick = async () => {
    const values = {...draft};
    closeMaterialDialog(overlay);
    await onSave(values);
  };
  openMaterialDialog(overlay);
}

function actionDialog(title, sections, onSelect) {
  const overlay = createMaterialDialogShell('option-dialog action-dialog', title);
  renderMaterialDialog(overlay, title, `<div class="option-dialog-sections">${sections.map(([label, options]) => `<div class="option-section">
    <div class="option-legend">${escapeHTML(label)}</div>
    <div class="option-choice-grid" role="group" aria-label="${escapeHTML(label)}">
      ${options.map(([optionText, value, disabled = false]) => `<m3e-button variant="tonal" size="small" class="option"
        data-value="${escapeHTML(value)}" ${disabled ? 'disabled' : ''}>${escapeHTML(optionText)}</m3e-button>`).join('')}
    </div></div>`).join('')}</div>`,
    `<m3e-button variant="text" id="option-close">${escapeHTML(t('close'))}</m3e-button>`, {singleActions: true});
  $$('.option', overlay).forEach(button => button.onclick = async () => {
    const value = button.dataset.value;
    closeMaterialDialog(overlay);
    await onSelect(value);
  });
  $('#option-close', overlay).onclick = () => closeMaterialDialog(overlay);
  openMaterialDialog(overlay);
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
      renderTiles(false);
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

function openViewer(id, paneIndex = 0, swipeOffset = 0, swipeVelocity = 0) {
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
        <div class="split-divider"><m3e-icon-button variant="tonal" size="small" class="end-split" aria-label="${t('endSplit')}"
          data-tooltip="${t('endSplit')}" data-shortcut-action="splitToggle"><m3e-icon name="close"></m3e-icon></m3e-icon-button></div>
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

function containedMediaSize(containerWidth, containerHeight, naturalWidth, naturalHeight) {
  const width = Math.max(1, Number(naturalWidth) || containerWidth);
  const height = Math.max(1, Number(naturalHeight) || containerHeight);
  const fit = Math.min(containerWidth / width, containerHeight / height);
  return {width:width * fit, height:height * fit};
}

function containedImageSize(pane, image) {
  const placeholder = $('.viewer-image-placeholder', image.closest('.viewer-image-stage'));
  const measurable = image.naturalWidth ? image : placeholder;
  return containedMediaSize(
    pane.clientWidth, pane.clientHeight,
    measurable?.naturalWidth || pane.clientWidth,
    measurable?.naturalHeight || pane.clientHeight
  );
}

function fitSwipePreviews(pane) {
  $$('.swipe-preview', pane).forEach(image => {
    const fit = () => {
      const naturalWidth = Number(image.dataset.mediaWidth) || image.naturalWidth;
      const naturalHeight = Number(image.dataset.mediaHeight) || image.naturalHeight;
      if (!naturalWidth || !naturalHeight || !pane.clientWidth || !pane.clientHeight) return;
      const rendered = containedMediaSize(pane.clientWidth, pane.clientHeight, naturalWidth, naturalHeight);
      image.style.width = `${rendered.width}px`;
      image.style.height = `${rendered.height}px`;
    };
    fit();
    if (!image.complete) image.addEventListener('load', fit, {once:true});
  });
}

function imageZoomBounds(pane, image, scale) {
  const rendered = containedImageSize(pane, image);
  return {
    x: Math.max(0, (rendered.width * scale - pane.clientWidth) / 2),
    y: Math.max(0, (rendered.height * scale - pane.clientHeight) / 2)
  };
}

function isPointOutsideDisplayedImage(pane, image, zoom, clientX, clientY) {
  const rect = pane.getBoundingClientRect();
  const rendered = containedImageSize(pane, image);
  const width = rendered.width * zoom.scale;
  const height = rendered.height * zoom.scale;
  const centerX = rect.left + rect.width / 2 + zoom.x;
  const centerY = rect.top + rect.height / 2 + zoom.y;
  return clientX < centerX - width / 2 || clientX > centerX + width / 2 ||
    clientY < centerY - height / 2 || clientY > centerY + height / 2;
}

function clampValue(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function resistBound(value, limit) {
  if (value > limit) return limit + (value - limit) * GESTURE_END_FRICTION;
  if (value < -limit) return -limit + (value + limit) * GESTURE_END_FRICTION;
  return value;
}

function projectGestureVelocity(velocity, decelerationRate = 0.995) {
  return velocity * decelerationRate / (1 - decelerationRate);
}

function startGestureSpring({start, end, velocity = 0, dampingRatio = 1, naturalFrequency = 30, onUpdate, onComplete}) {
  let position = start;
  let speed = velocity * 1000;
  let frame = 0;
  let previousTime = performance.now();
  let active = true;
  const initialDistance = Math.abs(end - start);
  const positionTolerance = Math.max(0.001, initialDistance * 0.001);
  const speedTolerance = Math.max(0.02, initialDistance * 0.05);

  const step = now => {
    if (!active) return;
    let remaining = Math.min(32, Math.max(0, now - previousTime)) / 1000;
    previousTime = now;
    while (remaining > 0) {
      const dt = Math.min(remaining, 1 / 120);
      const displacement = position - end;
      const acceleration = -2 * dampingRatio * naturalFrequency * speed
        - naturalFrequency * naturalFrequency * displacement;
      speed += acceleration * dt;
      position += speed * dt;
      remaining -= dt;
    }
    onUpdate(position);
    if (Math.abs(position - end) <= positionTolerance && Math.abs(speed) <= speedTolerance) {
      onUpdate(end);
      active = false;
      onComplete?.();
      return;
    }
    frame = requestAnimationFrame(step);
  };

  frame = requestAnimationFrame(step);
  return () => {
    active = false;
    cancelAnimationFrame(frame);
  };
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

function imageZoomAtPoint(pane, image, zoom, targetScale, clientX, clientY) {
  const scale = clampValue(targetScale, 1, MAX_IMAGE_ZOOM);
  if (scale <= 1.001) return {scale:1, x:0, y:0};
  const rect = pane.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const ratio = scale / zoom.scale;
  return clampImageZoom(pane, image, {
    scale,
    x: clientX - centerX - (clientX - centerX - zoom.x) * ratio,
    y: clientY - centerY - (clientY - centerY - zoom.y) * ratio
  });
}

function normalizedWheelDelta(event, pane) {
  const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pane.clientHeight : 1;
  return clampValue(event.deltaY * multiplier, -240, 240);
}

function applyImageZoom(image, zoom) {
  image.classList.toggle('is-zoomed', zoom.scale > 1.001);
  const transform = `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})`;
  image.style.transform = transform;
  const stage = image.closest('.viewer-image-stage');
  const placeholder = stage ? $('.viewer-image-placeholder', stage) : null;
  if (placeholder) placeholder.style.transform = transform;
}

function animateImageZoomTo(pane, image, index, target, options = {}) {
  state.zoomAnimationCancel[index]?.();
  const start = {...state.zoom[index]};
  const distance = {
    scale: target.scale - start.scale,
    x: target.x - start.x,
    y: target.y - start.y
  };
  const velocity = options.velocity || {x:0, y:0};
  const dominantAxis = Math.abs(distance.x) >= Math.abs(distance.y) ? 'x' : 'y';
  const dominantDistance = distance[dominantAxis];
  const progressVelocity = Math.abs(dominantDistance) > 0.5
    ? (velocity[dominantAxis] || 0) / dominantDistance
    : 0;
  const cancel = startGestureSpring({
    start: 0,
    end: 1,
    velocity: progressVelocity,
    dampingRatio: options.dampingRatio ?? 1,
    naturalFrequency: options.naturalFrequency ?? GESTURE_ZOOM_SPRING_FREQUENCY,
    onUpdate: progress => {
      if (!image.isConnected) {
        cancel();
        return;
      }
      state.zoom[index] = {
        scale: start.scale + distance.scale * progress,
        x: start.x + distance.x * progress,
        y: start.y + distance.y * progress
      };
      applyImageZoom(image, state.zoom[index]);
    },
    onComplete: () => {
      state.zoom[index] = {...target};
      applyImageZoom(image, state.zoom[index]);
      state.zoomAnimationCancel[index] = null;
    }
  });
  state.zoomAnimationCancel[index] = cancel;
}

function revealFullViewerImage(image) {
  const stage = image.closest('.viewer-image-stage');
  if (!stage || stage.classList.contains('is-loaded')) return;
  const reveal = () => {
    if (!image.isConnected || !image.naturalWidth) return;
    stage.classList.add('is-loaded');
    const placeholder = $('.viewer-image-placeholder', stage);
    if (placeholder) setTimeout(() => placeholder.remove(), 110);
  };
  if (image.complete && image.naturalWidth) {
    image.decode?.().then(reveal, reveal);
  } else {
    image.addEventListener('load', () => image.decode?.().then(reveal, reveal) ?? reveal(), {once:true});
  }
}

function settleImageZoom(pane, image, index, animate = true, velocity = {x:0, y:0}) {
  const current = state.zoom[index];
  const projected = current.scale >= 1 && current.scale <= MAX_IMAGE_ZOOM
    ? {
        scale: current.scale,
        x: current.x + projectGestureVelocity(velocity.x || 0),
        y: current.y + projectGestureVelocity(velocity.y || 0)
      }
    : current;
  const target = clampImageZoom(pane, image, projected);
  if (!animate) {
    state.zoomAnimationCancel[index]?.();
    state.zoomAnimationCancel[index] = null;
    state.zoom[index] = target;
    applyImageZoom(image, target);
    return;
  }
  const projectedOutsideBounds = Math.abs(projected.x - target.x) > 0.5 || Math.abs(projected.y - target.y) > 0.5;
  animateImageZoomTo(pane, image, index, target, {
    velocity,
    naturalFrequency: GESTURE_PAN_SPRING_FREQUENCY,
    dampingRatio: projectedOutsideBounds ? 0.82 : 1
  });
}

function toggleImageZoomAt(pane, image, index, clientX, clientY) {
  const current = state.zoom[index];
  let target;
  if (current.scale > 1.001) {
    target = {scale:1, x:0, y:0};
  } else {
    target = imageZoomAtPoint(pane, image, current, DOUBLE_TAP_IMAGE_ZOOM, clientX, clientY);
  }
  animateImageZoomTo(pane, image, index, target, {naturalFrequency: GESTURE_ZOOM_SPRING_FREQUENCY});
}

function bindSwipe(pane, index) {
  fitSwipePreviews(pane);
  const track = $('.swipe-track', pane);
  const image = $('.swipe-slide-current .zoomable', pane);
  const previousAvailable = $('.swipe-slide-previous', pane)?.dataset.available === 'true';
  const nextAvailable = $('.swipe-slide-next', pane)?.dataset.available === 'true';
  const pointers = new Map();
  let primaryPointerId = null;
  let mode = 'idle';
  let dragAxis = null;
  let startX = 0;
  let startY = 0;
  let startOffset = 0;
  let displayedOffset = Number(state.swipeOffset[index]) || 0;
  const initialSettleVelocity = Number(state.swipeVelocity[index]) || 0;
  let panStart = null;
  let pinchStart = null;
  let lastTap = null;
  let suppressDblClickUntil = 0;
  let trackSpringCancel = null;
  let gestureFrame = 0;
  let pendingOffset = null;
  let pendingZoom = null;
  let sampleTime = 0;
  let sampleX = 0;
  let sampleY = 0;
  const velocity = {x:0, y:0};

  const setOffsetNow = offset => {
    track.style.transform = `translate3d(calc(-100% + ${offset}px), 0, 0)`;
  };
  const paintPending = () => {
    gestureFrame = 0;
    if (pendingOffset !== null) {
      setOffsetNow(pendingOffset);
      pendingOffset = null;
    }
    if (pendingZoom && image) {
      applyImageZoom(image, pendingZoom);
      pendingZoom = null;
    }
  };
  const schedulePaint = () => {
    if (!gestureFrame) gestureFrame = requestAnimationFrame(paintPending);
  };
  const queueOffset = offset => {
    displayedOffset = offset;
    pendingOffset = offset;
    schedulePaint();
  };
  const queueZoom = zoom => {
    state.zoom[index] = zoom;
    pendingZoom = {...zoom};
    schedulePaint();
  };
  const flushPaint = () => {
    if (gestureFrame) cancelAnimationFrame(gestureFrame);
    if (gestureFrame || pendingOffset !== null || pendingZoom) paintPending();
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
  const stopTrackSpring = () => {
    trackSpringCancel?.();
    trackSpringCancel = null;
    track.classList.remove('is-settling');
  };
  const springTrackTo = (target, releaseVelocity = 0) => {
    flushPaint();
    stopTrackSpring();
    track.classList.remove('is-dragging');
    track.classList.add('is-settling');
    const springStart = displayedOffset;
    trackSpringCancel = startGestureSpring({
      start: springStart,
      end: target,
      velocity: releaseVelocity,
      dampingRatio: 1,
      naturalFrequency: GESTURE_SWIPE_SPRING_FREQUENCY,
      onUpdate: offset => {
        if (!track.isConnected) {
          stopTrackSpring();
          return;
        }
        displayedOffset = offset;
        setOffsetNow(offset);
      },
      onComplete: () => {
        displayedOffset = target;
        setOffsetNow(target);
        track.classList.remove('is-settling');
        trackSpringCancel = null;
      }
    });
  };
  const settleTrack = (releaseVelocity = 0) => springTrackTo(0, releaseVelocity);
  const capturePointer = pointerId => {
    try { pane.setPointerCapture?.(pointerId); } catch {}
  };
  const pointerPair = () => [...pointers.values()].slice(0, 2);
  const midpoint = pair => ({
    x: (pair[0].x + pair[1].x) / 2,
    y: (pair[0].y + pair[1].y) / 2
  });
  const distance = pair => Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);

  const resetVelocity = (x, y) => {
    sampleX = x;
    sampleY = y;
    sampleTime = performance.now();
    velocity.x = 0;
    velocity.y = 0;
  };
  const sampleVelocity = (x, y, force = false) => {
    const now = performance.now();
    const elapsed = now - sampleTime;
    if (!force && elapsed < GESTURE_VELOCITY_SAMPLE_MS) return;
    velocity.x = Math.abs(x - sampleX) > 1 && elapsed > 5 ? (x - sampleX) / elapsed : 0;
    velocity.y = Math.abs(y - sampleY) > 1 && elapsed > 5 ? (y - sampleY) / elapsed : 0;
    sampleX = x;
    sampleY = y;
    sampleTime = now;
  };

  const beginPinch = () => {
    const pair = pointerPair();
    if (!image || pair.length < 2) return;
    flushPaint();
    stopTrackSpring();
    state.zoomAnimationCancel[index]?.();
    state.zoomAnimationCancel[index] = null;
    displayedOffset = 0;
    setOffsetNow(0);
    const middle = midpoint(pair);
    pinchStart = {
      distance: Math.max(1, distance(pair)),
      midpoint: middle,
      zoom: {...state.zoom[index]}
    };
    mode = 'pinch';
    dragAxis = null;
    suppressNextViewerClick();
    pointers.forEach((_, pointerId) => capturePointer(pointerId));
  };
  const updatePinch = () => {
    const pair = pointerPair();
    if (!image || pair.length < 2 || !pinchStart) return;
    const middle = midpoint(pair);
    const rawScale = pinchStart.zoom.scale * distance(pair) / pinchStart.distance;
    const scale = rawScale < 1
      ? 1 - (1 - rawScale) * GESTURE_LOWER_ZOOM_FRICTION
      : rawScale > MAX_IMAGE_ZOOM
      ? MAX_IMAGE_ZOOM + (rawScale - MAX_IMAGE_ZOOM) * GESTURE_UPPER_ZOOM_FRICTION
      : rawScale;
    const rect = pane.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const contentX = (pinchStart.midpoint.x - centerX - pinchStart.zoom.x) / pinchStart.zoom.scale;
    const contentY = (pinchStart.midpoint.y - centerY - pinchStart.zoom.y) / pinchStart.zoom.scale;
    const bounds = imageZoomBounds(pane, image, scale);
    queueZoom({
      scale,
      x: resistBound(middle.x - centerX - contentX * scale, bounds.x),
      y: resistBound(middle.y - centerY - contentY * scale, bounds.y)
    });
  };
  const continueWithRemainingPointer = () => {
    const remaining = pointers.entries().next().value;
    if (!remaining || !image) return;
    primaryPointerId = remaining[0];
    startX = remaining[1].x;
    startY = remaining[1].y;
    startOffset = displayedOffset = 0;
    panStart = {...state.zoom[index]};
    mode = 'pending';
    dragAxis = null;
    resetVelocity(startX, startY);
  };

  state.swipeOffset[index] = 0;
  state.swipeVelocity[index] = 0;
  if (displayedOffset) {
    setOffsetNow(displayedOffset);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (primaryPointerId === null) settleTrack(initialSettleVelocity);
    }));
  }
  if (image) {
    state.zoom[index] = clampImageZoom(pane, image, state.zoom[index]);
    applyImageZoom(image, state.zoom[index]);
    revealFullViewerImage(image);
    image.addEventListener('load', () => settleImageZoom(pane, image, index, false), {once:true});
    image.addEventListener('dblclick', event => {
      event.preventDefault();
      event.stopPropagation();
      if (performance.now() < suppressDblClickUntil) return;
      flushPaint();
      stopTrackSpring();
      displayedOffset = 0;
      setOffsetNow(0);
      toggleImageZoomAt(pane, image, index, event.clientX, event.clientY);
    });
    image.addEventListener('contextmenu', event => {
      event.preventDefault();
      animateImageZoomTo(pane, image, index, {scale:1, x:0, y:0}, {
        naturalFrequency: GESTURE_ZOOM_SPRING_FREQUENCY
      });
    });
    pane.addEventListener('wheel', event => {
      if (pointers.size || event.target.closest('.controls, button, m3e-button, m3e-icon-button, video')) return;
      const delta = normalizedWheelDelta(event, pane);
      if (!delta) return;
      event.preventDefault();
      flushPaint();
      stopTrackSpring();
      displayedOffset = 0;
      setOffsetNow(0);
      state.zoomAnimationCancel[index]?.();
      state.zoomAnimationCancel[index] = null;
      const current = state.zoom[index];
      const targetScale = clampValue(current.scale * Math.exp(-delta * WHEEL_ZOOM_SENSITIVITY), 1, MAX_IMAGE_ZOOM);
      queueZoom(imageZoomAtPoint(pane, image, current, targetScale, event.clientX, event.clientY));
    }, {passive:false});
  }

  pane.addEventListener('pointerdown', event => {
    const media = event.target.closest('.media, .swipe-preview');
    const continuingSettle = Boolean(trackSpringCancel) || track.classList.contains('is-settling');
    if (event.button !== 0 || !media || (!continuingSettle && !media.closest('.swipe-slide-current'))) return;
    const video = event.target.closest('video');
    if (video && event.clientY >= video.getBoundingClientRect().bottom - 64) return;
    flushPaint();
    if (continuingSettle) {
      displayedOffset = readOffset();
      stopTrackSpring();
      setOffsetNow(displayedOffset);
    }
    state.zoomAnimationCancel[index]?.();
    state.zoomAnimationCancel[index] = null;
    pointers.set(event.pointerId, {x:event.clientX, y:event.clientY, pointerType:event.pointerType});
    if (image && pointers.size === 2) {
      beginPinch();
      event.preventDefault();
      return;
    }
    if (pointers.size > 1) return;
    primaryPointerId = event.pointerId;
    mode = 'pending';
    dragAxis = null;
    startOffset = displayedOffset;
    startX = event.clientX;
    startY = event.clientY;
    panStart = image ? {...state.zoom[index]} : null;
    resetVelocity(startX, startY);
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
      if (Math.hypot(dx, dy) < GESTURE_AXIS_HYSTERESIS) return;
      dragAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (image && state.zoom[index].scale > 1.001) {
        const bounds = imageZoomBounds(pane, image, state.zoom[index].scale);
        const touchLike = event.pointerType !== 'mouse';
        const canSwipeFromZoomEdge = dragAxis === 'x' && touchLike && (
          (dx > 0 && previousAvailable && panStart.x >= bounds.x - 0.5) ||
          (dx < 0 && nextAvailable && panStart.x <= -bounds.x + 0.5)
        );
        mode = canSwipeFromZoomEdge ? 'swipe' : 'pan';
      } else {
        mode = dragAxis === 'x' ? 'swipe' : 'ignored';
      }
      if (mode === 'ignored') return;
      suppressNextViewerClick();
      capturePointer(event.pointerId);
      if (mode === 'swipe') track.classList.add('is-dragging');
      startX = event.clientX;
      startY = event.clientY;
      startOffset = displayedOffset;
      panStart = image ? {...state.zoom[index]} : null;
      resetVelocity(startX, startY);
      event.preventDefault();
      return;
    }
    sampleVelocity(event.clientX, event.clientY);
    if (mode === 'pan' && image && panStart) {
      const bounds = imageZoomBounds(pane, image, state.zoom[index].scale);
      queueZoom({
        scale: state.zoom[index].scale,
        x: resistBound(panStart.x + (event.clientX - startX), bounds.x),
        y: resistBound(panStart.y + (event.clientY - startY), bounds.y)
      });
      event.preventDefault();
      return;
    }
    if (mode !== 'swipe') return;
    const swipeDx = event.clientX - startX;
    const atEdge = (swipeDx > 0 && !previousAvailable) || (swipeDx < 0 && !nextAvailable);
    queueOffset(startOffset + (atEdge ? swipeDx * GESTURE_END_FRICTION : swipeDx));
    event.preventDefault();
  });

  pane.addEventListener('pointerup', event => {
    if (!pointers.has(event.pointerId)) return;
    if (event.pointerId === primaryPointerId && mode !== 'pinch') {
      sampleVelocity(event.clientX, event.clientY, true);
    }
    pointers.delete(event.pointerId);
    flushPaint();
    if (mode === 'pinch') {
      suppressNextViewerClick();
      if (pointers.size) {
        continueWithRemainingPointer();
      } else if (image) {
        primaryPointerId = null;
        settleImageZoom(pane, image, index, true);
        mode = 'idle';
        dragAxis = null;
      }
      event.preventDefault();
      return;
    }
    if (event.pointerId !== primaryPointerId) return;
    primaryPointerId = null;
    const releaseVelocity = {...velocity};
    if (mode === 'swipe') {
      suppressNextViewerClick();
      const projectedOffset = displayedOffset + projectGestureVelocity(releaseVelocity.x);
      const distanceThreshold = clampValue(pane.clientWidth * 0.2, 50, 225);
      const velocityCommit = Math.abs(releaseVelocity.x) >= GESTURE_MIN_SWIPE_SPEED
        && Math.abs(displayedOffset) >= GESTURE_AXIS_HYSTERESIS;
      const distanceCommit = Math.abs(projectedOffset) >= distanceThreshold;
      const directionSource = velocityCommit ? releaseVelocity.x : projectedOffset;
      const direction = velocityCommit || distanceCommit ? (directionSource < 0 ? 1 : -1) : 0;
      const canMove = direction < 0 ? previousAvailable : direction > 0 ? nextAvailable : false;
      if (canMove) {
        stopTrackSpring();
        track.classList.remove('is-dragging');
        move(index, direction, displayedOffset + direction * pane.clientWidth, releaseVelocity.x);
      } else {
        settleTrack(releaseVelocity.x);
      }
      event.preventDefault();
    } else if (mode === 'pan' && image) {
      suppressNextViewerClick();
      settleImageZoom(pane, image, index, true, releaseVelocity);
      event.preventDefault();
    } else if (mode === 'pending' && image && event.pointerType === 'touch') {
      const now = performance.now();
      if (lastTap && now - lastTap.time <= DOUBLE_TAP_DELAY &&
          Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) <= DOUBLE_TAP_DISTANCE) {
        stopTrackSpring();
        displayedOffset = 0;
        setOffsetNow(0);
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
    dragAxis = null;
  });

  pane.addEventListener('pointercancel', event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.clear();
    primaryPointerId = null;
    flushPaint();
    if (mode === 'swipe') settleTrack(velocity.x);
    if ((mode === 'pan' || mode === 'pinch') && image) settleImageZoom(pane, image, index, true, velocity);
    mode = 'idle';
    dragAxis = null;
  });
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
  if (next) openViewer(next.id, paneIndex, swipeOffset, swipeVelocity);
}

function renderSettingsDialog(dialog, title, body, actions, singleActions = false) {
  renderMaterialDialog(dialog, title, body, actions, {contentClass: 'settings-dialog-body', singleActions});
}

function openSettingsDialog() {
  const dialog = createMaterialDialogShell('option-dialog settings-dialog', t('settings'));
  renderSettingsHome(dialog);
  openMaterialDialog(dialog);
}

function renderSettingsHome(dialog) {
  dialog.disableClose = false;
  renderSettingsDialog(dialog, t('settings'), `
    <div class="settings-dialog-menu">
      <m3e-button variant="tonal" class="settings-dialog-item" data-settings="shortcuts">${t('shortcutSettings')}</m3e-button>
      <m3e-button variant="tonal" class="settings-dialog-item" data-settings="roots">${t('rootSettings')}</m3e-button>
      <m3e-button variant="tonal" class="settings-dialog-item" data-settings="language">${t('languageSettings')}</m3e-button>
      <m3e-button variant="filled" class="settings-dialog-item danger" data-settings="reset">${t('resetSettings')}</m3e-button>
      <m3e-button variant="tonal" class="settings-dialog-item" id="logout">${t('logout')}</m3e-button>
    </div>`, `<m3e-button variant="text" id="settings-close">${t('close')}</m3e-button>`, true);

  $('#settings-close', dialog).onclick = () => closeMaterialDialog(dialog);
  $('#logout', dialog).onclick = async () => {
    closeMaterialDialog(dialog);
    await api('/api/auth/logout', {method:'POST'});
    showLogin();
  };
  $('[data-settings="shortcuts"]', dialog).onclick = () => renderShortcutSettings(dialog);
  $('[data-settings="roots"]', dialog).onclick = () => renderRootSettings(dialog);
  $('[data-settings="language"]', dialog).onclick = () => renderLanguageSettings(dialog);
  $('[data-settings="reset"]', dialog).onclick = () => renderResetSettings(dialog);
}

async function renderShortcutSettings(dialog) {
  dialog.disableClose = true;
  const settings = await api('/api/settings');
  const shortcuts = {...state.shortcuts, ...(settings.shortcuts || {})};
  const labels = {
    prev1:t('screen1Previous'), next1:t('screen1Next'), prev2:t('screen2Previous'), next2:t('screen2Next'),
    loop:t('loopToggle'), mute:t('muteToggle'), splitToggle:t('splitToggle')
  };
  renderSettingsDialog(dialog, t('shortcutSettings'), `
    <div class="settings-shortcut-list">${Object.entries(labels).map(([key,label]) =>
      `<m3e-button variant="tonal" class="shortcut" data-shortcut="${key}"><span class="shortcut-content"><span>${label}</span><kbd>${escapeHTML(shortcuts[key])}</kbd></span></m3e-button>`
    ).join('')}</div>
    <m3e-button variant="tonal" id="default-shortcuts">${t('restoreDefaults')}</m3e-button><p class="error"></p>`, `
    <m3e-button variant="text" id="settings-back">${t('backSettings')}</m3e-button>
    <m3e-button variant="filled" id="save-shortcuts">${t('save')}</m3e-button>`);

  $('#settings-back', dialog).onclick = () => renderSettingsHome(dialog);
  $$('.shortcut', dialog).forEach(button => button.onclick = () => {
    button.querySelector('kbd').textContent = t('pressKey');
    const capture = event => {
      event.preventDefault();
      shortcuts[button.dataset.shortcut] = event.code;
      button.querySelector('kbd').textContent = event.code;
      document.removeEventListener('keydown', capture, true);
    };
    document.addEventListener('keydown', capture, true);
  });
  $('#default-shortcuts', dialog).onclick = () => {
    Object.assign(shortcuts, DEFAULT_SHORTCUTS);
    $$('.shortcut', dialog).forEach(button => button.querySelector('kbd').textContent = shortcuts[button.dataset.shortcut]);
  };
  $('#save-shortcuts', dialog).onclick = async () => {
    try {
      state.shortcuts = await api('/api/settings/shortcuts', {method:'PATCH', body:JSON.stringify(shortcuts)});
      localStorage.setItem('nas-photo-shortcuts-sync', JSON.stringify({shortcuts:state.shortcuts, updatedAt:Date.now()}));
      renderSettingsHome(dialog);
    } catch (reason) { $('.error', dialog).textContent = reason.message; }
  };
}

function renderLanguageSettings(dialog) {
  dialog.disableClose = true;
  let draft = state.language;

  renderSettingsDialog(dialog, t('languageSettings'), `<div class="option-choice-grid settings-language-grid">
    <m3e-button variant="tonal" toggle ${draft === 'en' ? 'selected' : ''} data-language="en">English</m3e-button>
    <m3e-button variant="tonal" toggle ${draft === 'ja' ? 'selected' : ''} data-language="ja">日本語</m3e-button>
  </div>`, `
    <m3e-button variant="text" id="settings-back">${t('backSettings')}</m3e-button>
    <m3e-button variant="filled" id="settings-save-language">${t('save')}</m3e-button>`);
  $$('[data-language]', dialog).forEach(button => button.onbeforeinput = event => {
    event.preventDefault();
    draft = button.dataset.language;
    $$('[data-language]', dialog).forEach(candidate => candidate.selected = candidate.dataset.language === draft);
  });
  $('#settings-back', dialog).onclick = () => renderSettingsHome(dialog);
  $('#settings-save-language', dialog).onclick = async () => {
    setLanguage(draft);
    await showGallery();
    renderSettingsHome(dialog);
  };
}

async function renderRootSettings(dialog) {
  dialog.disableClose = true;
  const settings = await api('/api/settings');
  let draft = (settings.roots || []).map(root => ({...root}));
  const renderRows = () => {
    renderSettingsDialog(dialog, t('rootSettings'), `
      <div class="settings-root-list">${draft.length ? draft.map(rootRow).join('') : `<p class="empty">${t('noRoots')}</p>`}
        <m3e-button variant="tonal" id="settings-add-root"><m3e-icon slot="icon" name="add"></m3e-icon>${t('addFolder')}</m3e-button>
      </div><p class="error"></p>`, `
      <m3e-button variant="text" id="settings-back">${t('backSettings')}</m3e-button>
      <m3e-button variant="filled" id="settings-save-roots" ${draft.length ? '' : 'disabled'}>${t('save')}</m3e-button>`);

    $('#settings-back', dialog).onclick = () => renderSettingsHome(dialog);
    $$('.delete-root', dialog).forEach(button => button.onclick = () => {
      draft = draft.filter(root => root.id !== button.dataset.id);
      renderRows();
    });
    $('#settings-add-root', dialog).onclick = () => chooseFolder('', path => {
      const normalized = path.toLocaleLowerCase();
      if (!draft.some(root => root.path.toLocaleLowerCase() === normalized)) {
        const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
        draft.push({id:`draft-${crypto.randomUUID()}`, path, name});
      }
      renderRows();
    });
    $('#settings-save-roots', dialog).onclick = async () => {
      try {
        await api('/api/settings/roots', {method:'PATCH', body:JSON.stringify({paths:draft.map(root => root.path)})});
        renderSettingsHome(dialog);
        setTimeout(() => monitorScan(state.galleryToken), 250);
      } catch (reason) { $('.error', dialog).textContent = reason.message; }
    };
  };
  renderRows();
}

function renderResetSettings(dialog) {
  dialog.disableClose = true;
  renderSettingsDialog(dialog, t('resetTitle'), `
    <p>${t('resetInfo')}</p>
    <label>${t('currentPassword')}<input id="reset-password" type="password" autocomplete="current-password"></label>
    <label class="confirm-check"><input id="reset-confirm" type="checkbox"> ${t('confirmImpact')}</label>
    <p class="error"></p>`, `

    <m3e-button variant="text" id="settings-back">${t('backSettings')}</m3e-button>
    <m3e-button variant="filled" class="danger" id="reset-app">${t('reset')}</m3e-button>`);
  $('#settings-back', dialog).onclick = () => renderSettingsHome(dialog);
  $('#reset-app', dialog).onclick = () => {
    if (!$('#reset-confirm', dialog).checked) return $('.error', dialog).textContent = t('confirmImpactError');
    renderResetConfirmation(dialog, $('#reset-password', dialog).value);
  };
}

function renderResetConfirmation(dialog, password) {
  dialog.disableClose = true;
  renderSettingsDialog(dialog, t('resetTitle'), `<p>${t('finalResetConfirm')}</p><p class="error"></p>`, `
    <m3e-button variant="text" id="settings-back">${t('backSettings')}</m3e-button>
    <m3e-button variant="filled" class="danger" id="reset-confirm-final">${t('reset')}</m3e-button>`);
  $('#settings-back', dialog).onclick = () => renderResetSettings(dialog);
  $('#reset-confirm-final', dialog).onclick = async () => {
    try {
      await api('/api/settings/reset', {method:'POST', body:JSON.stringify({password})});
      localStorage.removeItem('nas-photo-preferences');
      closeMaterialDialog(dialog);
      boot();
    } catch { $('.error', dialog).textContent = t('currentPasswordError'); }
  };
}

let tooltipSerial = 0;
function hideTooltip() {
  $$('m3e-tooltip[data-nas-photo-tooltip]', document).forEach(tooltip => tooltip.hide?.());
}

function shortcutLabel(code) {
  const labels = {Space: 'Space', Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓'};
  return labels[code] || String(code || '').replace(/^Key/, '').replace(/^Digit/, '');
}
function installTooltipSystem() {
  $$('m3e-tooltip[data-nas-photo-tooltip]', document).forEach(tooltip => {
    if (!document.getElementById(tooltip.getAttribute('for'))) tooltip.remove();
  });
  $$('[data-tooltip]').forEach(button => {
    if (button.dataset.m3eTooltipAttached) return;
    if (!button.id) button.id = `tooltip-target-${++tooltipSerial}`;
    const tooltip = document.createElement('m3e-tooltip');
    tooltip.dataset.nasPhotoTooltip = 'true';
    tooltip.setAttribute('for', button.id);
    tooltip.position = 'above';
    const shortcutCode = button.dataset.shortcutAction ? state.shortcuts[button.dataset.shortcutAction] : button.dataset.shortcutLabel;
    const description = button.dataset.tooltip || button.getAttribute('aria-label') || button.textContent.replace(/\s+/g, ' ').trim();
    tooltip.textContent = shortcutCode ? `${description} (${t('tooltipShortcut')}: ${shortcutLabel(shortcutCode)})` : description;
    document.body.append(tooltip);
    button.dataset.m3eTooltipAttached = 'true';
  });
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
    syncVideoOptionButtons();
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
  if (event.code === 'Escape') leaveViewerWithTransition();
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
    syncVideoOptionButtons();
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
new MutationObserver(() => installTooltipSystem()).observe(app, {childList: true, subtree: true});
boot().catch(reason => {
  app.innerHTML = `<main class="page"><section class="card"><h1>NAS-PHOTO</h1>
    <p class="error">${t('bootError')}: ${escapeHTML(reason.message)}</p>
    <button onclick="location.reload()">${t('reload')}</button></section></main>`;
});
