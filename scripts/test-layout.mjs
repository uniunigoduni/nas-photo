import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {
  computeJustifiedRows, positionJustifiedRows, visibleJustifiedRows,
  justifiedRowForItem
} = require('../cmd/nas-photo/web/layout.js');

test('positioning does not change justified row boundaries, image widths or heights', () => {
  const rows = computeJustifiedRows([1, 0.8, 1.5, 1.1, 2, 0.9, 1.4, 1], 800, 180, 8);
  const before = structuredClone(rows);
  const total = positionJustifiedRows(rows, 8);
  assert.deepEqual(rows.map(({top, bottom, ...original}) => original), before);
  assert.equal(rows[0].top, 0);
  for (let index = 1; index < rows.length; index++) {
    assert.equal(rows[index].top, rows[index - 1].bottom + 8);
  }
  assert.equal(total, rows.at(-1).bottom);
});

test('no rows are rendered or measured for an empty library', () => {
  const rows = computeJustifiedRows([], 800, 180, 8);
  assert.equal(positionJustifiedRows(rows, 8), 0);
  assert.deepEqual(visibleJustifiedRows(rows, 0, 1000), {start: 0, end: 0});
  assert.equal(justifiedRowForItem(rows, 0), null);
});

test('every media index maps to its original river row', () => {
  const ratios = Array.from({length: 400}, (_, i) => [1, 1.6, 0.75, 2.2][i % 4]);
  const rows = computeJustifiedRows(ratios, 760, 180, 8);
  positionJustifiedRows(rows, 8);
  for (let i = 0; i < ratios.length; i++) {
    const row = justifiedRowForItem(rows, i);
    assert.ok(row && row.start <= i && i < row.end, 'item '+i+' not in its row');
  }
  assert.equal(justifiedRowForItem(rows, -1), null);
  assert.equal(justifiedRowForItem(rows, ratios.length), null);
});

test('binary-search row windows contain all rows intersecting viewport', () => {
  const ratios = Array.from({length: 2500}, (_, i) => [0.65, 1, 1.35, 1.75, 2.4][i % 5]);
  const rows = computeJustifiedRows(ratios, 900, 190, 8);
  const height = positionJustifiedRows(rows, 8);
  for (let top = 0; top <= height; top += 137) {
    const bottom = top + 760;
    const {start, end} = visibleJustifiedRows(rows, top, bottom);
    assert.ok(start >= 0 && start < rows.length);
    assert.ok(end > start && end <= rows.length);
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].bottom > top && rows[i].top < bottom) {
        assert.ok(i >= start && i < end, 'missing visible row '+i);
      }
    }
  }
});

test('spacer heights retain precisely the same complete content height', () => {
  const ratios = Array.from({length: 120}, (_, i) => [1, 2.1, 0.7][i % 3]);
  const gap = 8;
  const rows = computeJustifiedRows(ratios, 680, 180, gap);
  const height = positionJustifiedRows(rows, gap);
  for (const [start, end] of [[0, 1], [1, 4], [3, 6], [rows.length - 2, rows.length]]) {
    const upper = start > 0 ? rows[start].top : 0;
    const visible = rows.slice(start, end).reduce((sum, row, i) =>
      sum + row.height + (start + i + 1 < rows.length ? gap : 0), 0);
    const lower = end < rows.length ? height - rows[end - 1].bottom - gap : 0;
    assert.ok(Math.abs(upper + visible + lower - height) < 0.000001);
  }
});

test('large libraries need only a bounded number of virtual rows', () => {
  const ratios = Array.from({length: 100000}, (_, i) => [1.2, 0.8, 1.6][i % 3]);
  const rows = computeJustifiedRows(ratios, 960, 180, 8);
  const height = positionJustifiedRows(rows, 8);
  const {start, end} = visibleJustifiedRows(rows, height / 2 - 1000, height / 2 + 2000);
  assert.ok(rows.length > 10000);
  assert.ok(end - start < 100);
});
