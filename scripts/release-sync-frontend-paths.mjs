#!/usr/bin/env node
import { readFileSync } from 'node:fs';

export function hasFrontendChanges(paths) {
  const frontendPattern = /^(src\/|public\/|index\.html$|package(?:-lock)?\.json$|vite\.config\.ts$|tsconfig\.json$|vercel\.json$)/;
  return paths.some((path) => frontendPattern.test(path));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const paths = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  process.stdout.write(hasFrontendChanges(paths) ? 'yes\n' : 'no\n');
}
