import fs from 'node:fs';

const path = 'src/features/settings/UnleashedReadonlyProbePanel.tsx';
let source = fs.readFileSync(path, 'utf8');

const importMarker = "import './teamAccessSettings.css';";
const stageImport = "import { InventoryReferenceStagePanel } from './InventoryReferenceStagePanel';";
if (!source.includes(stageImport)) {
  if (!source.includes(importMarker)) throw new Error('R5_003_IMPORT_MARKER_NOT_FOUND');
  source = source.replace(importMarker, `${stageImport}\n${importMarker}`);
}

const tail = `      ) : null}\n    </section>\n  );\n}\n`;
const mountedTail = `      ) : null}\n      <InventoryReferenceStagePanel supabase={supabase} />\n    </section>\n  );\n}\n`;
if (!source.includes('<InventoryReferenceStagePanel supabase={supabase} />')) {
  if (!source.endsWith(tail)) throw new Error('R5_003_PANEL_TAIL_MARKER_NOT_FOUND');
  source = source.slice(0, -tail.length) + mountedTail;
}

fs.writeFileSync(path, source);
console.log('R5-003 stage panel mounted');
