import { useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ClipboardCheck, MapPin, PackageCheck, Play, RefreshCw } from 'lucide-react';
import {
  R5_005B_EXECUTABLE_CANDIDATES,
  R5_005B_ZERO_STOCK_HOLD,
  finalizeR5005B,
  materializeR5005B,
  readR5005BGate,
  recordR5005BLocation,
  startR5005B,
  type R5005BGate,
  type R5005BProductCode,
} from '../team/readyPositiveStockCommissioning';

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ReadyPositiveStockCommissioningPanel({ supabase }: { supabase: SupabaseClient }) {
  const productCodes = Object.keys(R5_005B_EXECUTABLE_CANDIDATES) as R5005BProductCode[];
  const [open, setOpen] = useState(false);
  const [productCode, setProductCode] = useState<R5005BProductCode>('R-360Y');
  const [gate, setGate] = useState<R5005BGate | null>(null);
  const [running, setRunning] = useState('');
  const [error, setError] = useState('');
  const [startAck, setStartAck] = useState(false);
  const [startCommandId, setStartCommandId] = useState<string | null>(null);
  const [locationCode, setLocationCode] = useState('');
  const [referenceAllocatedQty, setReferenceAllocatedQty] = useState('');
  const [countedQty, setCountedQty] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [locationCommandId, setLocationCommandId] = useState<string | null>(null);
  const [acceptVariance, setAcceptVariance] = useState(false);
  const [varianceReason, setVarianceReason] = useState('');
  const [finalizeCommandId, setFinalizeCommandId] = useState<string | null>(null);
  const [materializeAck, setMaterializeAck] = useState(false);
  const [materializeCommandId, setMaterializeCommandId] = useState<string | null>(null);

  const frozen = R5_005B_EXECUTABLE_CANDIDATES[productCode];
  const referenceTotal = useMemo(() => gate?.locations.reduce((sum, item) => sum + item.referenceAllocatedQty, 0) ?? 0, [gate]);
  const physicalTotal = useMemo(() => gate?.locations.reduce((sum, item) => sum + item.countedQty, 0) ?? 0, [gate]);
  const hasVariance = physicalTotal !== frozen.sourceQtyOnHand;

  function resetTransient(nextCode?: R5005BProductCode) {
    if (nextCode) setProductCode(nextCode);
    setGate(null);
    setError('');
    setStartAck(false);
    setStartCommandId(null);
    setLocationCode('');
    setReferenceAllocatedQty('');
    setCountedQty('');
    setEvidenceNote('');
    setLocationCommandId(null);
    setAcceptVariance(false);
    setVarianceReason('');
    setFinalizeCommandId(null);
    setMaterializeAck(false);
    setMaterializeCommandId(null);
  }

  async function refresh() {
    setRunning('refresh');
    setError('');
    try {
      setGate(await readR5005BGate(supabase, productCode));
    } catch (readError) {
      setError(errorText(readError));
    } finally {
      setRunning('');
    }
  }

  async function start() {
    if (!startAck) return;
    const commandId = startCommandId ?? crypto.randomUUID();
    setStartCommandId(commandId);
    setRunning('start');
    setError('');
    try {
      setGate(await startR5005B(supabase, productCode, commandId));
      setStartAck(false);
      setStartCommandId(null);
    } catch (startError) {
      setError(errorText(startError));
    } finally {
      setRunning('');
    }
  }

  function changeLocationField(setter: (value: string) => void, value: string) {
    setter(value);
    setLocationCommandId(null);
  }

  async function recordLocation() {
    if (!gate?.commissioningId) return;
    const commandId = locationCommandId ?? crypto.randomUUID();
    setLocationCommandId(commandId);
    setRunning('location');
    setError('');
    try {
      setGate(await recordR5005BLocation(supabase, productCode, gate.commissioningId, {
        locationCode,
        referenceAllocatedQty: Number(referenceAllocatedQty),
        countedQty: Number(countedQty),
        evidenceNote,
        commandId,
      }));
      setLocationCode('');
      setReferenceAllocatedQty('');
      setCountedQty('');
      setEvidenceNote('');
      setLocationCommandId(null);
    } catch (locationError) {
      setError(errorText(locationError));
    } finally {
      setRunning('');
    }
  }

  async function finalize() {
    if (!gate?.commissioningId) return;
    const commandId = finalizeCommandId ?? crypto.randomUUID();
    setFinalizeCommandId(commandId);
    setRunning('finalize');
    setError('');
    try {
      setGate(await finalizeR5005B(
        supabase,
        productCode,
        gate.commissioningId,
        acceptVariance,
        varianceReason,
        commandId,
      ));
      setFinalizeCommandId(null);
    } catch (finalizeError) {
      setError(errorText(finalizeError));
    } finally {
      setRunning('');
    }
  }

  async function materialize() {
    if (!gate?.commissioningId || !materializeAck) return;
    const commandId = materializeCommandId ?? crypto.randomUUID();
    setMaterializeCommandId(commandId);
    setRunning('materialize');
    setError('');
    try {
      setGate(await materializeR5005B(supabase, productCode, gate.commissioningId, commandId));
      setMaterializeAck(false);
      setMaterializeCommandId(null);
    } catch (materializeError) {
      setError(errorText(materializeError));
    } finally {
      setRunning('');
    }
  }

  const locationReady = locationCode.trim().length > 0
    && Number.isInteger(Number(referenceAllocatedQty))
    && Number(referenceAllocatedQty) >= 0
    && Number.isInteger(Number(countedQty))
    && Number(countedQty) >= 0
    && evidenceNote.trim().length > 0;
  const finalizeReady = gate?.commissioningStatus === 'DRAFT'
    && gate.locations.length > 0
    && referenceTotal === frozen.sourceQtyOnHand
    && (!hasVariance || (acceptVariance && varianceReason.trim().length > 0));

  return (
    <div className="unleashed-r5-canary-carrier">
      <button type="button" aria-expanded={open} aria-controls="unleashed-r5-005b-ready" onClick={() => setOpen((current) => !current)} disabled={Boolean(running)}>
        <ClipboardCheck aria-hidden="true" size={17} />
        {open ? '关闭 READY 库存建账' : 'R5-005B READY 库存建账'}
      </button>

      {open ? (
        <div className="unleashed-acceptance unleashed-r5-canary" id="unleashed-r5-005b-ready">
          <div className="unleashed-acceptance-head">
            <div>
              <h3>R5-005B 正库存 READY SKU 建账</h3>
              <span>真实仓位与实盘证据 · 最多生成 INITIAL / REVIEW · 本页面无审批按钮</span>
            </div>
            <b className={`pill pill-${error ? 'danger' : gate ? 'good' : 'neutral'}`}>
              {running ? '执行中' : gate?.commissioningStatus ?? '未读取'}
            </b>
          </div>

          <div className="unleashed-acceptance-warning">
            {R5_005B_ZERO_STOCK_HOLD.sourceProductCode} 的 Unleashed reference 为 0，当前保持 ZERO-STOCK HOLD；不得为它虚构仓位证据。
          </div>

          <label>
            待处理 SKU
            <select value={productCode} disabled={Boolean(running) || Boolean(gate?.commissioningId)} onChange={(event) => resetTransient(event.target.value as R5005BProductCode)}>
              {productCodes.map((code) => (
                <option key={code} value={code}>{code} · reference {R5_005B_EXECUTABLE_CANDIDATES[code].sourceQtyOnHand} cartons</option>
              ))}
            </select>
          </label>

          <div className="unleashed-acceptance-summary">
            <span>SKU <strong>{productCode}</strong></span>
            <span>Reference <strong>{frozen.sourceQtyOnHand} cartons</strong></span>
            <span>Barcode <strong>{frozen.barcode}</strong></span>
            <span>Authority <strong>{gate?.inventoryAuthorityCreated ? '已创建' : '未创建'}</strong></span>
          </div>

          <button type="button" onClick={() => void refresh()} disabled={Boolean(running)}>
            <RefreshCw aria-hidden="true" size={16} />
            刷新生产门禁
          </button>

          {error ? <div className="error-message" role="alert">{error}</div> : null}

          {gate && !gate.commissioningId ? (
            <div className="unleashed-acceptance-result">
              <p className="unleashed-acceptance-note">
                START 只创建 commissioning provenance，不创建库存 authority。开始前必须确认当前仍是最新 SEALED reference 且 startEligible=true。
              </p>
              <label className="unleashed-acceptance-confirm">
                <input type="checkbox" checked={startAck} onChange={(event) => setStartAck(event.target.checked)} disabled={!gate.startEligible || Boolean(running)} />
                <span>我确认仅启动 {productCode} 的受控 commissioning，不写入最终库存。</span>
              </label>
              <button type="button" className="primary" disabled={Boolean(running) || !gate.startEligible || !startAck} onClick={() => void start()}>
                <Play aria-hidden="true" size={16} />
                {startCommandId ? '重试同一 START command' : '开始 commissioning'}
              </button>
            </div>
          ) : null}

          {gate?.commissioningStatus === 'DRAFT' ? (
            <div className="unleashed-acceptance-result">
              <h4>记录真实仓位与实盘</h4>
              <p className="unleashed-acceptance-note">
                Reference allocation across all locations must total {frozen.sourceQtyOnHand}. Counted quantity 必须来自现场实盘，不得从系统数字反推。
              </p>
              <label>仓位代码<input value={locationCode} onChange={(event) => changeLocationField(setLocationCode, event.target.value)} placeholder="例如 A2-03-02B" /></label>
              <label>Reference 分配数量<input type="number" min="0" step="1" value={referenceAllocatedQty} onChange={(event) => changeLocationField(setReferenceAllocatedQty, event.target.value)} /></label>
              <label>现场实盘 cartons<input type="number" min="0" step="1" value={countedQty} onChange={(event) => changeLocationField(setCountedQty, event.target.value)} /></label>
              <label>现场证据说明<textarea value={evidenceNote} onChange={(event) => changeLocationField(setEvidenceNote, event.target.value)} placeholder="谁、何时、在什么仓位核对了该 SKU 和数量" /></label>
              <button type="button" disabled={Boolean(running) || !locationReady} onClick={() => void recordLocation()}>
                <MapPin aria-hidden="true" size={16} />
                {locationCommandId ? '重试同一仓位 command' : '记录仓位证据'}
              </button>

              {gate.locations.length > 0 ? (
                <ul className="unleashed-acceptance-scope">
                  {gate.locations.map((location) => (
                    <li key={location.locationId}>{location.locationCode}: reference {location.referenceAllocatedQty}, counted {location.countedQty} — {location.evidenceNote}</li>
                  ))}
                </ul>
              ) : null}

              <div className="unleashed-acceptance-summary">
                <span>Reference 已分配 <strong>{referenceTotal} / {frozen.sourceQtyOnHand}</strong></span>
                <span>现场实盘 <strong>{physicalTotal}</strong></span>
                <span>差异 <strong>{physicalTotal - frozen.sourceQtyOnHand}</strong></span>
              </div>

              {hasVariance ? (
                <>
                  <label className="unleashed-acceptance-confirm">
                    <input type="checkbox" checked={acceptVariance} onChange={(event) => setAcceptVariance(event.target.checked)} />
                    <span>我明确接受现场实盘与 immutable Unleashed reference 的差异。</span>
                  </label>
                  <label>差异原因<textarea value={varianceReason} onChange={(event) => setVarianceReason(event.target.value)} /></label>
                </>
              ) : null}

              <button type="button" disabled={Boolean(running) || !finalizeReady} onClick={() => void finalize()}>
                <ClipboardCheck aria-hidden="true" size={16} />
                {finalizeCommandId ? '重试同一 FINALIZE command' : '冻结现场证据'}
              </button>
            </div>
          ) : null}

          {gate?.commissioningStatus === 'FINALIZED' ? (
            <div className="unleashed-acceptance-result">
              <h4>生成 INITIAL stocktake 到 REVIEW</h4>
              <p className="unleashed-acceptance-note">此动作只把冻结证据 materialize 为 REVIEW。最终 APPROVE 仍是独立库存 authority gate。</p>
              <label className="unleashed-acceptance-confirm">
                <input type="checkbox" checked={materializeAck} onChange={(event) => setMaterializeAck(event.target.checked)} />
                <span>我确认只生成 REVIEW，不在本页面批准库存。</span>
              </label>
              <button type="button" className="primary" disabled={Boolean(running) || !materializeAck} onClick={() => void materialize()}>
                <PackageCheck aria-hidden="true" size={16} />
                {materializeCommandId ? '重试同一 MATERIALIZE command' : '生成 INITIAL / REVIEW'}
              </button>
            </div>
          ) : null}

          {gate?.commissioningStatus === 'MATERIALIZED' ? (
            <div className="unleashed-acceptance-result" role="status">
              <h4>已生成 REVIEW — 在审批前停止</h4>
              <div className="unleashed-acceptance-summary">
                <span>Stocktake session <strong>{gate.stocktakeSessionId ?? 'missing'}</strong></span>
                <span>状态 <strong>{gate.stocktakeSessionStatus ?? 'missing'}</strong></span>
                <span>实盘 <strong>{gate.countedQtyTotal}</strong></span>
                <span>库存 authority <strong>未创建</strong></span>
              </div>
              <div className="unleashed-acceptance-warning">本页面没有 APPROVE 控件。Owner/Admin 审批必须作为独立授权执行。</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
