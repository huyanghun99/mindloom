import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
const out = '/mnt/data/mindloom-project.zip';
if (existsSync(out)) rmSync(out);
execFileSync('zip', ['-r', out, 'mindloom', '-x', 'mindloom/node_modules/*', 'mindloom/.git/*'], {
  cwd: '/mnt/data',
  stdio: 'inherit'
});
console.log(out);
