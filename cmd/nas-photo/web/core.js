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
