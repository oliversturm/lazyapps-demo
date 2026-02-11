import { execSync } from 'node:child_process';

console.log('Restoring all package.json files to their git-committed state...\n');

try {
  execSync(
    'git checkout -- packages/*/package.json packages/*/*/package.json package.json',
    { stdio: 'inherit' }
  );
  console.log('\nDone. All package.json files restored to committed versions.');
  console.log('Run `pnpm install` or `npm install` to update node_modules.');
} catch (err) {
  console.error('Failed to restore package.json files:', err.message);
  process.exit(1);
}
