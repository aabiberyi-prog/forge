const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

// pnpm resolves mapped drives back to UNC paths, which CMD and Vite 5 cannot use reliably.
// Reuse an existing mapping of this exact directory; other platforms keep their normal cwd.
if (process.platform === 'win32' && process.cwd().startsWith('\\\\')) {
    const current = process.cwd();
    const normalize = (value) => value.replaceAll('/', '\\').replace(/\\$/, '').toLowerCase();
    const output = execFileSync(
        'powershell.exe',
        [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Get-PSDrive -PSProvider FileSystem | Where-Object DisplayRoot | Select-Object Name,DisplayRoot | ConvertTo-Json -Compress',
        ],
        { encoding: 'utf8', windowsHide: true }
    );
    const mappings = output.trim() ? [].concat(JSON.parse(output)) : [];
    mappings.sort((left, right) => right.DisplayRoot.length - left.DisplayRoot.length);
    const mapping = mappings.find(
        ({ DisplayRoot }) =>
            normalize(current) === normalize(DisplayRoot) ||
            normalize(current).startsWith(normalize(DisplayRoot) + '\\')
    );
    if (!mapping)
        throw new Error('Map this NAS share to a Windows drive before running Forge build tools (see MERGE-PLAN.md).');
    const mapped = `${mapping.Name}:\\${current.slice(mapping.DisplayRoot.replace(/\\$/, '').length).replace(/^\\/, '')}`;
    if (normalize(fs.realpathSync.native(mapped)) !== normalize(fs.realpathSync.native(current))) {
        throw new Error('The mapped drive does not resolve to this Forge workspace.');
    }
    process.chdir(mapped);
}

const [tool, ...args] = process.argv.slice(2);
const entries = { vite: 'node_modules/vite/bin/vite.js', tauri: 'node_modules/@tauri-apps/cli/tauri.js' };
if (!entries[tool]) throw new Error('Expected vite or tauri.');
const result = spawnSync(process.execPath, [path.resolve(entries[tool]), ...args], {
    cwd: process.cwd(),
    stdio: 'inherit',
    windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
