import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const codeDigest = (source) => createHash('sha256').update(source.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).filter((line) => line.trim() && !line.trimStart().startsWith('//')).join('\n')).digest('hex');

export async function checkPublicContract({ remote = false } = {}) {
  const root = new URL('../../../', import.meta.url);
  const pin = JSON.parse(readFileSync(new URL('../src/chain/fixtures/public-program-contract.json', import.meta.url), 'utf8'));
  for (const [path, expected] of Object.entries(pin.files)) {
    if (codeDigest(readFileSync(new URL(path, root), 'utf8')) !== expected.codeSha256) throw new Error(`Local source differs from public contract: ${path}`);
  }
  if (remote) {
    const headResponse = await fetch('https://api.github.com/repos/twzrd-sol/ansem-radio/commits/main', { headers: { 'user-agent': 'radiolan-hub-contract-check' }, signal: AbortSignal.timeout(15_000) });
    if (!headResponse.ok) throw new Error(`Public HEAD unavailable: HTTP ${headResponse.status}`);
    const { sha } = await headResponse.json();
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Invalid public HEAD');
    for (const [path, expected] of Object.entries(pin.files)) {
      const response = await fetch(`https://raw.githubusercontent.com/twzrd-sol/ansem-radio/${sha}/${path}`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Public source unavailable: ${path}: HTTP ${response.status}`);
      if (codeDigest(await response.text()) !== expected.codeSha256) throw new Error(`Latest public contract changed: ${path} at ${sha}. Review and update the hub before release.`);
    }
    return { pinnedCommit: pin.commit, latestPublicCommit: sha };
  }
  return { pinnedCommit: pin.commit };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  checkPublicContract({ remote: process.argv.includes('--remote') }).then((result) => console.log('Public arena contract matches:', JSON.stringify(result))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
