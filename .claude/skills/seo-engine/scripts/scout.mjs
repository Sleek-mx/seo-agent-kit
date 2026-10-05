// Local topic preview. No network, queue database, or scheduling.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seeds = JSON.parse(readFileSync(path.join(skill, 'seeds.json'), 'utf8'));
for (const [cluster, titles] of Object.entries(seeds)) {
  for (const title of titles) console.log(`[${cluster}] ${title}`);
}
