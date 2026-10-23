// The five gallery toolbar menus share warm hover timing and safe passage
// between an anchor and its panel. Only explicit clicks pin a menu open.
const TOOLBAR_HOVER_DELAY = 500;
const TOOLBAR_WARM_RESET = 300;
const TOOLBAR_HIDE_DELAY = 180;
const TOOLBAR_GAP = 8;
let toolbarPopup = null;
let toolbarHoverTimer = 0;
let toolbarHideTimer = 0;
let toolbarWarmUntil = 0;
let toolbarApex = null;
let toolbarBindingsInstalled = false;
let toolbarPanelSequence = 0;
const toolbarOpeners = new WeakMap();

function cancelToolbarHover() {
  clearTimeout(toolbarHoverTimer);
  toolbarHoverTimer = 0;
}
function cancelToolbarHide() {
  clearTimeout(toolbarHideTimer);
  toolbarHideTimer = 0;
}
function inToolbarTriangle(point) {
  if (!toolbarPopup || !toolbarApex || !point) return false;
  const rect = toolbarPopup.panel.getBoundingClientRect();
  const edgeY = rect.top >= toolbarApex.y ? rect.top : rect.bottom;
  if ((edgeY - toolbarApex.y) * (point.y - toolbarApex.y) < 0) return false;
  if (Math.abs(point.y - toolbarApex.y) > Math.abs(edgeY - toolbarApex.y) + 4) return false;
  const left = rect.left - 12, right = rect.right + 12;
  const span = edgeY - toolbarApex.y;
  if (Math.abs(span) < 1) return false;
  const t = (point.y - toolbarApex.y) / span;
  return point.x >= toolbarApex.x + (left - toolbarApex.x) * t - 5 &&
    point.x <= toolbarApex.x + (right - toolbarApex.x) * t + 5;
}
function positionToolbarPopup(panel, anchor) {
  if (!panel.isConnected || !anchor.isConnected) return;
  const box = anchor.getBoundingClientRect();
  const width = panel.getBoundingClientRect().width;
  const margin = 10;
  const left = Math.max(margin, Math.min(box.left, innerWidth - width - margin));
  const availableBelow = innerHeight - box.bottom - TOOLBAR_GAP - margin;
  const availableAbove = box.top - TOOLBAR_GAP - margin;
  const flip = availableBelow < 230 && availableAbove > availableBelow;
  const height = Math.min(panel.scrollHeight, Math.max(120, flip ? availableAbove : availableBelow));
  panel.style.left = left + 'px';
  panel.style.top = (flip ? Math.max(margin, box.top - TOOLBAR_GAP - height) : box.bottom + TOOLBAR_GAP) + 'px';
  panel.style.maxHeight = Math.max(120, flip ? availableAbove : availableBelow) + 'px';
}
function closeToolbarPopup(panel = toolbarPopup?.panel) {
  cancelToolbarHover();
  cancelToolbarHide();
  if (!panel) return;
  if (toolbarPopup?.panel === panel) {
    toolbarPopup.anchor.setAttribute('aria-expanded', 'false');
    toolbarPopup.anchor.removeAttribute('aria-controls');
    toolbarPopup = null;
    toolbarWarmUntil = Date.now() + TOOLBAR_WARM_RESET;
  }
  toolbarApex = null;
  if (panel.matches(':popover-open')) panel.hidePopover();
  panel.remove();
}
function openToolbarPopup(panel, anchor, pinned = false) {
  if (toolbarPopup?.panel === panel) return;
  closeToolbarPopup();
  cancelToolbarHover();
  document.body.append(panel);
  panel.id = 'toolbar-popup-' + (++toolbarPanelSequence);
  panel.showPopover();
  toolbarPopup = {panel, anchor, pinned};
  anchor.setAttribute('aria-expanded', 'true');
  anchor.setAttribute('aria-controls', panel.id);
  toolbarWarmUntil = Date.now() + TOOLBAR_WARM_RESET;
  positionToolbarPopup(panel, anchor);
  panel.addEventListener('pointerenter', () => {
    cancelToolbarHide();
    toolbarApex = null;
  });
  panel.addEventListener('pointerleave', () => scheduleToolbarHide());
  panel.addEventListener('pointerdown', () => {
    if (toolbarPopup?.panel === panel) toolbarPopup.pinned = true;
  });
  if (pinned) {
    const control = panel.querySelector('m3e-button, button, input, select, [tabindex="0"]');
    control?.focus({preventScroll: true});
  }
}
function scheduleToolbarHide() {
  if (!toolbarPopup || toolbarPopup.pinned) return;
  cancelToolbarHide();
  toolbarHideTimer = setTimeout(() => {
    if (!toolbarPopup?.pinned) closeToolbarPopup();
  }, TOOLBAR_HIDE_DELAY);
}
function openToolbarFromAnchor(anchor, pinned = false, pointer = null) {
  const opener = toolbarOpeners.get(anchor);
  if (!opener || !anchor.isConnected) return;
  cancelToolbarHover();
  cancelToolbarHide();
  if (toolbarPopup?.anchor === anchor) {
    if (pinned) toolbarPopup.pinned = true;
    return;
  }
  // Restore the hover apex only when switching panels by mouse movement.
  const apex = pointer && {x: pointer.clientX, y: pointer.clientY};
  opener(anchor, pinned);
  toolbarApex = apex;
}
function hoverToolbarAnchor(anchor, event) {
  if (event.pointerType && event.pointerType !== 'mouse') return;
  const point = {x: event.clientX, y: event.clientY};
  if (toolbarPopup?.anchor !== anchor && inToolbarTriangle(point)) {
    cancelToolbarHover();
    cancelToolbarHide();
    return;
  }
  cancelToolbarHover();
  cancelToolbarHide();
  if (toolbarPopup?.anchor === anchor) return;
  const immediate = Boolean(toolbarPopup) || Date.now() < toolbarWarmUntil;
  if (immediate) {
    openToolbarFromAnchor(anchor, false, event);
  } else {
    toolbarHoverTimer = setTimeout(() => {
      if (anchor.isConnected) openToolbarFromAnchor(anchor, false, event);
    }, TOOLBAR_HOVER_DELAY);
  }
}
function installToolbarPopupListeners() {
  if (toolbarBindingsInstalled) return;
  toolbarBindingsInstalled = true;
  document.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || !toolbarPopup) return;
    if (!toolbarPopup.anchor.isConnected) {
      closeToolbarPopup();
      return;
    }
    const target = event.target;
    if (toolbarPopup.panel.contains(target) || toolbarPopup.anchor.contains(target)) {
      cancelToolbarHide();
      if (toolbarPopup.panel.contains(target)) toolbarApex = null;
      return;
    }
    if (inToolbarTriangle({x: event.clientX, y: event.clientY})) {
      cancelToolbarHide();
      return;
    }
    const nextAnchor = target.closest?.('[data-toolbar-menu]');
    if (toolbarOpeners.has(nextAnchor)) hoverToolbarAnchor(nextAnchor, event);
    else scheduleToolbarHide();
  }, {passive: true});
  document.addEventListener('pointerdown', event => {
    if (!toolbarPopup) return;
    if (toolbarPopup.panel.contains(event.target) ||
        toolbarPopup.anchor.contains(event.target) ||
        toolbarPopup.panel.disableClose) return;
    closeToolbarPopup();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && toolbarPopup && !toolbarPopup.panel.disableClose) {
      event.preventDefault();
      const anchor = toolbarPopup.anchor;
      closeToolbarPopup();
      anchor.focus({preventScroll: true});
    }
  }, true);
  window.addEventListener('resize', () => {
    if (toolbarPopup) positionToolbarPopup(toolbarPopup.panel, toolbarPopup.anchor);
  }, {passive: true});
  window.addEventListener('scroll', () => {
    if (toolbarPopup) positionToolbarPopup(toolbarPopup.panel, toolbarPopup.anchor);
  }, {passive: true});
}
function bindToolbarMenu(anchor, opener) {
  if (!anchor) return;
  installToolbarPopupListeners();
  toolbarOpeners.set(anchor, opener);
  anchor.dataset.toolbarMenu = '1';
  anchor.setAttribute('aria-haspopup', 'dialog');
  anchor.setAttribute('aria-expanded', 'false');
  anchor.removeAttribute('data-tooltip');
  anchor.addEventListener('pointerenter', event => hoverToolbarAnchor(anchor, event));
  anchor.addEventListener('pointerleave', () => {
    cancelToolbarHover();
    scheduleToolbarHide();
  });
  anchor.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openToolbarFromAnchor(anchor, true);
    }
  });
  anchor.onclick = () => {
    if (toolbarPopup?.anchor === anchor && toolbarPopup.pinned) closeToolbarPopup();
    else openToolbarFromAnchor(anchor, true);
  };
}
