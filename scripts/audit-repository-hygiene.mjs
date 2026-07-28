import fs from 'node:fs';
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

const deployWorkflowPath = '.github/workflows/deploy-supabase-migrations.yml';
const deployWorkflow = fs.readFileSync(deployWorkflowPath, 'utf8');
const workflowViolations = [];

if (/<\s*supabase\/\.temp\/pooler-url/.test(deployWorkflow)) {
  workflowViolations.push('production workflow reads generated supabase/.temp/pooler-url before it can exist');
}
if (/^\s*-\s*['"]supabase\/\.temp\/project-ref['"]\s*$/m.test(deployWorkflow)) {
  workflowViolations.push('generated supabase/.temp/project-ref is still a workflow path trigger');
}
if (!/SUPABASE_POOLER_HOST:\s*aws-1-ap-southeast-2\.pooler\.supabase\.com/.test(deployWorkflow)) {
  workflowViolations.push('governed IPv4 Supabase pooler host is missing');
}
if (!/postgresql:\/\/postgres\.\$\{SUPABASE_PROJECT_REF\}:\$\{ENCODED_PASSWORD\}@\$\{SUPABASE_POOLER_HOST\}:5432\/postgres/.test(deployWorkflow)) {
  workflowViolations.push('pooler URL is not constructed from project ref, encoded password and governed host');
}

const linkIndex = deployWorkflow.indexOf('- name: Link production project');
const verifyIndex = deployWorkflow.indexOf('- name: Verify linked production project');
const projectRefReadIndex = deployWorkflow.indexOf('< supabase/.temp/project-ref');
if (linkIndex < 0 || verifyIndex < 0 || projectRefReadIndex < 0) {
  workflowViolations.push('linked project verification contract is incomplete');
} else if (!(linkIndex < verifyIndex && verifyIndex < projectRefReadIndex)) {
  workflowViolations.push('generated project-ref is read before supabase link creates it');
}

if (violations.length > 0 || workflowViolations.length > 0) {
  if (violations.length > 0) {
    console.error('Repository hygiene check failed. Remove these files from Git tracking:');
    for (const violation of violations) {
      console.error(`- ${violation.path} (${violation.description})`);
    }
    console.error('Rotate any credential that may already have been committed; removing a file does not remove Git history.');
  }
  if (workflowViolations.length > 0) {
    console.error('Repository hygiene check failed. Repair the production deployment workflow:');
    for (const violation of workflowViolations) {
      console.error(`- ${violation}`);
    }
  }
  process.exit(1);
}

console.log(
  `Repository hygiene check passed (${trackedFiles.length} tracked files inspected; Supabase generated-state dependency rejected).`
);
