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
  $('#sort-apply', overlay).onclick = async () => {
    state.sort = draft.sort;
    state.order = draft.order;
    state.subSort = draft.subSort;
    state.randomSeed = draft.randomSeed;
    savePreferences();
    closeMaterialDialog(overlay);
    await refreshGalleryItems();
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
