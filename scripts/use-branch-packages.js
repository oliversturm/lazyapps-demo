import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const branchArg = process.argv[2];
if (!branchArg) {
  console.error(
    'Usage: node scripts/use-branch-packages.js <branch-name>\n' +
      '  e.g.: node scripts/use-branch-packages.js feature/observability',
  );
  process.exit(1);
}

// Derive the npm dist-tag the same way the CI workflow does:
// feature/observability → branch-feature-observability
const tag = 'branch-' + branchArg.replace(/\//g, '-');
console.log(`Looking up snapshots with npm dist-tag: ${tag}\n`);

// Find all package.json files under packages/ (recursive, skip node_modules)
const packageJsonPaths = findPackageJsonFiles('packages');

// Collect all unique @lazyapps/* dependency names (excluding demo's own packages)
const lazyappsDeps = new Set();
const packageJsonData = packageJsonPaths.map((p) => {
  const content = JSON.parse(readFileSync(p, 'utf8'));
  collectLazyappsDeps(content, lazyappsDeps);
  return { path: p, content };
});

// Also check root package.json
const rootPkg = JSON.parse(readFileSync('package.json', 'utf8'));
collectLazyappsDeps(rootPkg, lazyappsDeps);
packageJsonData.push({ path: 'package.json', content: rootPkg });

// Discover ALL @lazyapps/* packages from the npm registry, not just direct
// dependencies. This is critical because transitive-only dependencies (e.g.
// @lazyapps/command-processor via @lazyapps/bootstrap) also need overrides to
// prevent semver prerelease ranges from cross-resolving to other branches'
// snapshots.
const allScopePackages = new Set(lazyappsDeps);
try {
  const searchResult = execSync('npm search @lazyapps --json 2>/dev/null', {
    encoding: 'utf8',
  });
  const packages = JSON.parse(searchResult);
  for (const pkg of packages) {
    if (
      pkg.name.startsWith('@lazyapps/') &&
      !pkg.name.startsWith('@lazyapps/demo')
    ) {
      allScopePackages.add(pkg.name);
    }
  }
  console.log(
    `Discovered ${allScopePackages.size} @lazyapps/* packages ` +
      `(${lazyappsDeps.size} direct, ` +
      `${allScopePackages.size - lazyappsDeps.size} from registry)\n`,
  );
} catch {
  console.log(
    'Warning: could not query npm registry for full package list, ' +
      'using direct dependencies only\n',
  );
}

// Query npm for each @lazyapps/* package to see if a snapshot exists
const snapshotVersions = new Map();
const unchanged = [];

for (const pkg of [...allScopePackages].sort()) {
  try {
    const version = execSync(`npm view ${pkg}@${tag} version 2>/dev/null`, {
      encoding: 'utf8',
    }).trim();
    if (version) {
      snapshotVersions.set(pkg, version);
    } else {
      unchanged.push(pkg);
    }
  } catch {
    unchanged.push(pkg);
  }
}

if (snapshotVersions.size === 0) {
  console.log('No snapshot versions found for any @lazyapps/* packages.');
  console.log(
    'Make sure the snapshot workflow has run on the branch and published successfully.',
  );
  process.exit(1);
}

// Build sorted overrides object from all snapshot versions
const overridesObj = Object.fromEntries(
  [...snapshotVersions].sort(([a], [b]) => a.localeCompare(b)),
);

// Update package.json files. Two pinning mechanisms are needed, one per
// package manager in play:
//
// - pnpm (host installs + the monolith e2e image, which run
//   `pnpm install` against the workspace): transitive @lazyapps/* pins live
//   in the `overrides:` block of pnpm-workspace.yaml (written below) —
//   pnpm >= 11 no longer reads the `pnpm` field from package.json.
//
// - npm (each orchestrated service Dockerfile copies ONLY its own
//   package.json and runs a standalone `npm install`, no lockfile): those
//   builds need npm-style `overrides` in the sub-package package.json.
//   Without them, npm resolves transitive @lazyapps/* deps (e.g.
//   @lazyapps/command-processor via @lazyapps/bootstrap) by semver range,
//   and prerelease ordering can select another branch's snapshot
//   (branch-feature-x sorts after branch-admin-y), silently installing
//   incompatible cross-branch code. Do NOT remove these again without
//   checking packages/orchestrated/*/Dockerfile.
let totalUpdates = 0;
for (const { path: pkgPath, content } of packageJsonData) {
  let modified = false;

  // Update direct dependency versions
  for (const depType of ['dependencies', 'devDependencies']) {
    if (content[depType]) {
      for (const [name, version] of snapshotVersions) {
        if (content[depType][name] !== undefined) {
          content[depType][name] = version;
          modified = true;
          totalUpdates++;
        }
      }
    }
  }

  // Sub-packages with @lazyapps/* deps: npm overrides for ALL snapshot
  // packages (required by the standalone npm-based Docker builds, see above)
  const isRoot = pkgPath === 'package.json';
  if (!isRoot && hasAnyLazyappsDep(content)) {
    content.overrides = { ...overridesObj };
    modified = true;
    console.log(
      `Set npm overrides in ${pkgPath} (${snapshotVersions.size} packages)`,
    );
  }

  if (modified) {
    writeFileSync(pkgPath, JSON.stringify(content, null, 2) + '\n');
    console.log(`Updated: ${pkgPath}`);
  }
}

// Pin transitive @lazyapps/* resolution via pnpm overrides in
// pnpm-workspace.yaml (the settings home for pnpm >= 11). This replaces the
// managed block in place; `pnpm run use-released` restores the committed
// baseline via git checkout.
setWorkspaceOverrides(overridesObj);
console.log(
  `Set pnpm overrides in pnpm-workspace.yaml (${snapshotVersions.size} packages)`,
);

// Summary
console.log('\n--- Summary ---');
console.log(`\nSnapshot versions (tag: ${tag}):`);
for (const [name, version] of [...snapshotVersions].sort()) {
  console.log(`  ${name} → ${version}`);
}
if (unchanged.length > 0) {
  console.log(`\nUnchanged (no snapshot for this branch):`);
  for (const name of unchanged) {
    console.log(`  ${name}`);
  }
}
console.log(`\nTotal dependency entries updated: ${totalUpdates}`);
console.log('\nRun `pnpm install` or `npm install` to fetch the new versions.');

// Rewrite the managed `overrides:` block in pnpm-workspace.yaml. Removes any
// existing managed block and appends a fresh one at the end of the file,
// leaving the rest of the workspace config (packages, policies) untouched.
function setWorkspaceOverrides(overridesObj) {
  // Managed-block markers — must match the committed baseline block so this
  // replaces it in place rather than appending a duplicate.
  const OVERRIDES_BEGIN =
    '# === @lazyapps snapshot overrides (managed by scripts/use-branch-packages.js) ===';
  const OVERRIDES_END = '# === end @lazyapps snapshot overrides ===';
  const wsPath = 'pnpm-workspace.yaml';
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const entries = Object.entries(overridesObj).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const block = [
    OVERRIDES_BEGIN,
    '# pnpm >= 11 no longer reads the `pnpm` field from package.json, so @lazyapps',
    '# snapshot overrides live here. `pnpm run use-branch <branch>` rewrites this',
    '# block; `pnpm run use-released` restores it to this committed baseline.',
    'overrides:',
    ...entries.map(([name, version]) => `  '${name}': '${version}'`),
    OVERRIDES_END,
  ].join('\n');

  let ws = readFileSync(wsPath, 'utf8');
  const re = new RegExp(
    `\\n*${escapeRe(OVERRIDES_BEGIN)}[\\s\\S]*?${escapeRe(OVERRIDES_END)}\\n*`,
    'g',
  );
  ws = ws.replace(re, '\n');
  ws = ws.replace(/\s*$/, '\n') + '\n' + block + '\n';
  writeFileSync(wsPath, ws);
}

function hasAnyLazyappsDep(pkgJson) {
  for (const depType of ['dependencies', 'devDependencies']) {
    if (pkgJson[depType]) {
      for (const name of Object.keys(pkgJson[depType])) {
        if (
          name.startsWith('@lazyapps/') &&
          !name.startsWith('@lazyapps/demo')
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function collectLazyappsDeps(pkgJson, set) {
  for (const depType of ['dependencies', 'devDependencies']) {
    if (pkgJson[depType]) {
      for (const name of Object.keys(pkgJson[depType])) {
        if (
          name.startsWith('@lazyapps/') &&
          !name.startsWith('@lazyapps/demo')
        ) {
          set.add(name);
        }
      }
    }
  }
}

function findPackageJsonFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry === 'node_modules') continue;
    const fullPath = path.join(dir, entry);
    if (entry === 'package.json') {
      results.push(fullPath);
    } else {
      try {
        if (statSync(fullPath).isDirectory()) {
          results.push(...findPackageJsonFiles(fullPath));
        }
      } catch {
        // skip inaccessible entries
      }
    }
  }
  return results;
}
