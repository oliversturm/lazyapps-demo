import { execSync } from 'node:child_process';

console.log(
  'Restoring package.json files and pnpm-workspace.yaml to their ' +
    'git-committed state...\n',
);

try {
  // pnpm-workspace.yaml carries the managed @lazyapps overrides block that
  // use-branch rewrites, so restore it alongside the package.json version pins.
  execSync(
    'git checkout -- packages/*/package.json packages/*/*/package.json package.json pnpm-workspace.yaml',
    { stdio: 'inherit' },
  );
  console.log(
    '\nDone. package.json files and pnpm-workspace.yaml restored to ' +
      'committed versions.',
  );
  console.log('Run `pnpm install` or `npm install` to update node_modules.');
} catch (err) {
  console.error('Failed to restore package.json files:', err.message);
  process.exit(1);
}
