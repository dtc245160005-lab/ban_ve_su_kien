const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
function collect(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? collect(target) : entry.name.endsWith('.js') ? [target] : [];
  });
}
const files = [
  ...fs.readdirSync(root).filter((file) => file.endsWith('.js')).map((file) => path.join(root, file)),
  ...['routes', 'services', 'middleware', 'lib', 'migrations', 'seeds', 'public', 'scripts', 'test']
    .flatMap((directory) => collect(path.join(root, directory))),
];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error(`BUILD: FAIL ${path.relative(root, file)}`);
    process.exit(1);
  }
}
console.log(`BUILD: PASS (${files.length} JavaScript files)`);
