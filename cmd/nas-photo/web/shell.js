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
