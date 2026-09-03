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
    <m3e-button variant="filled" id="reload-app">${t('reload')}</m3e-button></section></main>`;
  $('#reload-app')?.addEventListener('click', () => location.reload());
});
