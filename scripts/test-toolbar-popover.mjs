import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../cmd/nas-photo/web/toolbar-popover.js', import.meta.url), 'utf8');

function fixture() {
  const context = vm.createContext({});
  const api = vm.runInContext(source + '\n;({inToolbarTriangle,hoverToolbarAnchor,bindToolbarMenu})', context);
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

test('warm hover, outside click and keyboard dismissal are implemented without animation layers', () => {
  assert.match(source, /TOOLBAR_HOVER_DELAY\s*=\s*500/);
  assert.match(source, /TOOLBAR_WARM_RESET\s*=\s*300/);
  assert.match(source, /new WeakMap\(\)/);
  assert.match(source, /inToolbarTriangle\(\{x: event\.clientX, y: event\.clientY\}\)/);
  assert.match(source, /toolbarPopup\.panel\.disableClose/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /setAttribute\('aria-expanded', 'true'\)/);
  assert.match(source, /panel\.showPopover\(\)/);
  assert.doesNotMatch(source, /\.animate\(|startViewTransition\(/);
});

test('toolbar controls remain available to mouse, touch and keyboard users', () => {
  assert.match(source, /anchor\.addEventListener\('pointerenter'/);
  assert.match(source, /anchor\.addEventListener\('keydown'/);
  assert.match(source, /event\.key === 'ArrowDown'/);
  assert.match(source, /anchor\.onclick =/);
  assert.match(source, /removeAttribute\('data-tooltip'\)/);
});
