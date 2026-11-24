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
    // M3E defaults to zero delay. Restore a deliberate hover pause for
    // ordinary tooltips; toolbar menus remain immediate and separate.
    tooltip.showDelay = 500;
    tooltip.position = 'above';
    const shortcutCode = button.dataset.shortcutAction ? state.shortcuts[button.dataset.shortcutAction] : button.dataset.shortcutLabel;
    const description = button.dataset.tooltip || button.getAttribute('aria-label') || button.textContent.replace(/\s+/g, ' ').trim();
    tooltip.textContent = shortcutCode ? `${description} (${t('tooltipShortcut')}: ${shortcutLabel(shortcutCode)})` : description;
    document.body.append(tooltip);
    button.dataset.m3eTooltipAttached = 'true';
  });
}

function hasBlockingDialogOpen() {
  return $$('m3e-dialog').some(dialog => dialog.open) ||
    Boolean(typeof toolbarPopup !== 'undefined' && toolbarPopup?.panel?.disableClose);
}

function navigateActiveScreen(delta, phase = 'start') {
  const step = Number(delta) || 0;
  if (phase === 'stop') {
    if (!state.viewer[0] && typeof stopGalleryHold === 'function') stopGalleryHold(step);
    return true;
  }
  if (!step) return false;
  if (state.viewer[0]) {
    void move(0, step);
    return true;
  }
  if ($('#gallery')) {
    if (phase === 'repeat') return true;
    return typeof startGalleryHold === 'function' ? startGalleryHold(step) : false;
  }
  return false;
}

function dispatchNavigationShortcut(action, phase) {
  const primaryAction = action === 'prev1' || action === 'next1';
  const secondaryAction = action === 'prev2' || action === 'next2';
  if (!primaryAction && !secondaryAction) return false;
  const delta = action === 'prev1' || action === 'prev2' ? -1 : 1;

  if (embeddedMode) {
    const controlsThisScreen =
      (embeddedRole === 'primary' && primaryAction) ||
      (embeddedRole === 'secondary' && secondaryAction);
    if (controlsThisScreen) {
      return navigateActiveScreen(delta, phase);
    }
    parent.postMessage({
      type: primaryAction ? 'navigatePrimary' : 'navigateSecondary',
      delta,
      phase
    }, location.origin);
    return true;
  }
  if (state.split) {
    postToRole(primaryAction ? 'primary' : 'secondary', {
      type: 'navigate',
      delta,
      phase
    });
    return true;
  }
  if (primaryAction) {
    return navigateActiveScreen(delta, phase);
  }
  return false;
}

function releaseAllNavigationHolds() {
  if (typeof stopGalleryHold === 'function') stopGalleryHold(0);
  if (!embeddedMode && state.split) {
    postToRole('primary', {type: 'navigate', delta: 0, phase: 'stop'});
    postToRole('secondary', {type: 'navigate', delta: 0, phase: 'stop'});
  } else if (embeddedMode) {
    parent.postMessage({type: 'navigateStopAll'}, location.origin);
  }
}

document.addEventListener('keydown', event => {
  if (hasBlockingDialogOpen()) return;
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return;
  const action = Object.entries(state.shortcuts).find(([, code]) => code === event.code)?.[0];
  if (action === 'splitToggle') {
    if (event.repeat) return;
    event.preventDefault();
    toggleSplit();
    return;
  }
  if (action === 'mute') {
    if (event.repeat) return;
    event.preventDefault();
    toggleMuted();
    return;
  }
  if (action === 'prev1' || action === 'next1' || action === 'prev2' || action === 'next2') {
    const phase = event.repeat ? 'repeat' : 'start';
    if (dispatchNavigationShortcut(action, phase)) event.preventDefault();
    return;
  }
  if (!state.viewer[0]) return;
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

document.addEventListener('keyup', event => {
  const action = Object.entries(state.shortcuts).find(([, code]) => code === event.code)?.[0];
  if (action === 'prev1' || action === 'next1' || action === 'prev2' || action === 'next2') {
    dispatchNavigationShortcut(action, 'stop');
  }
});

window.addEventListener('blur', releaseAllNavigationHolds);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) releaseAllNavigationHolds();
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
  if (!embeddedMode && state.split && event.data?.type === 'navigateStopAll') {
    postToRole('primary', {type:'navigate', delta:0, phase:'stop'});
    postToRole('secondary', {type:'navigate', delta:0, phase:'stop'});
    return;
  }
  if (!embeddedMode && state.split &&
      (event.data?.type === 'navigatePrimary' || event.data?.type === 'navigateSecondary')) {
    postToRole(event.data.type === 'navigatePrimary' ? 'primary' : 'secondary', {
      type:'navigate',
      delta:Number(event.data.delta) || 0,
      phase:event.data.phase || 'start'
    });
    return;
  }
  if (!embeddedMode) return;
  if (event.data?.type === 'navigate') {
    const phase = event.data.phase || 'start';
    if (phase === 'stop' || !hasBlockingDialogOpen()) {
      navigateActiveScreen(Number(event.data.delta) || 0, phase);
    }
  }
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
    void collapseSplit();
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
    <m3e-button variant="filled" id="reload-app">${t('reload')}</m3e-button></section></main>`;
  $('#reload-app')?.addEventListener('click', () => location.reload());
});
