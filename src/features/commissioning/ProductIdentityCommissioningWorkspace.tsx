import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Role } from '@/domain/types';
import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import { WarehouseCameraScanner } from '@/WarehouseCameraScanner';
import {
  loadProductIdentityWorkspace,
  productIdentityConflictGuidance,
  productIdentityFriendlyError,
  publishProductIdentityBatch,
  reviewProductIdentityItem,
  saveProductIdentityDraft,
  type CommercialSkuOption,
  type PhysicalSkuOption,
  type ProductIdentityBatchItem,
  type ProductIdentityPackageLevel,
  type ProductIdentityPolicy,
  type ProductIdentityTask,
  type ProductIdentityWorkspaceData,
  type SkuFamilyOption,
} from '@/data/repositories/productIdentityCommissioning';
import './productIdentityCommissioning.css';

const BARCODE_INPUT_ID = 'product-identity-barcode-input';
const CAMERA_SCAN_EVENT = 'ecoflow:warehouse-camera-scan';
const STATUS_FILTERS = ['', 'UNMAPPED', 'CONFLICT', 'REVIEW', 'READY_TO_PUBLISH', 'PUBLISHED'] as const;

type CaptureForm = {
  barcode: string;
  commercialSku: string;
  physicalSku: string;
  productName: string;
  brand: string;
  familyCode: string;
  familyName: string;
  packageLevel: ProductIdentityPackageLevel;
  unitsPerBarcode: string;
  policy: ProductIdentityPolicy;
  preferred: boolean;
  note: string;
};

const EMPTY_FORM: CaptureForm = {
  barcode: '',
  commercialSku: '',
  physicalSku: '',
  productName: '',
  brand: '',
  familyCode: '',
  familyName: '',
  packageLevel: 'CARTON',
  unitsPerBarcode: '1',
  policy: 'ALLOWED',
  preferred: true,
  note: '',
};

function number(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateTime(value?: string | null) {
  if (!value) return 'Not yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function displayStatus(value?: string | null) {
  return String(value || 'UNMAPPED').replaceAll('_', ' ');
}

function statusTone(value?: string | null) {
  const status = String(value || '').toUpperCase();
  if (status === 'PUBLISHED' || status === 'VERIFIED' || status === 'READY_TO_PUBLISH') return 'ready';
  if (status === 'CONFLICT') return 'blocked';
  if (status === 'REVIEW' || status === 'DRAFT') return 'review';
  return 'neutral';
}

function fieldComplete(value: string) {
  return Boolean(value.trim());
}

function CaptureStep({ index, label, complete, active }: { index: number; label: string; complete: boolean; active?: boolean }) {
  return (
    <li className={`${complete ? 'complete' : ''} ${active ? 'active' : ''}`}>
      <span>{complete ? '✓' : index}</span>
      <strong>{label}</strong>
    </li>
  );
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string | number; detail: string; tone?: string }) {
  return (
    <article className={`product-identity-metric ${tone || ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function StateNotice({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return (
    <section className="product-identity-state" role="status">
      <div><strong>{title}</strong><p>{detail}</p></div>
      {action}
    </section>
  );
}

function taskIdentity(task: ProductIdentityTask) {
  return `${task.commercial_sku}:${task.current_item_id || task.physical_sku || 'unmapped'}`;
}

function formFromTask(task: ProductIdentityTask): CaptureForm {
  return {
    ...EMPTY_FORM,
    commercialSku: task.commercial_sku,
    productName: task.product_name || '',
    physicalSku: task.physical_sku || '',
    familyCode: task.family_code || '',
    familyName: task.family_name || '',
    policy: (task.substitution_policy as ProductIdentityPolicy | null) || 'ALLOWED',
    preferred: task.is_preferred ?? true,
  };
}

function formFromItem(item: ProductIdentityBatchItem): CaptureForm {
  return {
    barcode: item.barcode,
    commercialSku: item.commercial_sku,
    physicalSku: item.physical_sku,
    productName: item.product_name,
    brand: item.brand || '',
    familyCode: item.family_code,
    familyName: item.family_name,
    packageLevel: item.package_level,
    unitsPerBarcode: String(item.units_per_barcode),
    policy: item.substitution_policy,
    preferred: item.is_preferred,
    note: item.note || '',
  };
}

function ConflictPanel({ codes }: { codes: string[] }) {
  if (!codes.length) return null;
  return (
    <section className="product-identity-conflicts" aria-live="polite">
      <header><span>Resolution required</span><strong>{codes.length} validation signal{codes.length === 1 ? '' : 's'}</strong></header>
      <div>
        {codes.map((code) => {
          const guidance = productIdentityConflictGuidance(code);
          return (
            <article key={code} className={guidance.blocking ? 'blocking' : 'review'}>
              <span>{guidance.blocking ? 'BLOCKING' : 'REVIEW'}</span>
              <div><strong>{guidance.title}</strong><p>{guidance.detail}</p></div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CaptureWorkspace({
  data,
  role,
  onSaved,
  selectedTask,
  selectedItem,
}: {
  data: ProductIdentityWorkspaceData;
  role: Role;
  onSaved: (message: string, conflicts: string[]) => Promise<void>;
  selectedTask: ProductIdentityTask | null;
  selectedItem: ProductIdentityBatchItem | null;
}) {
  const canApprove = role === 'owner' || role === 'admin';
  const [form, setForm] = useState<CaptureForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [localConflicts, setLocalConflicts] = useState<string[]>([]);
  const barcodeRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (selectedItem) setForm(formFromItem(selectedItem));
    else if (selectedTask) setForm(formFromTask(selectedTask));
  }, [selectedItem, selectedTask]);

  const commercialMatch = useMemo(
    () => data.commercialSkus.find((item) => item.commercial_sku === form.commercialSku.trim().toUpperCase()) ?? null,
    [data.commercialSkus, form.commercialSku],
  );
  const physicalMatch = useMemo(
    () => data.physicalSkus.find((item) => item.physical_sku === form.physicalSku.trim().toUpperCase()) ?? null,
    [data.physicalSkus, form.physicalSku],
  );
  const familyMatch = useMemo(
    () => data.families.find((item) => item.family_code === form.familyCode.trim().toUpperCase()) ?? null,
    [data.families, form.familyCode],
  );

  function update<K extends keyof CaptureForm>(key: K, value: CaptureForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setError('');
  }

  function chooseCommercial(option: CommercialSkuOption) {
    setForm((current) => ({
      ...current,
      commercialSku: option.commercial_sku,
      productName: current.productName || option.product_name,
    }));
  }

  function choosePhysical(option: PhysicalSkuOption) {
    setForm((current) => ({
      ...current,
      physicalSku: option.physical_sku,
      productName: option.product_name,
      brand: option.brand || '',
      familyCode: option.family_code || current.familyCode,
      familyName: option.family_name || current.familyName,
    }));
  }

  function chooseFamily(option: SkuFamilyOption) {
    setForm((current) => ({ ...current, familyCode: option.family_code, familyName: option.family_name }));
  }

  function openCamera() {
    barcodeRef.current?.focus();
    window.dispatchEvent(new CustomEvent(CAMERA_SCAN_EVENT, { detail: { inputId: BARCODE_INPUT_ID } }));
  }

  const validation = useMemo(() => {
    const units = Number(form.unitsPerBarcode);
    return {
      barcode: fieldComplete(form.barcode),
      commercial: fieldComplete(form.commercialSku) && Boolean(commercialMatch),
      physical: fieldComplete(form.physicalSku) && fieldComplete(form.productName),
      family: fieldComplete(form.familyCode) && fieldComplete(form.familyName),
      package: Number.isInteger(units) && units > 0,
    };
  }, [commercialMatch, form]);
  const valid = Object.values(validation).every(Boolean);

  async function save() {
    if (!data.readiness.batch_id) {
      setError('No open commissioning batch is available. Reload the workspace.');
      return;
    }
    if (!valid) {
      setError('Complete the highlighted identity, family and packaging fields before saving.');
      return;
    }
    const units = Number(form.unitsPerBarcode);
    const familyChanged = Boolean(
      physicalMatch?.family_code
      && physicalMatch.family_code !== form.familyCode.trim().toUpperCase(),
    );
    const safeAutoVerify = canApprove
      && form.policy === 'ALLOWED'
      && !familyChanged;

    setBusy(true);
    setError('');
    setLocalConflicts([]);
    try {
      const result = await saveProductIdentityDraft({
        batchId: data.readiness.batch_id,
        barcode: form.barcode,
        physicalSku: form.physicalSku,
        productName: form.productName,
        brand: form.brand,
        familyCode: form.familyCode,
        familyName: form.familyName,
        commercialSku: form.commercialSku,
        packageLevel: form.packageLevel,
        unitsPerBarcode: units,
        substitutionPolicy: form.policy,
        preferred: form.preferred,
        note: form.note,
        expectedBatchRevision: number(data.readiness.batch_revision),
        autoVerify: safeAutoVerify,
      });
      const conflicts = result.conflict_codes ?? [];
      setLocalConflicts(conflicts);
      const message = result.item_state === 'VERIFIED'
        ? `${form.barcode} verified for ${form.commercialSku.toUpperCase()}. Stock was not changed.`
        : result.item_state === 'CONFLICT'
          ? `${form.barcode} saved as a conflict. Nothing was published or added to stock.`
          : `${form.barcode} saved for supervisor review. Stock was not changed.`;
      await onSaved(message, conflicts);
      if (result.item_state === 'VERIFIED') {
        setForm((current) => ({
          ...EMPTY_FORM,
          commercialSku: current.commercialSku,
          productName: current.productName,
          physicalSku: current.physicalSku,
          brand: current.brand,
          familyCode: current.familyCode,
          familyName: current.familyName,
          policy: current.policy,
          preferred: current.preferred,
        }));
        window.setTimeout(() => barcodeRef.current?.focus(), 40);
      }
    } catch (reason) {
      setError(productIdentityFriendlyError(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="product-identity-capture barcode-sprint-screen" aria-labelledby="product-identity-capture-title">
      <header className="product-identity-section-header">
        <div><span>GUIDED CAPTURE</span><h2 id="product-identity-capture-title">Map the package in front of you</h2><p>Physical evidence first. Saving a relationship never changes stock.</p></div>
        <span className="product-identity-safety-chip">STOCK UNCHANGED</span>
      </header>

      <ol className="product-identity-stepper" aria-label="Commissioning steps">
        <CaptureStep index={1} label="Barcode" complete={validation.barcode} active={!validation.barcode} />
        <CaptureStep index={2} label="Commercial SKU" complete={validation.commercial} active={validation.barcode && !validation.commercial} />
        <CaptureStep index={3} label="Physical item" complete={validation.physical} active={validation.commercial && !validation.physical} />
        <CaptureStep index={4} label="SKU Family" complete={validation.family} active={validation.physical && !validation.family} />
        <CaptureStep index={5} label="Pack & policy" complete={validation.package} active={validation.family && !validation.package} />
      </ol>

      {error ? <div className="product-identity-command-result error" role="alert"><strong>Cannot save</strong><span>{error}</span></div> : null}
      <ConflictPanel codes={localConflicts} />

      <div className="product-identity-form-grid">
        <fieldset className="product-identity-fieldset product-identity-barcode-fieldset">
          <legend>1 · Package evidence</legend>
          <label><span>Barcode</span><div className="product-identity-input-action"><input id={BARCODE_INPUT_ID} ref={barcodeRef} value={form.barcode} onChange={(event) => update('barcode', event.target.value.trim())} placeholder="Scan barcode or enter it" inputMode="numeric" autoComplete="off" /><button type="button" onClick={openCamera}>Use camera</button></div></label>
          <div className="product-identity-inline-fields">
            <label><span>Package level</span><select value={form.packageLevel} onChange={(event) => update('packageLevel', event.target.value as ProductIdentityPackageLevel)}><option value="CARTON">Carton</option><option value="SLEEVE">Sleeve</option><option value="INNER">Inner pack</option><option value="EACH">Each</option></select></label>
            <label><span>Units per barcode</span><input type="number" min="1" step="1" inputMode="numeric" value={form.unitsPerBarcode} onChange={(event) => update('unitsPerBarcode', event.target.value)} /></label>
          </div>
        </fieldset>

        <fieldset className="product-identity-fieldset">
          <legend>2 · Commercial SKU</legend>
          <label><span>Ordermentum / sellable SKU</span><input list="product-identity-commercial-options" value={form.commercialSku} onChange={(event) => update('commercialSku', event.target.value.toUpperCase())} onBlur={() => { const match = data.commercialSkus.find((item) => item.commercial_sku === form.commercialSku.trim().toUpperCase()); if (match) chooseCommercial(match); }} placeholder="Search exact SKU" autoCapitalize="characters" /></label>
          <datalist id="product-identity-commercial-options">{data.commercialSkus.map((option) => <option key={option.commercial_sku} value={option.commercial_sku}>{option.product_name}</option>)}</datalist>
          <div className={`product-identity-field-hint ${form.commercialSku && !commercialMatch ? 'invalid' : ''}`}>{commercialMatch ? `${commercialMatch.product_name} · ${number(commercialMatch.units_30d).toLocaleString()} units in 30 days` : 'Choose an exact live catalogue SKU. Similar names are not accepted.'}</div>
        </fieldset>

        <fieldset className="product-identity-fieldset">
          <legend>3 · Physical SKU</legend>
          <label><span>Actual brand/item SKU</span><input list="product-identity-physical-options" value={form.physicalSku} onChange={(event) => update('physicalSku', event.target.value.toUpperCase())} onBlur={() => { const match = data.physicalSkus.find((item) => item.physical_sku === form.physicalSku.trim().toUpperCase()); if (match) choosePhysical(match); }} placeholder="Supplier or manufacturer SKU" autoCapitalize="characters" /></label>
          <datalist id="product-identity-physical-options">{data.physicalSkus.map((option) => <option key={option.physical_sku_id} value={option.physical_sku}>{option.product_name}</option>)}</datalist>
          <div className="product-identity-inline-fields">
            <label><span>Product name</span><input value={form.productName} onChange={(event) => update('productName', event.target.value)} placeholder="Product, size and material" /></label>
            <label><span>Brand / supplier</span><input value={form.brand} onChange={(event) => update('brand', event.target.value)} placeholder="Optional" /></label>
          </div>
          <div className="product-identity-field-hint">{physicalMatch ? `Existing Physical SKU · ${physicalMatch.family_name || 'Family not assigned'}` : 'A new Physical SKU will remain inside this batch until publication.'}</div>
        </fieldset>

        <fieldset className="product-identity-fieldset">
          <legend>4 · SKU Family</legend>
          <label><span>Family code</span><input list="product-identity-family-options" value={form.familyCode} onChange={(event) => update('familyCode', event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '-'))} onBlur={() => { const match = data.families.find((item) => item.family_code === form.familyCode.trim().toUpperCase()); if (match) chooseFamily(match); }} placeholder="e.g. GLOVE-NITRILE-M" autoCapitalize="characters" /></label>
          <datalist id="product-identity-family-options">{data.families.map((option) => <option key={option.family_id} value={option.family_code}>{option.family_name}</option>)}</datalist>
          <label><span>Family name</span><input value={form.familyName} onChange={(event) => update('familyName', event.target.value)} placeholder="Operationally equivalent product family" /></label>
          <div className="product-identity-field-hint">{familyMatch ? `Existing family · ${familyMatch.family_name}` : 'New family: products in this family may be considered substitutes only under the policy below.'}</div>
        </fieldset>

        <fieldset className="product-identity-fieldset product-identity-policy-fieldset">
          <legend>5 · Fulfilment policy</legend>
          <label><span>Substitution policy</span><select value={form.policy} onChange={(event) => update('policy', event.target.value as ProductIdentityPolicy)}><option value="ALLOWED">Allowed within family</option><option value="APPROVAL_REQUIRED">Approval required</option><option value="PROHIBITED">Prohibited</option></select></label>
          <label className="product-identity-check"><input type="checkbox" checked={form.preferred} disabled={form.policy === 'PROHIBITED'} onChange={(event) => update('preferred', event.target.checked)} /><span><strong>Preferred physical item</strong><small>Use this item first when available.</small></span></label>
          <label><span>Evidence note</span><textarea value={form.note} onChange={(event) => update('note', event.target.value)} placeholder="Supplier, package version, restriction or reason" maxLength={2000} /></label>
        </fieldset>
      </div>

      <section className="product-identity-impact-preview">
        <div><span>IMPACT PREVIEW</span><strong>{form.commercialSku || 'Commercial SKU'} → {form.physicalSku || 'Physical SKU'} → {form.familyCode || 'SKU Family'}</strong><p>{form.packageLevel} · {form.unitsPerBarcode || '0'} unit(s) · {displayStatus(form.policy)}{form.preferred ? ' · preferred' : ''}</p></div>
        <button className="product-identity-primary" type="button" disabled={busy || !valid} onClick={() => void save()}>{busy ? 'Saving safely…' : canApprove && form.policy === 'ALLOWED' ? 'Save and verify' : 'Save for review'}</button>
      </section>
      <WarehouseCameraScanner />
    </section>
  );
}

function BatchReview({
  items,
  role,
  onReload,
  onEdit,
}: {
  items: ProductIdentityBatchItem[];
  role: Role;
  onReload: (message?: string) => Promise<void>;
  onEdit: (item: ProductIdentityBatchItem) => void;
}) {
  const canApprove = role === 'owner' || role === 'admin';
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  async function review(item: ProductIdentityBatchItem, decision: 'APPROVE' | 'REJECT') {
    const note = notes[item.item_id]?.trim() || (decision === 'APPROVE' ? 'Physical evidence and fulfilment policy reviewed.' : 'Returned for correction.');
    setBusyId(item.item_id);
    setError('');
    try {
      await reviewProductIdentityItem({
        itemId: item.item_id,
        expectedItemRevision: number(item.item_revision),
        decision,
        note,
      });
      await onReload(`${item.barcode} ${decision === 'APPROVE' ? 'verified' : 'returned for correction'}.`);
    } catch (reason) {
      setError(productIdentityFriendlyError(reason));
    } finally {
      setBusyId('');
    }
  }

  return (
    <section className="product-identity-review" aria-labelledby="product-identity-review-title">
      <header className="product-identity-section-header"><div><span>OPEN BATCH</span><h2 id="product-identity-review-title">Captured relationships</h2><p>Persistent command results, conflicts and supervisor decisions.</p></div><strong>{items.length} item{items.length === 1 ? '' : 's'}</strong></header>
      {error ? <div className="product-identity-command-result error"><strong>Review failed</strong><span>{error}</span></div> : null}
      {!items.length ? <StateNotice title="Nothing captured yet" detail="Choose an unmapped SKU, scan its package and save the relationship." /> : null}
      <div className="product-identity-review-list">
        {items.map((item) => (
          <article key={item.item_id} className={`product-identity-review-card ${statusTone(item.item_state)}`}>
            <header><div><span className={`product-identity-status ${statusTone(item.item_state)}`}>{displayStatus(item.item_state)}</span><strong>{item.commercial_sku}</strong><small>{item.product_name}</small></div><button type="button" onClick={() => onEdit(item)}>Edit</button></header>
            <div className="product-identity-review-facts"><span><small>Barcode</small><strong>{item.barcode}</strong></span><span><small>Physical SKU</small><strong>{item.physical_sku}</strong></span><span><small>Family</small><strong>{item.family_code}</strong></span><span><small>Pack</small><strong>{item.package_level} × {number(item.units_per_barcode)}</strong></span><span><small>Policy</small><strong>{displayStatus(item.substitution_policy)}</strong></span></div>
            <ConflictPanel codes={item.conflict_codes || []} />
            {canApprove && item.item_state !== 'VERIFIED' && item.item_state !== 'CONFLICT' ? <div className="product-identity-review-actions"><textarea value={notes[item.item_id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [item.item_id]: event.target.value }))} placeholder="Supervisor review note" maxLength={2000} /><div><button type="button" disabled={busyId === item.item_id} onClick={() => void review(item, 'REJECT')}>Return</button><button className="product-identity-primary" type="button" disabled={busyId === item.item_id} onClick={() => void review(item, 'APPROVE')}>{busyId === item.item_id ? 'Applying…' : 'Verify item'}</button></div></div> : null}
            {item.review_note ? <footer>Reviewed {dateTime(item.reviewed_at)} · {item.review_note}</footer> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function SiteTaskList({
  tasks,
  onSelect,
}: {
  tasks: ProductIdentityTask[];
  onSelect: (task: ProductIdentityTask) => void;
}) {
  return (
    <section className="product-identity-tasks" aria-labelledby="product-identity-tasks-title">
      <header className="product-identity-section-header"><div><span>SITE TASK GENERATOR</span><h2 id="product-identity-tasks-title">Commercial SKU coverage</h2><p>Every remaining physical dependency is explicit. Warehouse staff do not need database IDs.</p></div><strong>{tasks.length} visible</strong></header>
      {!tasks.length ? <StateNotice title="No matching tasks" detail="The server query completed successfully and returned no records for this filter." /> : null}
      <div className="product-identity-task-table" role="region" aria-label="Product identity task list" tabIndex={0}>
        <table>
          <thead><tr><th>Status</th><th>Commercial SKU</th><th>Product</th><th>Physical SKU</th><th>SKU Family</th><th>Barcodes</th><th>Policy</th><th>Action</th></tr></thead>
          <tbody>{tasks.map((task) => <tr key={taskIdentity(task)}><td><span className={`product-identity-status ${statusTone(task.mapping_status)}`}>{displayStatus(task.mapping_status)}</span></td><td><strong>{task.commercial_sku}</strong></td><td>{task.product_name}</td><td>{task.physical_sku || '—'}</td><td>{task.family_code || '—'}</td><td>{number(task.verified_barcode_count)}</td><td>{displayStatus(task.substitution_policy)}</td><td><button type="button" onClick={() => onSelect(task)}>{task.mapping_status === 'PUBLISHED' ? 'Add barcode' : 'Configure'}</button></td></tr>)}</tbody>
        </table>
      </div>
      <div className="product-identity-task-cards">{tasks.map((task) => <article key={`mobile-${taskIdentity(task)}`}><header><span className={`product-identity-status ${statusTone(task.mapping_status)}`}>{displayStatus(task.mapping_status)}</span><strong>{task.commercial_sku}</strong></header><p>{task.product_name}</p><dl><div><dt>Physical</dt><dd>{task.physical_sku || 'Not selected'}</dd></div><div><dt>Family</dt><dd>{task.family_code || 'Not selected'}</dd></div><div><dt>Barcodes</dt><dd>{number(task.verified_barcode_count)}</dd></div></dl><button type="button" onClick={() => onSelect(task)}>{task.mapping_status === 'PUBLISHED' ? 'Add barcode' : 'Configure this SKU'}</button></article>)}</div>
    </section>
  );
}

function PublishDialog({
  data,
  open,
  onClose,
  onPublished,
}: {
  data: ProductIdentityWorkspaceData;
  open: boolean;
  onClose: () => void;
  onPublished: (message: string) => Promise<void>;
}) {
  const [note, setNote] = useState('All physical evidence, SKU families, packaging conversions and fulfilment policies have been reviewed.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!open) return null;

  async function publish() {
    if (!data.readiness.batch_id) return;
    setBusy(true);
    setError('');
    try {
      const result = await publishProductIdentityBatch({
        batchId: data.readiness.batch_id,
        expectedBatchRevision: number(data.readiness.batch_revision),
        note,
      });
      await onPublished(`${number(result.published_items)} product identity item(s) published atomically.`);
      onClose();
    } catch (reason) {
      setError(productIdentityFriendlyError(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="product-identity-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="product-identity-modal" role="dialog" aria-modal="true" aria-labelledby="product-identity-publish-title">
        <header><div><span>HIGH-IMPACT COMMAND</span><h2 id="product-identity-publish-title">Publish verified product identity</h2></div><button type="button" disabled={busy} onClick={onClose}>Close</button></header>
        <div className="product-identity-publish-summary"><strong>{number(data.readiness.verified_items)} verified batch item(s)</strong><span>{number(data.readiness.covered_commercial_skus)} / {number(data.readiness.total_commercial_skus)} Commercial SKUs covered</span><span>{number(data.readiness.conflict_items)} conflicts · {number(data.readiness.review_items)} awaiting review</span></div>
        <p>Publication updates Barcode, Physical SKU, SKU Family and fulfilment relationships in one transaction. It does not alter warehouse quantities.</p>
        <label><span>Publication acknowledgement</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} /></label>
        {error ? <div className="product-identity-command-result error"><strong>Publication blocked</strong><span>{error}</span></div> : null}
        <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="product-identity-primary" type="button" disabled={busy || !note.trim() || !data.readiness.publication_ready} onClick={() => void publish()}>{busy ? 'Publishing atomically…' : 'Publish verified batch'}</button></footer>
      </section>
    </div>
  );
}

export function ProductIdentityCommissioningWorkspace({ role, profile }: { role: Role; profile: EcoFlowAuthProfile }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';
  const [data, setData] = useState<ProductIdentityWorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState('');
  const [selectedTask, setSelectedTask] = useState<ProductIdentityTask | null>(null);
  const [selectedItem, setSelectedItem] = useState<ProductIdentityBatchItem | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const captureRef = useRef<HTMLDivElement | null>(null);
  const canPublish = role === 'owner' || role === 'admin';

  const load = useCallback(async (message?: string) => {
    setLoading(true);
    try {
      const next = await loadProductIdentityWorkspace({ search: search || undefined, state: status || undefined });
      setData(next);
      setError('');
      if (message) setOutcome(message);
    } catch (reason) {
      setError(productIdentityFriendlyError(reason));
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => { void load(); }, [load]);

  const filteredTasks = useMemo(() => data?.tasks ?? [], [data]);

  function updateQuery(key: 'search' | 'status', value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  function openTask(task: ProductIdentityTask) {
    setSelectedItem(null);
    setSelectedTask(task);
    window.setTimeout(() => captureRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20);
  }

  function openItem(item: ProductIdentityBatchItem) {
    setSelectedTask(null);
    setSelectedItem(item);
    window.setTimeout(() => captureRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 20);
  }

  if (loading && !data) return <StateNotice title="Loading Product Identity" detail="Reading the authoritative batch, catalogue coverage, family options and conflicts." />;
  if (error && !data) return <StateNotice title="Product Identity unavailable" detail={error} action={<button type="button" onClick={() => void load()}>Retry</button>} />;
  if (!data) return null;

  const readiness = data.readiness;
  const readinessPercent = Math.max(0, Math.min(100, number(readiness.readiness_percent)));

  return (
    <div className="product-identity-workspace" data-role={role}>
      <section className="product-identity-hero">
        <div className="product-identity-hero-copy"><span>PRODUCT IDENTITY AUTHORITY</span><h1>Commission the warehouse once. Operate from verified evidence.</h1><p>After engineering completion, the remaining site job is limited to scanning a package, choosing its SKU and Family, reviewing explicit conflicts and publishing the verified batch.</p><div className="product-identity-hero-meta"><span>{profile.display_name || profile.email}</span><span>{profile.app_role}</span><span>Batch revision {number(readiness.batch_revision)}</span><span>Updated {dateTime(readiness.latest_at)}</span></div></div>
        <div className="product-identity-readiness-dial" style={{ '--readiness': `${readinessPercent}%` } as React.CSSProperties}><div><strong>{readinessPercent.toFixed(1)}%</strong><span>ready</span></div></div>
      </section>

      <section className="product-identity-readiness-panel">
        <header><div><span>{readiness.batch_status || 'DRAFT'} BATCH</span><h2>{readiness.batch_name || 'Warehouse product identity commissioning'}</h2></div><div className="product-identity-readiness-actions"><button type="button" disabled={loading} onClick={() => void load()}>{loading ? 'Refreshing…' : 'Refresh server state'}</button>{canPublish ? <button className="product-identity-primary" type="button" disabled={!readiness.publication_ready} onClick={() => setPublishOpen(true)}>Publish verified batch</button> : null}</div></header>
        <div className="product-identity-progress"><span style={{ width: `${readinessPercent}%` }} /></div>
        <div className="product-identity-metrics"><MetricCard label="Commercial coverage" value={`${number(readiness.covered_commercial_skus)}/${number(readiness.total_commercial_skus)}`} detail={`${number(readiness.unmapped_commercial_skus)} still require site evidence`} tone={number(readiness.unmapped_commercial_skus) ? 'review' : 'ready'} /><MetricCard label="Verified barcodes" value={number(readiness.verified_barcodes)} detail={`${number(readiness.carton_barcodes)} carton · ${number(readiness.sleeve_barcodes)} sleeve · ${number(readiness.each_barcodes)} each`} /><MetricCard label="Physical SKUs" value={number(readiness.physical_skus)} detail={`${number(readiness.sku_families)} active SKU families`} /><MetricCard label="Blocking conflicts" value={number(readiness.conflict_items)} detail={`${number(readiness.review_items)} item(s) awaiting review`} tone={number(readiness.conflict_items) ? 'blocked' : number(readiness.review_items) ? 'review' : 'ready'} /></div>
        {!readiness.publication_ready ? <div className="product-identity-gate"><strong>Publication remains locked</strong><span>Reach full Commercial SKU coverage, verify every captured item and clear every blocking conflict.</span></div> : <div className="product-identity-gate ready"><strong>Publication gate passed</strong><span>The server confirms complete coverage and zero unresolved batch items.</span></div>}
      </section>

      {outcome ? <div className="product-identity-command-result success" role="status"><strong>Command completed</strong><span>{outcome}</span><button type="button" onClick={() => setOutcome('')}>Dismiss</button></div> : null}
      {error ? <div className="product-identity-command-result error" role="alert"><strong>Latest refresh failed</strong><span>{error}</span><button type="button" onClick={() => void load()}>Retry</button></div> : null}

      <section className="product-identity-toolbar" aria-label="Product identity task filters"><label><span>Search tasks</span><input value={search} onChange={(event) => updateQuery('search', event.target.value)} placeholder="SKU, product, physical item or family" /></label><label><span>Status</span><select value={status} onChange={(event) => updateQuery('status', event.target.value)}>{STATUS_FILTERS.map((item) => <option key={item || 'ALL'} value={item}>{item ? displayStatus(item) : 'All statuses'}</option>)}</select></label><button type="button" onClick={() => { setSearchParams({}, { replace: true }); }}>Clear filters</button></section>

      <div ref={captureRef}><CaptureWorkspace data={data} role={role} selectedTask={selectedTask} selectedItem={selectedItem} onSaved={async (message) => { setSelectedItem(null); setSelectedTask(null); await load(message); }} /></div>
      <BatchReview items={data.items} role={role} onReload={async (message) => { await load(message); }} onEdit={openItem} />
      <SiteTaskList tasks={filteredTasks} onSelect={openTask} />
      <PublishDialog data={data} open={publishOpen} onClose={() => setPublishOpen(false)} onPublished={async (message) => { await load(message); }} />
    </div>
  );
}
