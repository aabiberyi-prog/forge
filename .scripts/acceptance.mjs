export function resolveCases(ledger, results) {
    return ledger.cases.map((item) => {
        if (item.layer !== 'unit' || !item.evidence) return { ...item };
        const checks = [].concat(item.evidence).map((name) => {
            const result = results.find((test) => test.name === name || test.name.endsWith(`::${name}`));
            return { name, status: result?.status || 'not_run' };
        });
        const status = checks.some((test) => test.status === 'fail') ? 'fail'
            : checks.every((test) => test.status === 'pass') ? 'pass' : 'not_run';
        return { ...item, status, checks };
    });
}

export function assertReleaseReady(report, identity) {
    if (report.source?.head !== identity.head || report.source?.fingerprint !== identity.fingerprint
        || report.source?.dirty || identity.dirty) throw new Error('Acceptance does not match the clean source being released');
    const required = report.cases?.filter((item) => item.required) || [];
    if (!required.length || required.some((item) => item.status !== 'pass')) throw new Error('Required acceptance cases are incomplete or failed');
    for (const item of required) {
        if (item.layer === 'desktop' && (!item.evidence || !item.candidateSha256)) {
            throw new Error(`Missing desktop evidence/candidate identity: ${item.id}`);
        }
    }
    const candidate = report.candidate;
    if (!candidate?.path || !/^[a-f0-9]{64}$/i.test(candidate.sha256 || '')
        || candidate.sourceFingerprint !== identity.fingerprint
        || required.some((item) => item.layer === 'desktop' && item.candidateSha256 !== candidate.sha256)) {
        throw new Error('Candidate artifact identity does not match desktop evidence');
    }

}
