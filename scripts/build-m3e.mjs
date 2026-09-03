import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

const outfile = 'cmd/nas-photo/web/m3e.bundle.js';

await build({
  entryPoints: ['scripts/m3e-entry.js'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  outfile
});

function removeMediaBlocks(source, marker) {
  let removed = 0;
  let start = source.indexOf(marker);
  while (start >= 0) {
    const open = source.indexOf('{', start + marker.length);
    if (open < 0) throw new Error(`Unclosed media query: ${marker}`);
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1;
      if (source[end] === '}') {
        depth -= 1;
        if (depth === 0) { end += 1; break; }
      }
    }
    if (depth !== 0) throw new Error(`Unclosed media query block: ${marker}`);
    source = source.slice(0, start) + source.slice(end);
    removed += 1;
    start = source.indexOf(marker, start);
  }
  return { source, removed };
}

let bundle = await readFile(outfile, 'utf8');
let jsReducedChecks = 0;
bundle = bundle.replace(
  /function ([A-Za-z_$][\w$]*)\(\)\{return matchMedia\(["']\(prefers-reduced-motion\)["']\)\.matches\}/g,
  (_match, name) => {
    jsReducedChecks += 1;
    return `function ${name}(){return!1}`;
  }
);
const stripped = removeMediaBlocks(bundle, '@media (prefers-reduced-motion)');
bundle = stripped.source;
if (bundle.includes('prefers-reduced-motion')) {
  throw new Error('M3E bundle still contains prefers-reduced-motion');
}
if (!jsReducedChecks || !stripped.removed) {
  throw new Error(`Expected M3E reduced-motion guards were not found (js=${jsReducedChecks}, css=${stripped.removed})`);
}

const doubleSpeedReplacements = [
  ['animation: wave-slide 1.5s linear infinite', 'animation: wave-slide .75s linear infinite'],
  ['animation: buffer 250ms linear infinite', 'animation: buffer 125ms linear infinite'],
  ['animation: indeterminate-primary 2.1s infinite linear', 'animation: indeterminate-primary 1.05s infinite linear'],
  ['animation: indeterminate-secondary 2.1s infinite linear', 'animation: indeterminate-secondary 1.05s infinite linear'],
  ['animation-delay: 1.15s', 'animation-delay: .575s'],
  ['minPressedDuration:225', 'minPressedDuration:113'],
];
let hardcodedSpeedups = 0;
for (const [from, to] of doubleSpeedReplacements) {
  if (!bundle.includes(from)) throw new Error(`Expected M3E motion duration not found: ${from}`);
  bundle = bundle.replaceAll(from, to);
  hardcodedSpeedups += 1;
}
await writeFile(outfile, bundle, 'utf8');
console.log(`M3E bundle: OS reduced-motion disabled (js=${jsReducedChecks}, css=${stripped.removed}); 2x hardcoded motion=${hardcodedSpeedups}`);
