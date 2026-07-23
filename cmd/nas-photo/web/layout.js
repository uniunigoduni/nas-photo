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

  return {computeJustifiedRows};
});
