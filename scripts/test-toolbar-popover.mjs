import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../cmd/nas-photo/web/toolbar-popover.js', import.meta.url), 'utf8');

function fixture() {
  const context = vm.createContext({});
  const api = vm.runInContext(source + '\n;({inToolbarTriangle,toolbarPointerLeavesToward,hoverToolbarAnchor,bindToolbarMenu})', context);
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
  assert.match(source, /leaveToolbarSurface\(anchor, false, event\)/);
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
test('toolbar controls remain available to mouse, touch and keyboard users', () => {
  assert.match(source, /anchor\.addEventListener\('pointerenter'/);
  assert.match(source, /anchor\.addEventListener\('keydown'/);
  assert.match(source, /event\.key === 'ArrowDown'/);
  assert.match(source, /anchor\.onclick =/);
  assert.match(source, /removeAttribute\('data-tooltip'\)/);
  assert.match(source, /if \(toolbarPopup\?\.anchor === anchor\) closeToolbarPopup\(\)/);
});
