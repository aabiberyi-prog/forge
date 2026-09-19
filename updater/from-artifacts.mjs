import fs from 'fs';
import path from 'path';

const productName = 'Pot Forge';
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const targetDir =
    process.env.CARGO_TARGET_DIR || path.join('src-tauri', 'target');
const nsisDir = path.join(
    targetDir,
    'x86_64-pc-windows-msvc',
    'release',
    'bundle',
    'nsis'
);
const zipName = `${productName}_${version}_x64-setup.nsis.zip`;
const zipPath = path.join(nsisDir, zipName);
const sigPath = `${zipPath}.sig`;

function requireFile(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`missing updater artifact: ${filePath}`);
    }
}

requireFile(zipPath);
requireFile(sigPath);

const tag = process.env.GITHUB_REF_NAME || version;
const zipUrl = `https://github.com/aabiberyi-prog/forge/releases/download/${tag}/${encodeURIComponent(zipName)}`;
const updateData = {
    name: version,
    notes: `Forge ${version}`,
    pub_date: new Date().toISOString(),
    platforms: {
        'windows-x86_64': {
            signature: fs.readFileSync(sigPath, 'utf8').trim(),
            url: zipUrl,
        },
    },
};

fs.writeFileSync('update.json', JSON.stringify(updateData, null, 4));
console.log(`wrote update.json for ${zipName}`);
