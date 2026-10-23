// Toolbar menus open on hover and close immediately outside the anchor,
// panel, or their narrow safe triangle. Click toggles the visible menu.
const TOOLBAR_GAP = 8;
let toolbarPopup = null;
let toolbarApex = null;
let toolbarBindingsInstalled = false;
let toolbarPanelSequence = 0;
const toolbarOpeners = new WeakMap();

function toolbarPointerLeavesToward(source, destination, event) {
  const rect = source.getBoundingClientRect();
  const other = destination.getBoundingClientRect();
  const down = other.top >= rect.bottom;
  const up = other.bottom <= rect.top;
  if (!down && !up) return false;
  // Fast pointer movement may jump straight into the destination without
  // producing a move event inside the gap. Keep the menu for that jump too.
  if (event.clientX >= other.left && event.clientX <= other.right &&
      event.clientY >= other.top && event.clientY <= other.bottom) return true;
  // A side exit is not a route to the panel. Only preserve the popup when
  // crossing the narrow vertical gap between its trigger and content.
  const edgeY = down ? rect.bottom : rect.top;
  return Math.abs(event.clientY - edgeY) <= 3 &&
    event.clientX >= rect.left - 3 && event.clientX <= rect.right + 3;
}

function inToolbarTriangle(point) {
  if (!toolbarPopup || !toolbarApex || !point) return false;
  const destination = toolbarApex.toAnchor ? toolbarPopup.anchor : toolbarPopup.panel;
  const rect = destination.getBoundingClientRect();
  const edgeY = rect.top >= toolbarApex.y ? rect.top : rect.bottom;
  if ((edgeY - toolbarApex.y) * (point.y - toolbarApex.y) < 0) return false;
  if (Math.abs(point.y - toolbarApex.y) > Math.abs(edgeY - toolbarApex.y) + 4) return false;
  const span = edgeY - toolbarApex.y;
  if (Math.abs(span) < 1) return false;
  const t = (point.y - toolbarApex.y) / span;
  const left = rect.left - 12, right = rect.right + 12;
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
  if (!panel) return;
  if (toolbarPopup?.panel === panel) {
    toolbarPopup.anchor.setAttribute('aria-expanded', 'false');
    toolbarPopup.anchor.removeAttribute('aria-controls');
    toolbarPopup = null;
  }
  toolbarApex = null;
  if (panel.matches(':popover-open')) panel.hidePopover();
  panel.remove();
}

function leaveToolbarSurface(source, toAnchor, event) {
  if (event.pointerType && event.pointerType !== 'mouse') return;
  if (!toolbarPopup || (toAnchor ? toolbarPopup.panel : toolbarPopup.anchor) !== source) return;
  const destination = toAnchor ? toolbarPopup.anchor : toolbarPopup.panel;
  const point = {x: event.clientX, y: event.clientY};
  if (!toAnchor && inToolbarTriangle(point)) return;
  if (toolbarPointerLeavesToward(source, destination, event)) {
    if (toAnchor || !toolbarApex) toolbarApex = {...point, toAnchor};
  } else {
    closeToolbarPopup();
  }
}

function openToolbarPopup(panel, anchor, focusFirst = false) {
  if (toolbarPopup?.panel === panel) return;
  closeToolbarPopup();
  document.body.append(panel);
  panel.id = 'toolbar-popup-' + (++toolbarPanelSequence);
  panel.showPopover();
  toolbarPopup = {panel, anchor};
  anchor.setAttribute('aria-expanded', 'true');
  anchor.setAttribute('aria-controls', panel.id);
  positionToolbarPopup(panel, anchor);
  panel.addEventListener('pointerenter', () => { toolbarApex = null; });
  panel.addEventListener('pointerleave', event => leaveToolbarSurface(panel, true, event));
  if (focusFirst) {
    const control = panel.querySelector('m3e-button, button, input, select, [tabindex="0"]');
    control?.focus({preventScroll: true});
  }
}

function openToolbarFromAnchor(anchor, focusFirst = false) {
  const opener = toolbarOpeners.get(anchor);
  if (!opener || !anchor.isConnected || toolbarPopup?.anchor === anchor) return;
  opener(anchor, focusFirst);
}

function hoverToolbarAnchor(anchor, event) {
  if (event.pointerType && event.pointerType !== 'mouse') return;
  if (toolbarPopup?.anchor !== anchor &&
      inToolbarTriangle({x: event.clientX, y: event.clientY})) return;
  openToolbarFromAnchor(anchor);
  if (toolbarPopup?.anchor === anchor) {
    toolbarApex = {x: event.clientX, y: event.clientY, toAnchor: false};
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
    if (toolbarPopup.panel.contains(target)) {
      toolbarApex = null;
      return;
    }
    if (toolbarPopup.anchor.contains(target)) return;
    if (inToolbarTriangle({x: event.clientX, y: event.clientY})) return;
    const nextAnchor = target.closest?.('[data-toolbar-menu]');
    if (nextAnchor && toolbarOpeners.has(nextAnchor)) hoverToolbarAnchor(nextAnchor, event);
    else closeToolbarPopup();
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
  anchor.addEventListener('pointerleave', event => leaveToolbarSurface(anchor, false, event));
  anchor.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openToolbarFromAnchor(anchor, true);
    }
  });
  anchor.onclick = () => {
    // A menu already opened by hover closes on the FIRST click.
    if (toolbarPopup?.anchor === anchor) closeToolbarPopup();
    else openToolbarFromAnchor(anchor, true);
  };
}
