import { mkdir, cp, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'dist');
await mkdir(out, { recursive: true });
for (const name of ['index.html', 'src']) await cp(resolve(root, name), resolve(out, name), { recursive: true });
try { await access(resolve(root, 'assets')); await cp(resolve(root, 'assets'), resolve(out, 'assets'), { recursive: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
await writeFile(resolve(out, '.nojekyll'), '');
console.log('Static game built in dist/');
