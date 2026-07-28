import { execFileSync } from 'node:child_process';

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  encoding: 'utf8'
})
  .split('\0')
  .filter(Boolean);

const forbiddenTrackedPathRules = [
  {
    description: 'local provider credential/cache directory',
    matches: (path) => path.startsWith('.cache/')
  },
  {
    description: 'generated Supabase link state',
    matches: (path) => path.startsWith('supabase/.temp/')
  },
  {
    description: 'raw Ordermentum API snapshot in the repository root',
    matches: (path) => /^ordermentum-.*\.(?:json|csv)$/i.test(path)
  },
  {
    description: 'local environment file',
    matches: (path) => /(^|\/)\.env(?:\.|$)/.test(path) && !path.endsWith('.env.example')
  }
];

const violations = forbiddenTrackedPathRules.flatMap((rule) =>
  trackedFiles
    .filter(rule.matches)
    .map((path) => ({ path, description: rule.description }))
);

if (violations.length > 0) {
  console.error('Repository hygiene check failed. Remove these files from Git tracking:');
  for (const violation of violations) {
    console.error(`- ${violation.path} (${violation.description})`);
  }
  console.error('Rotate any credential that may already have been committed; removing a file does not remove Git history.');
  process.exit(1);
}

console.log(`Repository hygiene check passed (${trackedFiles.length} tracked files inspected).`);
