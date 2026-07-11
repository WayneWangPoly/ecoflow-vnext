import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const write = (path, content) => writeFileSync(path, content, 'utf8');

function replaceOrThrow(path, pattern, replacement, label) {
  const source = read(path);
  if (!pattern.test(source)) throw new Error(`${label}: expected source pattern was not found in ${path}`);
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`${label}: replacement did not change ${path}`);
  write(path, next);
  console.log(`patched ${path}: ${label}`);
}

function removeIfPresent(path) {
  if (!existsSync(path)) return;
  unlinkSync(path);
  console.log(`removed ${path}`);
}

const driverRunPath = 'src/domain/driverRun.ts';
replaceOrThrow(
  driverRunPath,
  /export type PodRecord = \{[\s\S]*?\n\};\n\nexport type StopException/,
  `export type PodRecord = {\n  /** Device-only caches; stripped before shared day-state sync. */\n  pod1Photo?: string;\n  pod2Photo?: string;\n  /** Supabase Storage paths and the shared POD source of truth. */\n  pod1Path?: string;\n  pod2Path?: string;\n  note?: string;\n  location?: GeoPoint;\n  capturedAt: string;\n  /** Legacy aliases retained only so historic synced records remain readable. */\n  photo?: string;\n  signature?: string;\n  photoPath?: string;\n  signaturePath?: string;\n  receiverName?: string;\n};\n\nexport type StopException`,
  'replace POD record with two-proof model',
);
replaceOrThrow(driverRunPath, /const BOX_CODES = \[[^\n]+\];\n/, '', 'remove repeating six-letter box list');
replaceOrThrow(
  driverRunPath,
  /export function boxCodeForStop\(index: number\): string \{\n  return BOX_CODES\[index % BOX_CODES\.length\];\n\}/,
  `export function boxCodeForStop(index: number): string {\n  let value = Math.max(0, Math.floor(index));\n  let code = '';\n  do {\n    code = String.fromCharCode(65 + (value % 26)) + code;\n    value = Math.floor(value / 26) - 1;\n  } while (value >= 0);\n  return code;\n}`,
  'generate non-repeating spreadsheet-style box codes',
);

const pickSyncPath = 'src/data/repositories/pickSync.ts';
replaceOrThrow(
  pickSyncPath,
  /import type \{ PickState, PickTaskState \} from '@\/domain\/pickPlan';/,
  `import type { PickState, PickTaskState } from '@/domain/pickPlan';\nimport { supabase } from '@/lib/supabaseClient';`,
  'import authenticated Supabase client',
);
replaceOrThrow(
  pickSyncPath,
  /function baseHeaders\(\): Record<string, string> \{[\s\S]*?\n\}\n\nasync function rest<T>\(path: string, init\?: RequestInit\): Promise<T> \{[\s\S]*?\n\}/,
  `async function authenticatedHeaders(): Promise<Record<string, string>> {\n  const anonKey = envValue('VITE_SUPABASE_ANON_KEY');\n  if (!supabase) throw new Error('Supabase is not configured.');\n  const { data, error } = await supabase.auth.getSession();\n  if (error) throw error;\n  const token = data.session?.access_token;\n  if (!token) throw new Error('Authenticated EcoFlow session is required for shared operational state.');\n  return { apikey: anonKey, Authorization: \`Bearer \${token}\` };\n}\n\nasync function rest<T>(path: string, init?: RequestInit): Promise<T> {\n  const baseUrl = envValue('VITE_SUPABASE_URL').replace(/\\/$/, '');\n  const response = await fetch(\`\${baseUrl}/rest/v1/\${path}\`, {\n    ...init,\n    headers: {\n      ...(await authenticatedHeaders()),\n      Accept: 'application/json',\n      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),\n      ...init?.headers\n    }\n  });\n  if (!response.ok) throw new Error(\`Supabase \${response.status}: \${await response.text()}\`);\n  if (response.status === 204) return undefined as T;\n  const text = await response.text();\n  return (text ? JSON.parse(text) : undefined) as T;\n}`,
  'use user JWT for operational REST calls',
);
replaceOrThrow(
  pickSyncPath,
  /headers: \{ \.\.\.baseHeaders\(\), 'Content-Type': mime, 'x-upsert': 'true' \},/,
  `headers: { ...(await authenticatedHeaders()), 'Content-Type': mime, 'x-upsert': 'true' },`,
  'use user JWT for POD storage writes',
);
replaceOrThrow(
  pickSyncPath,
  /const \{ photo: _photo, signature: _signature, \.\.\.rest \} = pod;/,
  `const { photo: _photo, signature: _signature, pod1Photo: _pod1Photo, pod2Photo: _pod2Photo, ...rest } = pod;`,
  'strip both native POD image caches before sync',
);
replaceOrThrow(
  pickSyncPath,
  /const pod = incoming\.pod && local\?\.pod && incoming\.pod\.capturedAt === local\.pod\.capturedAt\n        \? \{ \.\.\.incoming\.pod, photo: local\.pod\.photo, signature: local\.pod\.signature \}\n        : incoming\.pod;/,
  `const pod = incoming.pod && local?.pod && incoming.pod.capturedAt === local.pod.capturedAt\n        ? {\n            ...incoming.pod,\n            photo: local.pod.photo,\n            signature: local.pod.signature,\n            pod1Photo: local.pod.pod1Photo,\n            pod2Photo: local.pod.pod2Photo,\n          }\n        : incoming.pod;`,
  'preserve native POD caches while paths sync',
);

const driverAppPath = 'src/app/DriverApp.tsx';
replaceOrThrow(driverAppPath, /\n  PenLine,/, '', 'remove signature icon import');
replaceOrThrow(
  driverAppPath,
  /import \{ podAssetUrl, uploadPodAsset \} from '@\/data\/repositories\/pickSync';/,
  `import { podAssetUrl } from '@/data/repositories/pickSync';\nimport { saveDropPointProof, saveGoodsPlacedProof } from '@/data/repositories/deliveryPodQuality';\nimport { dispatchDeliveryNotifications, queueDeliveryNotifications } from '@/data/repositories/deliveryOperations';`,
  'import native POD persistence and notification functions',
);
replaceOrThrow(
  driverAppPath,
  /function SignaturePad\([\s\S]*?\n\}\n\nfunction PodSheet/,
  'function PodSheet',
  'remove signature pad implementation',
);
replaceOrThrow(
  driverAppPath,
  /function PodSheet\([\s\S]*?\n\}\n\nfunction FailSheet/,
  `function PodSheet({ stop, stopNumber, onCancel, onSubmit }: { stop: RunStop; stopNumber: number; onCancel: () => void; onSubmit: (pod: PodRecord) => Promise<void> }) {\n  const [pod1Photo, setPod1Photo] = useState<string | undefined>();\n  const [pod2Photo, setPod2Photo] = useState<string | undefined>();\n  const [note, setNote] = useState('');\n  const [location, setLocation] = useState<GeoPoint | undefined>();\n  const [busy, setBusy] = useState(false);\n  const [error, setError] = useState('');\n\n  useEffect(() => {\n    let active = true;\n    capturePosition().then((point) => { if (active) setLocation(point); });\n    return () => { active = false; };\n  }, []);\n\n  const canSubmit = Boolean(pod1Photo && pod2Photo) && !busy;\n\n  async function submit() {\n    if (!pod1Photo || !pod2Photo || busy) return;\n    setBusy(true);\n    setError('');\n    try {\n      await onSubmit({\n        pod1Photo,\n        pod2Photo,\n        note: note.trim() || undefined,\n        location,\n        capturedAt: nowIso(),\n      });\n    } catch (reason) {\n      setError(reason instanceof Error ? reason.message : String(reason));\n      setBusy(false);\n    }\n  }\n\n  return (\n    <div className="driver-overlay" role="dialog" aria-label={\`Proof of delivery for \${stop.store}\`}>\n      <div className="driver-bottom-sheet">\n        <div className="sheet-grab" />\n        <div className="sheet-head">\n          <div><strong>Proof of delivery</strong><span>Stop {stopNumber} · {stop.store}</span></div>\n          <button type="button" className="driver-icon-button" disabled={busy} onClick={onCancel} aria-label="Close"><X size={20} /></button>\n        </div>\n        <div className="pod-quality-pod1-note"><b>1</b><span><strong>Store / placement point</strong><small>Show signage, entrance, counter or another recognisable delivery point.</small></span></div>\n        <PhotoField label="Take POD 1 · store / placement point" value={pod1Photo} onChange={setPod1Photo} />\n        <div className="pod-quality-pod1-note"><b>2</b><span><strong>All goods</strong><small>Show every delivered carton together at the agreed placement point.</small></span></div>\n        <PhotoField label="Take POD 2 · all goods" value={pod2Photo} onChange={setPod2Photo} />\n        <label className="pod-input"><span>Delivery note (optional)</span><input value={note} placeholder="Left at counter, rear door, etc." onChange={(event) => setNote(event.target.value)} /></label>\n        <div className="pod-meta-line"><MapPin size={14} /> {formatGeoPoint(location)} · {formatClockTime(nowIso())}</div>\n        {!pod1Photo || !pod2Photo ? <div className="pod-requirement">POD 1 and POD 2 are required. Receiver name and signature are not required.</div> : null}\n        {error ? <div className="pod-requirement">Not completed: {error}</div> : null}\n        <button type="button" className="driver-primary-button" disabled={!canSubmit} onClick={() => void submit()}>\n          <CheckCircle2 size={20} /> {busy ? 'Uploading proof…' : 'Confirm delivered'}\n        </button>\n      </div>\n    </div>\n  );\n}\n\nfunction FailSheet`,
  'replace POD sheet with native two-photo workflow',
);
replaceOrThrow(
  driverAppPath,
  /function PodSummary\([\s\S]*?\n\}\n\nfunction ExceptionSummary/,
  `function PodSummary({ pod }: { pod: PodRecord }) {\n  const pod1 = pod.pod1Photo || pod.pod1Path || pod.photo || pod.photoPath;\n  const pod2 = pod.pod2Photo || pod.pod2Path || pod.signature || pod.signaturePath;\n  const src = (value?: string) => value ? (value.startsWith('data:') ? value : podAssetUrl(value)) : undefined;\n  return (\n    <div className="pod-summary">\n      <div className="pod-summary-head"><CheckCircle2 size={18} /> Delivered {formatClockTime(pod.capturedAt)}</div>\n      <div className="pod-summary-meta">\n        <span><MapPin size={13} /> {formatGeoPoint(pod.location)}</span>\n        {pod.note ? <span>“{pod.note}”</span> : null}\n      </div>\n      <div className="pod-summary-thumbs">\n        {pod1 ? <img src={src(pod1)} alt="POD 1 store or placement point" loading="lazy" /> : null}\n        {pod2 ? <img src={src(pod2)} alt="POD 2 all delivered goods" loading="lazy" /> : null}\n      </div>\n    </div>\n  );\n}\n\nfunction ExceptionSummary`,
  'render native POD 1 and POD 2 history',
);
replaceOrThrow(
  driverAppPath,
  /  async function completeDelivery\([\s\S]*?\n  \}\n\n  function failDelivery/,
  `  async function completeDelivery(row: StopWithProgress, pod: PodRecord) {\n    if (!pod.pod1Photo || !pod.pod2Photo) throw new Error('POD 1 and POD 2 are both required.');\n    const context = {\n      businessDay: businessDay.date,\n      orderId: row.stop.orderId,\n      orderNumber: row.stop.orderNo,\n      stopNumber: row.displayNumber,\n      boxCode: row.stop.boxCode,\n      storeName: row.stop.store,\n      actorLabel: actorLabel || 'Driver',\n    };\n    const [pod1Path, pod2Path] = await Promise.all([\n      saveDropPointProof({ context, dataUrl: pod.pod1Photo }),\n      saveGoodsPlacedProof({ context, dataUrl: pod.pod2Photo }),\n    ]);\n    await queueDeliveryNotifications({\n      ...context,\n      outcome: 'DELIVERED',\n      eventKey: \`\${businessDay.date}:\${row.stop.orderId}:DELIVERED\`,\n      storePhone: row.stop.phone || null,\n      pod1Path,\n      pod2Path,\n      internalDetail: 'Full delivery completed with required two-photo POD.',\n    });\n    void dispatchDeliveryNotifications({ businessDay: businessDay.date, orderId: row.stop.orderId }).catch(() => undefined);\n\n    const savedPod: PodRecord = {\n      note: pod.note,\n      location: pod.location,\n      capturedAt: pod.capturedAt,\n      pod1Path,\n      pod2Path,\n    };\n    patchStop(row.stop.orderId, { status: 'DELIVERED', completedAt: pod.capturedAt, pod: savedPod });\n    setOrderStatus(row.stop.orderId, 'DELIVERED', true);\n    setPodOpen(false);\n    setActiveStopId(null);\n    setTab('stops');\n  }\n\n  function failDelivery`,
  'persist both POD proofs before marking delivered',
);

const driverBundlePath = 'src/enhancers/DriverEnhancers.tsx';
replaceOrThrow(driverBundlePath, /import \{ DriverPodQualityEnhancer \} from '\.\.\/DriverPodQualityEnhancer';\n/, '', 'remove legacy POD enhancer import');
replaceOrThrow(driverBundlePath, /\n      <DriverPodQualityEnhancer \/>/, '', 'remove legacy POD enhancer mount');

const inventoryPath = 'src/InventoryControlCenter.tsx';
replaceOrThrow(inventoryPath, /type === 'PUTAWAY' \|\| type === 'RECEIVE' \|\| type === 'ADJUST_IN'/, `type === 'PUTAWAY' || type === 'ADJUST_IN'`, 'remove RECEIVE from location requirement logic');
replaceOrThrow(inventoryPath, /\n          <option value="RECEIVE">Receive<\/option>/, '', 'remove direct Receive option from inventory ledger');
replaceOrThrow(inventoryPath, /movementType: 'RECEIVE'/, `movementType: 'PUTAWAY'`, 'default inventory ledger to putaway');

const ownerBundlePath = 'src/enhancers/OwnerEnhancers.tsx';
replaceOrThrow(ownerBundlePath, /import \{ InventoryMovementPolicy \} from '\.\.\/InventoryMovementPolicy';\n/, '', 'remove DOM inventory policy import');
replaceOrThrow(ownerBundlePath, /import '\.\.\/inventoryMovementPolicy\.css';\n/, '', 'remove DOM inventory policy CSS import');
replaceOrThrow(ownerBundlePath, /\n      <InventoryMovementPolicy \/>/, '', 'remove DOM inventory policy mount');
removeIfPresent('src/InventoryMovementPolicy.tsx');
removeIfPresent('src/inventoryMovementPolicy.css');

const auditPath = 'scripts/audit-warehouse-productisation.mjs';
replaceOrThrow(auditPath, /const driverApp = read\('src\/app\/DriverApp\.tsx'\);/, `const driverApp = read('src/app/DriverApp.tsx');\nconst driverRun = read('src/domain/driverRun.ts');\nconst pickSync = read('src/data/repositories/pickSync.ts');\nconst inventoryControl = read('src/InventoryControlCenter.tsx');`, 'load native field implementation files in audit');
replaceOrThrow(auditPath, /const podQuality = read\('src\/DriverPodQualityEnhancer\.tsx'\);\n/, '', 'stop auditing removed POD enhancer');
replaceOrThrow(auditPath, /assert\.match\(ownerBundle, \/InventoryMovementPolicy\/, 'Owner inventory must block uncontrolled receiving\.'\);/, `assert.doesNotMatch(ownerBundle, /InventoryMovementPolicy/, 'Owner must not rely on a DOM patch to hide uncontrolled receiving.');\nassert.doesNotMatch(inventoryControl, /option value="RECEIVE"/, 'Inventory ledger must not expose a direct Receive movement.');`, 'audit native inventory receiving policy');
replaceOrThrow(
  auditPath,
  /assert\.match\(podQuality, \/saveDropPointProof\/[\s\S]*?assert\.match\(podRepository, \/POD2_GOODS_PLACED\/, 'POD 2 must persist as a typed proof record\.'\);/,
  `assert.match(driverApp, /Take POD 1 · store \/ placement point/, 'DriverApp must natively request POD 1.');\nassert.match(driverApp, /Take POD 2 · all goods/, 'DriverApp must natively request POD 2.');\nassert.match(driverApp, /saveDropPointProof[\\s\\S]+saveGoodsPlacedProof/, 'Both proof uploads must complete before delivery status changes.');\nassert.doesNotMatch(driverApp, /function SignaturePad|Received by/, 'Driver POD must not request signature or receiver name.');\nassert.match(driverApp, /await queueDeliveryNotifications/, 'Delivery notification queueing must be part of the native delivery transaction.');\nassert.match(podRepository, /POD1_DROP_POINT/, 'POD 1 must persist as a typed proof record.');\nassert.match(podRepository, /POD2_GOODS_PLACED/, 'POD 2 must persist as a typed proof record.');\nassert.match(driverRun, /Math\\.floor\\(value \/ 26\\) - 1/, 'Box codes must continue beyond Z without repeating.');\nassert.doesNotMatch(driverRun, /index % BOX_CODES\\.length/, 'Box codes must never wrap back to A.');\nassert.match(pickSync, /Authenticated EcoFlow session is required/, 'Shared day state must require a signed-in user JWT.');\nassert.match(pickSync, /Bearer \\${token}/, 'Operational REST and storage writes must use the user access token.');`,
  'audit native POD, box codes and authenticated sync',
);

console.log('Native POD, authenticated field sync, unique box codes and inventory movement consolidation applied.');
