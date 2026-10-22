(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NasPhotoLayout = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  function safeRatio(value) {
    const ratio = Number(value);
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 4 / 3;
  }

  function fittedHeight(ratios, start, end, width, gap) {
    let sum = 0;
    for (let index = start; index < end; index += 1) sum += ratios[index];
    return (width - gap * Math.max(0, end - start - 1)) / sum;
  }

  function createRow(ratios, start, end, height, width, gap, justified) {
    const widths = ratios.slice(start, end).map(ratio => ratio * height);
    if (justified && widths.length) {
      const available = width - gap * Math.max(0, widths.length - 1);
      const used = widths.reduce((sum, itemWidth) => sum + itemWidth, 0);
      widths[widths.length - 1] += available - used;
    }
    return {start, end, height, widths, gap, justified};
  }

  function computeJustifiedRows(inputRatios, containerWidth, targetHeight, gap) {
    const ratios = inputRatios.map(safeRatio);
    const width = Math.max(1, Number(containerWidth) || 1);
    const target = Math.max(24, Number(targetHeight) || 180);
    const spacing = Math.max(0, Number(gap) || 0);
    const maximumSpacing = Math.max(spacing, Math.min(32, spacing * 3));
    const rows = [];
    let start = 0;
    let sum = 0;

    for (let index = 0; index < ratios.length; index += 1) {
      const end = index + 1;
      const candidateSum = sum + ratios[index];
      const count = end - start;
      const naturalWidth = candidateSum * target + spacing * Math.max(0, count - 1);
      if (naturalWidth <= width) {
        sum = candidateSum;
        continue;
      }

      if (count > 1) {
        const previousCount = count - 1;
        const expandedGap = previousCount > 1
          ? (width - sum * target) / (previousCount - 1)
          : Number.POSITIVE_INFINITY;
        if (expandedGap >= spacing && expandedGap <= maximumSpacing) {
          rows.push(createRow(ratios, start, end - 1, target, width, expandedGap, true));
          start = end - 1;
          sum = ratios[index];
          continue;
        }
      }

      const height = fittedHeight(ratios, start, end, width, spacing);
      rows.push(createRow(ratios, start, end, height, width, spacing, true));
      start = end;
      sum = 0;
    }

    if (start < ratios.length) {
      const end = ratios.length;
      const count = end - start;
      const naturalWidth = sum * target + spacing * Math.max(0, end - start - 1);
      if (naturalWidth > width) {
        const height = fittedHeight(ratios, start, end, width, spacing);
        rows.push(createRow(ratios, start, end, height, width, spacing, true));
      } else {
        const expandedGap = count > 1 ? (width - sum * target) / (count - 1) : spacing;
        const fillLastRow = naturalWidth >= width * 0.85 &&
          expandedGap >= spacing && expandedGap <= maximumSpacing;
        rows.push(createRow(
          ratios, start, end, target, width,
          fillLastRow ? expandedGap : spacing,
          fillLastRow
        ));
      }
    }

    return rows;
  }

  // Add document-space offsets without changing the existing row breaks or widths.
  function positionJustifiedRows(rows, gap) {
    let top = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      row.top = top;
      row.bottom = top + Math.max(1, row.height);
      top = row.bottom + (index + 1 < rows.length ? gap : 0);
    }
    return top;
  }

  // End-exclusive row window, found in O(log rows) even for very large libraries.
  function visibleJustifiedRows(rows, top, bottom) {
    if (!rows.length) return {start: 0, end: 0};
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (rows[mid].bottom <= top) lo = mid + 1;
      else hi = mid;
    }
    const start = Math.min(lo, rows.length - 1);
    lo = start;
    hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (rows[mid].top < bottom) lo = mid + 1;
      else hi = mid;
    }
    return {start, end: Math.max(start + 1, lo)};
  }

  // Find a photo's row by its stable position in the sorted media list.
  function justifiedRowForItem(rows, itemIndex) {
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (rows[mid].end <= itemIndex) lo = mid + 1;
      else hi = mid;
    }
    return rows[lo]?.start <= itemIndex ? rows[lo] : null;
  }

  return {computeJustifiedRows, positionJustifiedRows, visibleJustifiedRows, justifiedRowForItem};
});
