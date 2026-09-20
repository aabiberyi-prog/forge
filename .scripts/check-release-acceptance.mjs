import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { sourceIdentity } from './source-identity.mjs';
import { assertReleaseReady } from './acceptance.mjs';

const path = process.argv[2] || 'docs/release-acceptance.json';
if (!existsSync(path)) throw new Error('Release blocked: signed-candidate desktop acceptance evidence is missing');
const report = JSON.parse(readFileSync(path, 'utf8'));
assertReleaseReady(report, sourceIdentity());
if (!existsSync(report.candidate.path)) throw new Error('Accepted candidate artifact is unavailable');
const hash = createHash('sha256').update(readFileSync(report.candidate.path)).digest('hex');
if (hash !== report.candidate.sha256.toLowerCase()) throw new Error('Candidate artifact checksum differs from acceptance evidence');
