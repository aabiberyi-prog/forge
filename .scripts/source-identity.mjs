import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

export function sourceIdentity() {
    const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
        .split('\0').filter(Boolean).filter((file) => /^(src\/|src-tauri\/|package\.json$|pnpm-lock\.yaml$|vite\.config|tailwind\.config|postcss\.config|\.scripts\/run-tool\.cjs$)/.test(file)).sort();
    const hash = createHash('sha256');
    for (const file of [...new Set(files)]) {
        hash.update(`${file}\0`);
        if (!existsSync(file)) { hash.update('deleted\0'); continue; }
        let data = readFileSync(file);
        if (/\.(rs|json|js|jsx|ts|css|html|toml|lock|yaml|yml)$/.test(file)) data = Buffer.from(data.toString('utf8').replaceAll('\r\n', '\n'));
        hash.update(data); hash.update('\0');
    }
    return {
        head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        fingerprint: hash.digest('hex'),
        dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
    };
}
