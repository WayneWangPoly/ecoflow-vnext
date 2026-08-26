import { useEffect, useMemo, useState } from 'react';
import type { Role } from '@/domain/types';
import {
  commissionFirstSeenBarcode,
  readFirstSeenReference,
  resolveFirstSeenBarcode,
  type FirstSeenReference,
} from '@/data/repositories/warehouseFirstSeenCommissioning';
import type { OperationalBarcodeResolution } from '@/data/repositories/productIdentityBarcodeResolution';
import './warehouseFirstSeenCommissioning.css';

const emptyReference: FirstSeenReference = { commercialSkus: [], families: [], physicalSkus: [], locations: [] };

function commandId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function WarehouseFirstSeenCommissioningPanel({ role }: { role: Role }) {
  const [reference, setReference] = useState<FirstSeenReference>(emptyReference);
  const [barcode, setBarcode] = useState('');
  const [resolution, setResolution] = useState<OperationalBarcodeResolution | null>(null);
  const [commercialSku, setCommercialSku] = useState('');
  const [physicalSku, setPhysicalSku] = useState('');
  const [physicalName, setPhysicalName] = useState('');
  const [brand, setBrand] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [familyCode, setFamilyCode] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [packageLevel, setPackageLevel] = useState<'CARTON' | 'SLEEVE' | 'INNER' | 'EACH' | 'PALLET'>('CARTON');
  const [units, setUnits] = useState('');
  const [policy, setPolicy] = useState<'ALLOWED' | 'APPROVAL_REQUIRED' | 'PROHIBITED'>('PROHIBITED');
  const [isPreferred, setIsPreferred] = useState(true);
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const canOperate = ['warehouse', 'admin', 'owner'].includes(String(role).toLowerCase());

  useEffect(() => {
    if (!canOperate) return;
    void readFirstSeenReference()
      .then(setReference)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load warehouse setup reference.'));
  }, [canOperate]);

  const selectedCommercial = useMemo(() => reference.commercialSkus.find((item) =>
    item.skuCode.toLowerCase() === commercialSku.trim().toLowerCase()
    || item.ordermentumSku?.toLowerCase() === commercialSku.trim().toLowerCase()), [reference.commercialSkus, commercialSku]);

  useEffect(() => {
    if (!selectedCommercial) return;
    if (selectedCommercial.familyCode) {
      setFamilyCode(selectedCommercial.familyCode);
      setFamilyName(selectedCommercial.familyName || selectedCommercial.familyCode);
    }
    if (selectedCommercial.substitutionPolicy && ['ALLOWED', 'APPROVAL_REQUIRED', 'PROHIBITED'].includes(selectedCommercial.substitutionPolicy)) {
      setPolicy(selectedCommercial.substitutionPolicy as typeof policy);
    }
    if (selectedCommercial.fixedShelf) setLocation(selectedCommercial.fixedShelf);
  }, [selectedCommercial]);

  const selectedFamily = useMemo(() => reference.families.find((item) =>
    item.familyCode.toLowerCase() === familyCode.trim().toLowerCase()), [reference.families, familyCode]);
  useEffect(() => {
    if (selectedFamily) setFamilyName(selectedFamily.familyName);
  }, [selectedFamily]);

  const selectedPhysical = useMemo(() => reference.physicalSkus.find((item) =>
    item.physicalSkuCode.toLowerCase() === physicalSku.trim().toLowerCase()), [reference.physicalSkus, physicalSku]);
  useEffect(() => {
    if (!selectedPhysical) return;
    setPhysicalName(selectedPhysical.name);
    setBrand(selectedPhysical.brand || '');
    setSupplierName(selectedPhysical.supplierName || '');
    setFamilyCode(selectedPhysical.familyCode);
    setFamilyName(selectedPhysical.familyName);
  }, [selectedPhysical]);

  if (!canOperate) return null;

  async function resolveBarcode() {
    const normalized = barcode.trim();
    if (!normalized) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await resolveFirstSeenBarcode(normalized);
      setResolution(result);
      if (result.resolutionStatus === 'RESOLVED') {
        setMessage(`Known barcode: ${result.physicalName || result.physicalSkuCode} → ${result.commercialSkuCode}${result.familyCode ? ` · Family ${result.familyCode}` : ''}`);
      } else if (result.resolutionStatus === 'UNKNOWN') {
        setMessage('New barcode. Set up the physical product below; no stock quantity changes until you continue the warehouse operation.');
      } else {
        setMessage(`Barcode status: ${result.resolutionStatus}. This code cannot be first-seen commissioned here.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Barcode lookup failed.');
    } finally { setBusy(false); }
  }

  async function activate() {
    if (resolution?.resolutionStatus !== 'UNKNOWN') return;
    const quantity = Number(units);
    if (!commercialSku.trim() || !physicalSku.trim() || !physicalName.trim() || !familyCode.trim() || !familyName.trim()) {
      setError('Commercial SKU, Physical SKU, Physical name and Family are required.'); return;
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) { setError('Units/package must be a whole number greater than zero.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      await commissionFirstSeenBarcode({
        commandId: commandId(), barcode: barcode.trim(), commercialSkuCode: commercialSku.trim(),
        physicalSkuCode: physicalSku.trim(), physicalName: physicalName.trim(), brand, supplierName,
        familyCode: familyCode.trim(), familyName: familyName.trim(), packageLevel,
        unitsInBaseUnit: quantity, substitutionPolicy: policy, isPreferred,
        defaultLocationCode: location || null, note,
      });
      const verified = await resolveFirstSeenBarcode(barcode.trim(), selectedCommercial?.skuCode || commercialSku.trim());
      setResolution(verified);
      if (verified.resolutionStatus !== 'RESOLVED') throw new Error(`Activation post-check returned ${verified.resolutionStatus}.`);
      setMessage(`Activated: ${verified.physicalName || verified.physicalSkuCode} → ${verified.commercialSkuCode}. This barcode is now canonical for Receiving, Stocktake and Pick.`);
      setReference(await readFirstSeenReference());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'First-seen setup failed.');
    } finally { setBusy(false); }
  }

  function startNext() {
    setBarcode(''); setResolution(null); setCommercialSku(''); setPhysicalSku(''); setPhysicalName('');
    setBrand(''); setSupplierName(''); setFamilyCode(''); setFamilyName(''); setPackageLevel('CARTON');
    setUnits(''); setPolicy('PROHIBITED'); setIsPreferred(true); setLocation(''); setNote(''); setMessage(''); setError('');
  }

  const unknown = resolution?.resolutionStatus === 'UNKNOWN';

  return (
    <section className="first-seen-card" aria-label="First-seen barcode setup">
      <div className="first-seen-heading">
        <div><span className="first-seen-kicker">LIVE WAREHOUSE</span><h2>Scan → identify → continue</h2></div>
        <span className="first-seen-safe">First-seen only</span>
      </div>
      <p className="first-seen-intro">Known barcodes pass straight through. If a code is new, warehouse staff can establish its Physical SKU, Family, package and shelf here. Existing canonical identity cannot be overwritten.</p>

      <div className="first-seen-scan-row">
        <label><span>Barcode</span><input inputMode="numeric" autoComplete="off" value={barcode} onChange={(event) => { setBarcode(event.target.value); setResolution(null); setMessage(''); }} onKeyDown={(event) => { if (event.key === 'Enter') void resolveBarcode(); }} placeholder="Scan or type barcode" /></label>
        <button type="button" disabled={busy || !barcode.trim()} onClick={() => void resolveBarcode()}>{busy ? 'Checking…' : 'Check barcode'}</button>
      </div>

      {message ? <div className="first-seen-message" role="status">{message}</div> : null}
      {error ? <div className="first-seen-error" role="alert">{error}</div> : null}

      {resolution && resolution.resolutionStatus === 'RESOLVED' ? (
        <div className="first-seen-resolved">
          <strong>✓ Canonical identity ready</strong>
          <span>{resolution.commercialSkuCode} · {resolution.physicalSkuCode} · {resolution.packageLevel} × {resolution.unitsInBaseUnit}</span>
          <button type="button" onClick={startNext}>Scan next</button>
        </div>
      ) : null}

      {unknown ? (
        <div className="first-seen-form">
          <div className="first-seen-step"><b>1</b><span>What Commercial SKU is this delivery/stock item for?</span></div>
          <label className="wide"><span>Commercial SKU / Ordermentum SKU</span><input list="first-seen-commercial" value={commercialSku} onChange={(event) => setCommercialSku(event.target.value)} placeholder="Search by SKU code" /></label>
          <datalist id="first-seen-commercial">{reference.commercialSkus.map((item) => <option key={item.skuCode} value={item.skuCode}>{item.name}{item.ordermentumSku ? ` · OM ${item.ordermentumSku}` : ''}</option>)}</datalist>
          {selectedCommercial ? <div className="first-seen-context"><strong>{selectedCommercial.name}</strong>{selectedCommercial.familyCode ? <span>Existing contract: Family {selectedCommercial.familyCode} · {selectedCommercial.preferredPhysicalSkuCode || 'preferred physical not shown'}</span> : <span>No canonical Family yet — warehouse can establish it now.</span>}</div> : null}

          <div className="first-seen-step"><b>2</b><span>What physical product and Family is in front of you?</span></div>
          <div className="first-seen-grid">
            <label><span>Physical SKU code</span><input list="first-seen-physical" value={physicalSku} onChange={(event) => setPhysicalSku(event.target.value)} placeholder="Existing or new code" /></label>
            <label><span>Physical product name</span><input value={physicalName} onChange={(event) => setPhysicalName(event.target.value)} /></label>
            <label><span>Family code</span><input list="first-seen-families" value={familyCode} onChange={(event) => setFamilyCode(event.target.value)} placeholder="Existing or new Family" /></label>
            <label><span>Family name</span><input value={familyName} onChange={(event) => setFamilyName(event.target.value)} /></label>
            <label><span>Brand (optional)</span><input value={brand} onChange={(event) => setBrand(event.target.value)} /></label>
            <label><span>Supplier (optional)</span><input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} /></label>
          </div>
          <datalist id="first-seen-families">{reference.families.map((item) => <option key={item.familyCode} value={item.familyCode}>{item.familyName}</option>)}</datalist>
          <datalist id="first-seen-physical">{reference.physicalSkus.map((item) => <option key={item.physicalSkuCode} value={item.physicalSkuCode}>{item.name} · Family {item.familyCode}</option>)}</datalist>

          <div className="first-seen-step"><b>3</b><span>Confirm the package you scanned.</span></div>
          <div className="first-seen-grid compact">
            <label><span>Package level</span><select value={packageLevel} onChange={(event) => setPackageLevel(event.target.value as typeof packageLevel)}><option>CARTON</option><option>SLEEVE</option><option>INNER</option><option>EACH</option><option>PALLET</option></select></label>
            <label><span>Units in base unit</span><input inputMode="numeric" value={units} onChange={(event) => setUnits(event.target.value)} placeholder="e.g. 500" /></label>
            <label><span>Substitution</span><select value={policy} onChange={(event) => setPolicy(event.target.value as typeof policy)}><option value="PROHIBITED">Do not substitute</option><option value="APPROVAL_REQUIRED">Approval required</option><option value="ALLOWED">Family substitution allowed</option></select></label>
            <label><span>Default shelf (optional)</span><input list="first-seen-locations" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Scan/select location" /></label>
          </div>
          <datalist id="first-seen-locations">{reference.locations.map((item) => <option key={item.locationCode} value={item.locationCode}>{item.rackTitle} · {item.displayLevel}</option>)}</datalist>
          <label className="first-seen-check"><input type="checkbox" checked={isPreferred} onChange={(event) => setIsPreferred(event.target.checked)} />This is the preferred Physical SKU for this Commercial SKU</label>
          <label className="wide"><span>Note (optional)</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="What did you verify on the carton?" /></label>

          <div className="first-seen-guard">This action creates a canonical first-seen identity. It does <strong>not</strong> change stock quantity. If a barcode, Family, Physical SKU, package conversion or Commercial contract already conflicts, the server blocks the change instead of guessing.</div>
          <button className="first-seen-activate" type="button" disabled={busy} onClick={() => void activate()}>{busy ? 'Activating…' : 'Confirm identity & activate barcode'}</button>
        </div>
      ) : null}
    </section>
  );
}
