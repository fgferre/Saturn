/**
 * Deploys dist/ to the gh-pages branch (GitHub Pages serves from it).
 * Usage: npm run deploy
 *
 * Branch-based because pushing an Actions workflow needs the 'workflow'
 * OAuth scope (`gh auth refresh -s workflow` would enable that path).
 */

import { execSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync } from 'node:fs';

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

const remote = execSync('git remote get-url origin').toString().trim();

run('npm run build');
writeFileSync('dist/.nojekyll', '');
if (existsSync('dist/.git')) rmSync('dist/.git', { recursive: true, force: true });
run('git init -b gh-pages', 'dist');
run('git add -A', 'dist');
run('git commit -m "Deploy Saturn simulation"', 'dist');
run(`git push --force ${remote} gh-pages`, 'dist');
rmSync('dist/.git', { recursive: true, force: true });
console.log('\nDeployed. Pages updates at the configured URL within a minute or two.');
