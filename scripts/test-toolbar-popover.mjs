import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../cmd/nas-photo/web/toolbar-popover.js', import.meta.url), 'utf8');

function fixture() {
  const context = vm.createContext({});
  const api = vm.runInContext(source + '\n;({inToolbarTriangle,toolbarPointerLeavesToward,toolbarPlacement,hoverToolbarAnchor,bindToolbarMenu})', context);
  return {context, api};
}

test('safe triangle preserves a diagonal route from trigger to its floating panel', () => {
  const {context, api} = fixture();
  context.panel = {getBoundingClientRect: () => ({left: 80, right: 300, top: 60, bottom: 280})};
  vm.runInContext('toolbarPopup = {panel}; toolbarApex = {x: 115, y: 25}', context);
  assert.equal(api.inToolbarTriangle({x: 175, y: 45}), true);
  assert.equal(api.inToolbarTriangle({x: 450, y: 45}), false);
  assert.equal(api.inToolbarTriangle({x: 120, y: 90}), false);
  vm.runInContext('toolbarApex = null', context);
  assert.equal(api.inToolbarTriangle({x: 175, y: 45}), false);
});

test('immediate hover, outside click and keyboard dismissal are implemented without animation layers', () => {
  assert.doesNotMatch(source, /TOOLBAR_HOVER_DELAY|TOOLBAR_HIDE_DELAY|setTimeout/);
  assert.match(source, /leaveToolbarSurface\(group, false, event\)/);
  assert.match(source, /new WeakMap\(\)/);
  assert.match(source, /inToolbarTriangle\(\{x: event\.clientX, y: event\.clientY\}\)/);
  assert.match(source, /toolbarPopup\.panel\.disableClose/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /setAttribute\('aria-expanded', 'true'\)/);
  assert.match(source, /panel\.showPopover\(\)/);
  assert.doesNotMatch(source, /\.animate\(|startViewTransition\(/);
});


test('diagonal transit crosses a neighboring trigger but side exits do not', () => {
  const {context, api} = fixture();
  context.panel = {getBoundingClientRect: () => ({left: 114, right: 534, top: 56, bottom: 550})};
  vm.runInContext('toolbarPopup = {panel}; toolbarApex = {x: 147, y: 28, toAnchor: false}', context);
  assert.equal(api.inToolbarTriangle({x: 194, y: 39}), true);
  assert.equal(api.inToolbarTriangle({x: 194, y: 28}), false);
  const trigger = {getBoundingClientRect: () => ({left: 114, right: 181, top: 8, bottom: 48})};
  assert.equal(api.toolbarPointerLeavesToward(trigger, context.panel, {clientX: 235, clientY: 64}), true);
  assert.equal(api.toolbarPointerLeavesToward(trigger, context.panel, {clientX: 194, clientY: 28}), false);
});

test('menu width follows its content with a viewport-safe cap', () => {
  const css = fs.readFileSync(new URL('../cmd/nas-photo/web/dialogs.css', import.meta.url), 'utf8');
  const popupRule = css.match(/\.toolbar-popup\[popover\]\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(popupRule, /width:\s*max-content/);
  assert.match(popupRule, /max-width:\s*min\(420px,\s*calc\(100vw - 20px\)\)/);
  assert.doesNotMatch(css, /\.toolbar-popup\[popover\]\.settings-dialog\s*\{\s*width:/);
});

test('collision placement shifts, flips, and respects visual viewport offsets', () => {
  const {api} = fixture();
  const viewport = {left: 0, top: 0, right: 320, bottom: 480, width: 320, height: 480};
  const rightEdge = api.toolbarPlacement({left: 290, right: 320, top: 20, bottom: 50},
    {width: 210, height: 180}, viewport);
  assert.equal(rightEdge.left, 100);
  assert.equal(rightEdge.top, 58);
  assert.equal(rightEdge.flipped, false);
  const bottomEdge = api.toolbarPlacement({left: 100, right: 140, top: 420, bottom: 460},
    {width: 190, height: 240}, viewport);
  assert.equal(bottomEdge.flipped, true);
  assert.equal(bottomEdge.top, 172);
  assert.ok(bottomEdge.left + 190 <= viewport.right - 10);
  const zoomedViewport = {left: 40, top: 55, right: 340, bottom: 455, width: 300, height: 400};
  const shifted = api.toolbarPlacement({left: 330, right: 340, top: 100, bottom: 125},
    {width: 260, height: 200}, zoomedViewport);
  assert.equal(shifted.left, 70);
  assert.ok(shifted.top >= 65 && shifted.top + 200 <= 445);
});

test('content size changes trigger repositioning and wheel scrolling dismisses the menu', () => {
  assert.match(source, /new ResizeObserver\(queueToolbarPosition\)/);
  assert.match(source, /new MutationObserver\(queueToolbarPosition\)/);
  assert.match(source, /window\.visualViewport\?\.addEventListener\('resize'/);
  assert.match(source, /document\.addEventListener\('wheel'/);
  assert.match(source, /if \(onPopup && event\.cancelable\) event\.preventDefault\(\)/);
  assert.match(source, /window\.scrollBy\(/);
  assert.match(source, /if \(toolbarPopup\) closeToolbarPopup\(\)/);
});

test('scan uses a vertical intrinsic-width list and toolbar stays left of settings', () => {
  const css = fs.readFileSync(new URL('../cmd/nas-photo/web/dialogs.css', import.meta.url), 'utf8');
  const shell = fs.readFileSync(new URL('../cmd/nas-photo/web/shell.css', import.meta.url), 'utf8');
  assert.match(css, /\.toolbar-popup\[popover\]\.action-dialog \.option-choice-grid\s*\{[^}]*display:\s*grid/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, max-content\)/);
  assert.match(shell, /\.top-actions\s*\{[^}]*justify-content:\s*flex-start/);
  assert.match(shell, /\.top-actions\s*\{[^}]*margin-left:\s*auto/);
  assert.match(shell, /\.top-toolbar\s*\{[^}]*border-radius:\s*999px/);
});
test('settings layout reserves real button ink overflow instead of hiding scrollbar tracks', () => {
  const css = fs.readFileSync(new URL('../cmd/nas-photo/web/dialogs.css', import.meta.url), 'utf8');
  const settings = css.match(/\.toolbar-popup\[popover\]\.settings-dialog \.settings-dialog-body\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(settings, /padding-block-end:\s*4px/);
  assert.doesNotMatch(settings, /overflow:\s*hidden|scrollbar-width:\s*none/);
  const scrollable = css.match(/\.toolbar-popup\[popover\] \.dialog-shell-content\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(scrollable, /overflow:\s*auto/);
});

test('first opening and resized content are measured before being painted', () => {
  const css = fs.readFileSync(new URL('../cmd/nas-photo/web/dialogs.css', import.meta.url), 'utf8');
  const hidden = css.match(/\.toolbar-popup\[popover\]\[data-positioning\]\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(hidden, /visibility:\s*hidden/);
  assert.doesNotMatch(hidden, /display:\s*none/);
  assert.ok(source.indexOf("panel.setAttribute('data-positioning', '')") < source.indexOf('panel.showPopover()'));
  assert.match(source, /const size = panel\.getBoundingClientRect\(\)/);
  assert.match(source, /panel\.style\.maxHeight = 'none'/);
  assert.match(source, /positionToolbarPopup\(panel, anchor\);\s*panel\.removeAttribute\('data-positioning'\)/);
  assert.match(source, /toolbarResizeObserver = new ResizeObserver\(queueToolbarPosition\)/);
  assert.match(source, /toolbarMutationObserver = new MutationObserver\(queueToolbarPosition\)/);
});
test('toolbar controls remain available to mouse, touch and keyboard users', () => {
  assert.match(source, /group\.addEventListener\('pointerover'/);
  assert.match(source, /anchor\.addEventListener\('keydown'/);
  assert.match(source, /event\.key === 'ArrowDown'/);
  assert.match(source, /anchor\.onclick =/);
  assert.match(source, /removeAttribute\('data-tooltip'\)/);
  assert.match(source, /toolbarSuppressedAnchor = anchor/);
});

test('one capsule owns every contiguous pointer segment with no dead gaps', () => {
  const shell = fs.readFileSync(new URL('../cmd/nas-photo/web/shell.css', import.meta.url), 'utf8');
  const gallery = fs.readFileSync(new URL('../cmd/nas-photo/web/gallery.js', import.meta.url), 'utf8');
  const group = shell.match(/\.top-actions\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(group, /gap:\s*0/);
  assert.match(group, /flex-wrap:\s*nowrap/);
  assert.match(shell, /\.toolbar-segment\s*\{[^}]*padding:/);
  assert.match(shell, /\.top-toolbar\s*\{[^}]*border-radius:\s*999px/);
  assert.match(gallery, /role="toolbar"/);
  assert.equal((gallery.match(/data-toolbar-segment=/g) || []).length, 5);
  assert.match(gallery, /bindToolbarGroup\(\$\('\.top-toolbar'\)\)/);
  assert.match(source, /function toolbarAnchorAt\(event\)/);
  assert.match(source, /group\.addEventListener\('pointermove'/);
  assert.doesNotMatch(source, /anchor\.addEventListener\('pointerenter'/);
});

test('popover is positioned synchronously with no hover animation frame', () => {
  const start = source.indexOf('function openToolbarPopup(');
  const end = source.indexOf('function openToolbarFromAnchor(', start);
  const opening = source.slice(start, end);
  assert.ok(opening.indexOf('panel.showPopover()') < opening.indexOf('positionToolbarPopup(panel, anchor)'));
  assert.ok(opening.indexOf('positionToolbarPopup(panel, anchor)') < opening.indexOf("panel.removeAttribute('data-positioning')"));
  assert.doesNotMatch(opening, /requestAnimationFrame|setTimeout/);
  assert.doesNotMatch(source, /requestAnimationFrame|setTimeout/);
});

test('capsule outer surface is unfilled while segments remain interactive', () => {
  const css = fs.readFileSync(new URL('../cmd/nas-photo/web/shell.css', import.meta.url), 'utf8');
  const capsule = css.match(/\.top-toolbar\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(capsule, /background:\s*transparent/);
});

test('mobile uses a modal dialog with fixed width, desktop retains hover popovers', () => {
  const dialogs = fs.readFileSync(new URL('../cmd/nas-photo/web/dialogs.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../cmd/nas-photo/web/dialogs.css', import.meta.url), 'utf8');
  assert.ok(source.includes("const MOBILE_TOOLBAR_QUERY = '(max-width: 767px)'"));
  assert.ok(source.includes('opener(null, false)'));
  assert.ok(source.includes('toolbarUsesModal()'));
  assert.ok(source.includes('if (toolbarUsesModal() || (event.pointerType'));
  assert.ok(dialogs.includes("document.createElement(anchor ? 'section' : 'm3e-dialog')"));
  assert.ok(dialogs.includes('dialog.open = true'));
  assert.ok(css.includes('--m3e-dialog-min-width: calc(100vw - 2rem)'));
  assert.ok(css.includes('--m3e-dialog-max-width: calc(100vw - 2rem)'));
});

test('settings subpages remain dismissible by tapping the mobile modal backdrop', () => {
  const settings = fs.readFileSync(new URL('../cmd/nas-photo/web/settings.js', import.meta.url), 'utf8');
  const helper = settings.slice(settings.indexOf('function renderSettingsDialog('), settings.indexOf('function openSettingsDialog('));
  assert.ok(helper.includes("dialog.tagName === 'M3E-DIALOG' && toolbarUsesModal()"));
  assert.ok(helper.includes('dialog.disableClose = false'));
});

test('mobile toolbar keeps labels and stacks labeled buttons without overflow', () => {
  const shell = fs.readFileSync(new URL('../cmd/nas-photo/web/shell.css', import.meta.url), 'utf8');
  const gallery = fs.readFileSync(new URL('../cmd/nas-photo/web/gallery.js', import.meta.url), 'utf8');
  assert.doesNotMatch(shell, /\.toolbar-label\s*\{\s*display:\s*none/);
  assert.match(shell, /@media \(max-width: 520px\)/);
  assert.match(shell, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s+auto/);
  assert.match(shell, /\.toolbar-segment-settings\s*\{[^}]*grid-row:\s*1\s*\/\s*span\s*2/);
  assert.match(shell, /\.top-toolbar \.toolbar-segment:not\(\.toolbar-segment-settings\) m3e-button\s*\{[^}]*width:\s*100%/);
  assert.equal((gallery.match(/class="toolbar-label"/g) || []).length, 4);
  assert.match(gallery, /<strong class="top-title">NAS-PHOTO<\/strong>/);
});

test('opening a toolbar dialog expands its own button surface without moving its hit box', () => {
  const shell = fs.readFileSync(new URL('../cmd/nas-photo/web/shell.css', import.meta.url), 'utf8');
  assert.match(source, /style\.textContent = `[\s\S]*?:host\(\[aria-expanded="true"\]\) \.base \{[\s\S]*?transform: scale\(1\.12, 1\.10\)/);
  assert.match(source, /root\.append\(style\)/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(shell, /\.toolbar-segment \[data-toolbar-menu\]\[aria-expanded="true"\]\s*\{[^}]*z-index:\s*1/);
  assert.doesNotMatch(shell, /\.toolbar-segment \[data-toolbar-menu\]\[aria-expanded="true"\]\s*\{[^}]*transform:/);
});
test('phone modal keeps only its opener expanded until closing or backdrop tap', () => {
  const mobileOpen = source.slice(source.indexOf('function openToolbarFromAnchor('), source.indexOf('function hoverToolbarAnchor('));
  assert.match(mobileOpen, /const dialog = opener\(null, false\)/);
  assert.match(mobileOpen, /anchor\.setAttribute\('aria-expanded', 'true'\)/);
  assert.match(mobileOpen, /dialog\.addEventListener\('closing', reset, \{once: true\}\)/);
  assert.match(mobileOpen, /dialog\.addEventListener\('closed', reset, \{once: true\}\)/);
  assert.match(mobileOpen, /anchor\.removeAttribute\('aria-controls'\)/);
  const dialogs = fs.readFileSync(new URL('../cmd/nas-photo/web/dialogs.js', import.meta.url), 'utf8');
  const settings = fs.readFileSync(new URL('../cmd/nas-photo/web/settings.js', import.meta.url), 'utf8');
  assert.equal((dialogs.match(/return overlay;/g) || []).length, 3);
  assert.match(settings, /openMaterialDialog\(dialog, anchor, pinned\);\s*return dialog/);
});
