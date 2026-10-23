// Toolbar menus open on hover and close immediately outside the anchor,
// panel, or their narrow safe triangle. Click toggles the visible menu.
const TOOLBAR_GAP = 8;
let toolbarPopup = null;
let toolbarApex = null;
let toolbarBindingsInstalled = false;
let toolbarPanelSequence = 0;
let toolbarResizeObserver = null;
let toolbarMutationObserver = null;
let toolbarPositionFrame = 0;
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

// Popovers live in the top layer. Measure the visible viewport and shift
// only when the requested position collides with an edge.
function toolbarViewportBounds() {
  const viewport = window.visualViewport;
  if (viewport) return {
    left: viewport.offsetLeft, top: viewport.offsetTop,
    right: viewport.offsetLeft + viewport.width,
    bottom: viewport.offsetTop + viewport.height,
    width: viewport.width, height: viewport.height
  };
  return {left: 0, top: 0, right: innerWidth, bottom: innerHeight,
    width: innerWidth, height: innerHeight};
}
function toolbarClamp(value, lower, upper) {
  return Math.min(Math.max(value, lower), Math.max(lower, upper));
}
function toolbarPlacement(anchor, panelSize, viewport, gap = TOOLBAR_GAP, margin = 10) {
  const below = Math.max(0, viewport.bottom - margin - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - viewport.top - margin);
  const flipped = below < panelSize.height && above > below;
  const available = flipped ? above : below;
  const width = Math.min(panelSize.width, Math.max(0, viewport.width - margin * 2));
  const height = Math.min(panelSize.height, Math.max(0, available));
  const left = toolbarClamp(anchor.left, viewport.left + margin, viewport.right - margin - width);
  const preferredTop = flipped ? anchor.top - gap - height : anchor.bottom + gap;
  const top = toolbarClamp(preferredTop, viewport.top + margin, viewport.bottom - margin - height);
  return {left, top, flipped, maxHeight: available};
}
function positionToolbarPopup(panel, anchor) {
  if (!panel.isConnected || !anchor.isConnected) return;
  const viewport = toolbarViewportBounds();
  const margin = 10;
  // Measure the natural content with no height constraint before choosing
  // the side, available height, and final coordinates. The popup stays
  // invisible during this layout pass.
  panel.style.maxWidth = Math.max(0, Math.min(420, viewport.width - margin * 2)) + 'px';
  panel.style.maxHeight = 'none';
  panel.style.left = '0px';
  panel.style.top = '0px';
  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  const size = panel.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const placement = toolbarPlacement(anchorRect, {
    width: size.width,
    height: Math.max(size.height, panel.scrollHeight)
  }, viewport, TOOLBAR_GAP, margin);
  panel.style.maxHeight = Math.max(0, Math.min(placement.maxHeight, viewport.height - margin * 2)) + 'px';
  // Keep the measured width in the placement calculation. Overflow reduces
  // the panel height but must not move the anchor-aligned horizontal edge.
  panel.style.left = placement.left + 'px';
  panel.style.top = placement.top + 'px';
}
function queueToolbarPosition() {
  if (toolbarPositionFrame || !toolbarPopup) return;
  const panel = toolbarPopup.panel;
  // A content/viewport size change cannot paint at the old coordinates.
  panel.setAttribute('data-positioning', '');
  toolbarPositionFrame = requestAnimationFrame(() => {
    toolbarPositionFrame = 0;
    if (toolbarPopup?.panel !== panel) return;
    positionToolbarPopup(panel, toolbarPopup.anchor);
    panel.removeAttribute('data-positioning');
  });
}

function closeToolbarPopup(panel = toolbarPopup?.panel) {
  if (!panel) return;
  if (toolbarPopup?.panel === panel) {
    toolbarResizeObserver?.disconnect();
    toolbarMutationObserver?.disconnect();
    toolbarResizeObserver = null;
    toolbarMutationObserver = null;
    cancelAnimationFrame(toolbarPositionFrame);
    toolbarPositionFrame = 0;
  }
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
  // A popover must be in the top layer to measure its real intrinsic size.
  // Hide it only during measurement, never by suppressing scrollbars.
  panel.setAttribute('data-positioning', '');
  document.body.append(panel);
  panel.id = 'toolbar-popup-' + (++toolbarPanelSequence);
  panel.showPopover();
  toolbarPopup = {panel, anchor};
  anchor.setAttribute('aria-expanded', 'true');
  anchor.setAttribute('aria-controls', panel.id);
  queueToolbarPosition();
  toolbarResizeObserver = new ResizeObserver(queueToolbarPosition);
  toolbarResizeObserver.observe(panel);
  toolbarMutationObserver = new MutationObserver(queueToolbarPosition);
  toolbarMutationObserver.observe(panel, {subtree: true, childList: true, characterData: true});
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
  window.addEventListener('resize', queueToolbarPosition, {passive: true});
  window.visualViewport?.addEventListener('resize', queueToolbarPosition, {passive: true});
  window.visualViewport?.addEventListener('scroll', queueToolbarPosition, {passive: true});
  // Wheel gestures over a popup should scroll the underlying gallery, not a
  // transient menu. Dismiss and forward the wheel delta to the page.
  document.addEventListener('wheel', event => {
    if (!toolbarPopup) return;
    const onPopup = toolbarPopup.panel.contains(event.target);
    if (onPopup && event.cancelable) event.preventDefault();
    closeToolbarPopup();
    if (onPopup) {
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
      window.scrollBy({left: event.deltaX * factor, top: event.deltaY * factor, behavior: 'instant'});
    }
  }, {capture: true, passive: false});
  // Scrollbar dragging, keyboard scrolling and touch scrolling also dismiss.
  window.addEventListener('scroll', () => {
    if (toolbarPopup) closeToolbarPopup();
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
