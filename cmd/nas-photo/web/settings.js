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
