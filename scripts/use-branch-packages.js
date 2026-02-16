import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const branchArg = process.argv[2];
if (!branchArg) {
  console.error(
    'Usage: node scripts/use-branch-packages.js <branch-name>\n' +
      '  e.g.: node scripts/use-branch-packages.js feature/observability'
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

// Query npm for each @lazyapps/* package to see if a snapshot exists
const snapshotVersions = new Map();
const unchanged = [];

for (const pkg of [...lazyappsDeps].sort()) {
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
    'Make sure the snapshot workflow has run on the branch and published successfully.'
  );
  process.exit(1);
}

// Update package.json files
let totalUpdates = 0;
for (const { path: pkgPath, content } of packageJsonData) {
  let modified = false;
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
  if (modified) {
    writeFileSync(pkgPath, JSON.stringify(content, null, 2) + '\n');
    console.log(`Updated: ${pkgPath}`);
  }
}

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
