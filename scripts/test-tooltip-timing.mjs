import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime = fs.readFileSync(new URL('../cmd/nas-photo/web/runtime.js', import.meta.url), 'utf8');
const toolbar = fs.readFileSync(new URL('../cmd/nas-photo/web/toolbar-popover.js', import.meta.url), 'utf8');

test('ordinary tooltips wait 500ms before appearing', () => {
  const setup = runtime.slice(runtime.indexOf('function installTooltipSystem()'), runtime.indexOf('document.addEventListener', runtime.indexOf('function installTooltipSystem()')));
  assert.match(setup, /tooltip\.showDelay\s*=\s*500/);
  assert.ok(setup.indexOf('tooltip.showDelay = 500') < setup.indexOf('document.body.append(tooltip)'));
});

test('toolbar popovers continue to open without timers', () => {
  const group = toolbar.slice(toolbar.indexOf('function bindToolbarGroup('), toolbar.indexOf('function installToolbarPopupListeners('));
  assert.match(group, /group\.addEventListener\('pointerover'/);
  assert.doesNotMatch(group, /setTimeout|requestAnimationFrame/);
});
