import fs from 'node:fs';
import ts from 'typescript';

const files = [
  'supabase/functions/trigger-unleashed-readonly-sync/core.ts',
  'supabase/functions/trigger-unleashed-readonly-sync/index.ts',
];

let failed = false;
for (const fileName of files) {
  const source = fs.readFileSync(fileName, 'utf8');
  const result = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      isolatedModules: true,
    },
  });
  const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  for (const diagnostic of errors) {
    failed = true;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    if (diagnostic.file && typeof diagnostic.start === 'number') {
      const pos = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      console.error(`${fileName}:${pos.line + 1}:${pos.character + 1} ${message}`);
    } else {
      console.error(`${fileName}: ${message}`);
    }
  }
  if (!errors.length) console.log(`${fileName}: syntax/transpile OK`);
}

if (failed) process.exit(1);
