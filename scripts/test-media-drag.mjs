import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../cmd/nas-photo/web/upload.js', import.meta.url), 'utf8');
const marker = 'application/x-nas-photo-internal';

function harness() {
  const handlers = new Map();
  const elements = [];
  const item = {id: 'photo-1', name: '写真.jpg', kind: 'image'};
  vm.runInNewContext(source, {
    document: {
      addEventListener: (type, handler) => handlers.set(type, handler),
      documentElement: {lang: 'en'},
      body: {append() {}},
      createElement() {
        const element = {hidden: true, append() {}, querySelector: () => ({setAttribute() {}})};
        elements.push(element);
        return element;
      }
    },
    window: {addEventListener() {}},
    location: new URL('http://localhost:9070/'), URL,
    state: {items: [item]},
    escapeHTML: value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  });
  function event(types = [], tile = null) {
    const data = new Map(types.map(type => [type, '']));
    return {
      prevented: false,
      preventDefault() { this.prevented = true; },
      target: {closest: () => tile},
      dataTransfer: {
        get types() { return [...data.keys()]; },
        clearData: () => data.clear(),
        setData: (type, value) => data.set(type, value),
        getData: type => data.get(type)
      }
    };
  }
  return {handlers, elements, event};
}

test('gallery export replaces thumbnail data with original file URLs', () => {
  const {handlers, event} = harness();
  const drag = event(['text/html'], {dataset: {id: 'photo-1'}});
  handlers.get('dragstart')(drag);
  const transfer = drag.dataTransfer;
  assert.equal(transfer.getData('DownloadURL'), 'application/octet-stream:写真.jpg:http://localhost:9070/api/media/photo-1/content?download=1');
  assert.equal(transfer.getData('text/uri-list'), 'http://localhost:9070/api/media/photo-1/content');
  assert.match(transfer.getData('text/html'), /\/content/);
  assert.equal(transfer.effectAllowed, 'copy');
  assert.ok(transfer.types.includes(marker));
});

test('internal drags from another pane or tab cannot trigger an upload or overlay', () => {
  const {handlers, elements, event} = harness();
  for (const type of ['dragenter', 'dragover', 'drop']) {
    const drag = event(['Files', marker]);
    handlers.get(type)(drag);
    assert.equal(drag.prevented, true);
    assert.equal(drag.dataTransfer.dropEffect, 'none');
  }
  assert.equal(elements.length, 0);
});

test('local drags are blocked without file data and external file drags work after dragend', () => {
  const {handlers, elements, event} = harness();
  handlers.get('dragstart')(event());
  const internal = event();
  handlers.get('dragover')(internal);
  assert.equal(internal.dataTransfer.dropEffect, 'none');
  handlers.get('dragend')();
  const external = event(['Files']);
  handlers.get('dragover')(external);
  assert.equal(external.prevented, true);
  assert.equal(external.dataTransfer.dropEffect, 'copy');
  assert.equal(elements[0].hidden, false);
});
