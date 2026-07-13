#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/app/App.tsx';
let source = await readFile(path, 'utf8');
const before = "const [authProfile, setAuthProfile] = useState<EcoFlowAuthProfile | null>(() => readCachedAuthProfile());";
const after = "const [authProfile, setAuthProfile] = useState<EcoFlowAuthProfile | null>(null);";
if (source.includes(before)) source = source.replace(before, after);
else if (!source.includes(after)) throw new Error('Expected auth profile state declaration was not found.');
await writeFile(path, source);
console.log('Cached profile now restores only after the Supabase session user is verified.');
