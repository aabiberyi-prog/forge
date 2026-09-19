import { globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const dir = '.scripts/tests';
const files = globSync('*.test.mjs', { cwd: dir })
    .map((name) => path.join(dir, name))
    .sort();
if (files.length === 0) {
    console.error('No .scripts/tests/*.test.mjs files found');
    process.exit(1);
}
const result = spawnSync(
    process.execPath,
    ['--experimental-vm-modules', '--test', ...files],
    { stdio: 'inherit' }
);
process.exit(result.status === null ? 1 : result.status);
