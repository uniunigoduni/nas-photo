import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../cmd/nas-photo/web/dialogs.js', import.meta.url), 'utf8');
const prelude = source.slice(0, source.indexOf('function showSortDialog()'));

function fixture() {
  const events = [];
  const elements = [];
  const document = {
    body: {append(dialog) { events.push('body.append'); dialog.isConnected = true; }},
    createElement(tag) {
      const element = {tag, textContent: '', rel: '', href: ''};
      elements.push(element);
      return element;
    }
  };
  const dialog = {
    isConnected: false,
    classList: {contains() {return false;}},
    shadowRoot: {append(node) { events.push('shadow.append:' + node.tag); }},
    addEventListener(type, listener) {
      events.push('listener:' + type);
      if (type === 'closed') this.onClosed = listener;
    },
    remove() { events.push('removed'); this.isConnected = false; },
    set open(value) { events.push('open:' + value); this._open = value; },
    get open() { return this._open; }
  };
  const api = vm.runInNewContext(prelude + '\n;({openMaterialDialog,closeMaterialDialog})', {document});
  return {api, elements, events, dialog};
}

test('all app dialogs install lightweight motion before opening', () => {
  const f = fixture();
  f.api.openMaterialDialog(f.dialog);
  assert.deepEqual(f.events, [
    'listener:closed', 'body.append', 'shadow.append:link', 'shadow.append:style', 'open:true'
  ]);
  assert.equal(f.elements[0].href, '/scrollbars.css');
  const css = f.elements[1].textContent;
  assert.match(css, /transform:\s*none\s*!important/);
  assert.match(css, /transition:\s*opacity 120ms ease-out/);
  assert.match(css, /\.base::backdrop/);
  assert.match(css, /var\(--m3e-dialog-scrim-opacity, 32%\)/);
  assert.match(css, /\.base\[open\]::backdrop[\s\S]*?transition:\s*none\s*!important/);
  assert.doesNotMatch(css, /prefers-reduced-motion/);
  assert.match(css, /@starting-style/);
});

test('opening twice does not install duplicate styles; closing removes the dialog', () => {
  const f = fixture();
  f.api.openMaterialDialog(f.dialog);
  f.api.openMaterialDialog(f.dialog);
  assert.equal(f.elements.length, 2);
  assert.equal(f.events.filter(event => event === 'open:true').length, 1);
  f.api.closeMaterialDialog(f.dialog);
  assert.equal(f.dialog.open, false);
  f.dialog.onClosed();
  assert.equal(f.dialog.isConnected, false);
});
