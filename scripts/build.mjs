import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const base = JSON.parse(await readFile(join(src, 'manifest.base.json'), 'utf8'));

const targets = {
  chrome: {
    ...base,
    minimum_chrome_version: '121',
    background: { service_worker: 'background.js', type: 'module' },
  },
  firefox: {
    ...base,
    background: { scripts: ['background.js'], type: 'module' },
    browser_specific_settings: {
      gecko: {
        id: 'second-look@yatovoid',
        strict_min_version: '128.0',
        update_url: 'https://raw.githubusercontent.com/YatoVoid/second-look/main/updates.json',
        data_collection_permissions: { required: ['none'] },
      },
    },
  },
};

for (const [name, manifest] of Object.entries(targets)) {
  const out = join(root, 'dist', name);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(src, out, { recursive: true, filter: (p) => !p.endsWith('manifest.base.json') });
  await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`built dist/${name}`);
}
