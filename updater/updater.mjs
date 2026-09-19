import fetch from 'node-fetch';
import fs from 'fs';

const OWNER = 'aabiberyi-prog';
const REPO = 'forge';
const PRODUCT = 'Pot Forge';

async function resolveUpdater() {
    if (process.env.GITHUB_TOKEN === undefined) {
        throw new Error('GITHUB_TOKEN is required');
    }

    const token = process.env.GITHUB_TOKEN;
    const version = await getVersion(token);
    if (!version) {
        throw new Error('could not resolve latest Forge release tag');
    }
    const changelog = (await getChangeLog(token)) || `Forge ${version}`;
    const windowsZip = `${PRODUCT}_${version.replace(/^v/, '')}_x64-setup.nsis.zip`;
    const windowsUrl = releaseAsset(version, windowsZip);
    const windowsSig = await getSignature(`${windowsUrl}.sig`);
    if (!windowsSig) {
        throw new Error(`missing Windows updater signature for ${windowsZip}`);
    }

    const updateData = {
        name: version,
        notes: changelog,
        pub_date: new Date().toISOString(),
        platforms: {
            'windows-x86_64': {
                signature: windowsSig,
                url: windowsUrl,
            },
        },
    };
    fs.writeFileSync('./update.json', JSON.stringify(updateData, null, 4));
}

function releaseAsset(version, fileName) {
    return `https://github.com/${OWNER}/${REPO}/releases/download/${version}/${encodeURIComponent(fileName)}`;
}

async function githubJson(token, url) {
    const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
        return null;
    }
    return res.json();
}

async function getVersion(token) {
    const data = await githubJson(token, `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`);
    return data?.tag_name;
}

async function getChangeLog(token) {
    const data = await githubJson(token, `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`);
    return data?.body;
}

async function getSignature(url) {
    const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/octet-stream' },
    });
    if (response.ok) {
        return response.text();
    }
    return '';
}

resolveUpdater().catch((error) => {
    console.error(error);
    process.exit(1);
});
