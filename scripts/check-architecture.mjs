import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const sourceRoot = path.join(projectRoot, 'src');
const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];
const layerOrder = new Map([
  ['app', 0],
  ['routes', 1],
  ['widgets', 2],
  ['features', 3],
  ['entities', 4],
  ['shared', 5],
]);

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const nextPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'generated' ? [] : walk(nextPath);
    }
    return extensions.includes(path.extname(entry.name)) ? [nextPath] : [];
  });
}

function readImports(filePath) {
  const source = readFileSync(filePath, 'utf8');
  const imports = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      imports.push(match[1]);
    }
  }

  return imports;
}

function resolveImport(importer, specifier) {
  if (!specifier.startsWith('.')) {
    return null;
  }

  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = [
    base,
    ...extensions.map((extension) => `${base}${extension}`),
    ...extensions.map((extension) => path.join(base, `index${extension}`)),
  ];

  return candidates.find((candidate) => existsSync(candidate) && !statSync(candidate).isDirectory()) ?? null;
}

function classifyLayer(filePath) {
  const relative = toPosix(path.relative(sourceRoot, filePath));
  const first = relative.split('/')[0];
  if (relative === 'main.tsx' || relative === 'App.tsx' || first === 'app' || first === 'routing') {
    return 'app';
  }
  if (layerOrder.has(first)) {
    return first;
  }
  if (first === 'api' || first === 'ui' || first === 'styles' || first === 'test' || first === 'types') {
    return 'shared';
  }
  return 'unknown';
}

function findCycles(graph) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function visit(node) {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      cycles.push([...stack.slice(start), node]);
      return;
    }
    if (visited.has(node)) {
      return;
    }

    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      visit(next);
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of graph.keys()) {
    visit(node);
  }

  return cycles;
}

const files = walk(sourceRoot);
const graph = new Map(files.map((file) => [file, []]));
const layerWarnings = [];
const unknownLayerFiles = [];
const generatedApiImportViolations = [];
const productSharedApiImportViolations = [];
const directFetchViolations = [];
const sessionStoreViolations = [];
const legacyApiFacadeImports = [];

function isTestOrMock(filePath) {
  const relative = toPosix(path.relative(sourceRoot, filePath));
  return (
    relative.includes('.test.') ||
    relative.startsWith('test/') ||
    relative.startsWith('api/mock/')
  );
}

function isSharedApiFile(filePath) {
  const relative = toPosix(path.relative(sourceRoot, filePath));
  return relative.startsWith('shared/api/');
}

function isGeneratedApiFile(filePath) {
  const relative = toPosix(path.relative(sourceRoot, filePath));
  return relative.startsWith('shared/api/generated/');
}

function isProductSurface(filePath) {
  const relative = toPosix(path.relative(sourceRoot, filePath));
  return (
    relative.startsWith('features/') ||
    relative.startsWith('widgets/') ||
    relative.startsWith('routes/')
  );
}

for (const file of files) {
  const importerLayer = classifyLayer(file);
  const source = readFileSync(file, 'utf8');
  const relativeFile = toPosix(path.relative(projectRoot, file));
  if (importerLayer === 'unknown') {
    unknownLayerFiles.push(relativeFile);
  }

  if (!isTestOrMock(file) && !isSharedApiFile(file) && /\bfetch\s*\(/.test(source)) {
    directFetchViolations.push(relativeFile);
  }

  if (toPosix(path.relative(sourceRoot, file)) === 'app/auth-store.ts') {
    for (const marker of [' user:', 'setAuthenticated', 'setChecking', 'clearSession']) {
      if (source.includes(marker)) {
        sessionStoreViolations.push(`${relativeFile} contains ${marker.trim()}`);
      }
    }
  }

  for (const specifier of readImports(file)) {
    const target = resolveImport(file, specifier);
    if (!target || !target.startsWith(sourceRoot)) {
      continue;
    }

    graph.get(file)?.push(target);
    if (!isSharedApiFile(file) && isGeneratedApiFile(target)) {
      generatedApiImportViolations.push({
        importer: relativeFile,
        imported: toPosix(path.relative(projectRoot, target)),
      });
    }
    if (!isTestOrMock(file) && isProductSurface(file) && isSharedApiFile(target)) {
      productSharedApiImportViolations.push({
        importer: relativeFile,
        imported: toPosix(path.relative(projectRoot, target)),
      });
    }
    if (
      !isTestOrMock(file) &&
      isProductSurface(file) &&
      toPosix(path.relative(sourceRoot, target)) === 'api/index.ts'
    ) {
      legacyApiFacadeImports.push({
        importer: relativeFile,
        imported: toPosix(path.relative(projectRoot, target)),
      });
    }
    const importedLayer = classifyLayer(target);
    const importerOrder = layerOrder.get(importerLayer);
    const importedOrder = layerOrder.get(importedLayer);
    if (importerOrder !== undefined && importedOrder !== undefined && importedOrder < importerOrder) {
      layerWarnings.push({
        importer: toPosix(path.relative(projectRoot, file)),
        importerLayer,
        imported: toPosix(path.relative(projectRoot, target)),
        importedLayer,
      });
    }
  }
}

const cycles = findCycles(graph);

console.log(`ARCH_CHECK files=${files.length}`);
console.log(`ARCH_CHECK cycles=${cycles.length}`);
if (cycles.length > 0) {
  for (const cycle of cycles.slice(0, 10)) {
    console.log(`cycle: ${cycle.map((item) => toPosix(path.relative(projectRoot, item))).join(' -> ')}`);
  }
}

console.log(`ARCH_CHECK upward_import_warnings=${layerWarnings.length}`);
for (const warning of layerWarnings.slice(0, 25)) {
  console.log(
    `warning: ${warning.importer} (${warning.importerLayer}) -> ${warning.imported} (${warning.importedLayer})`,
  );
}

console.log(`ARCH_CHECK unknown_layer_files=${unknownLayerFiles.length}`);
for (const file of unknownLayerFiles.slice(0, 25)) {
  console.log(`unknown-layer: ${file}`);
}

console.log(`ARCH_CHECK generated_api_import_violations=${generatedApiImportViolations.length}`);
for (const violation of generatedApiImportViolations.slice(0, 25)) {
  console.log(`generated-api-violation: ${violation.importer} -> ${violation.imported}`);
}

console.log(`ARCH_CHECK product_shared_api_import_violations=${productSharedApiImportViolations.length}`);
for (const violation of productSharedApiImportViolations.slice(0, 25)) {
  console.log(`product-shared-api-violation: ${violation.importer} -> ${violation.imported}`);
}

console.log(`ARCH_CHECK direct_fetch_violations=${directFetchViolations.length}`);
for (const violation of directFetchViolations.slice(0, 25)) {
  console.log(`direct-fetch-violation: ${violation}`);
}

console.log(`ARCH_CHECK session_store_violations=${sessionStoreViolations.length}`);
for (const violation of sessionStoreViolations.slice(0, 25)) {
  console.log(`session-store-violation: ${violation}`);
}

console.log(`ARCH_CHECK legacy_api_facade_imports=${legacyApiFacadeImports.length}`);
for (const warning of legacyApiFacadeImports.slice(0, 25)) {
  console.log(`legacy-api-facade-warning: ${warning.importer} -> ${warning.imported}`);
}

console.log('ARCH_CHECK phase8_mode=cycles-layer-and-api-boundaries-fail.');

if (
  cycles.length > 0 ||
  layerWarnings.length > 0 ||
  generatedApiImportViolations.length > 0 ||
  productSharedApiImportViolations.length > 0 ||
  directFetchViolations.length > 0 ||
  sessionStoreViolations.length > 0 ||
  legacyApiFacadeImports.length > 0
) {
  process.exitCode = 1;
}
