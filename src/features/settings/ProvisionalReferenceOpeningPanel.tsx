import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AlertTriangle, Database, RefreshCw } from 'lucide-react';
import {
  R5_007_PROVISIONAL_TARGETS,
  recordR5007ProvisionalReference,
  readR5007Gate,
  type R5007Gate,
  type R5007ProductCode,
} from '../team/provisionalReferenceOpening';

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ProvisionalReferenceOpeningPanel({ supabase }: { supabase: SupabaseClient }) {
  const codes = Object.keys(R5_007_PROVISIONAL_TARGETS) as R5007ProductCode[];
  const [open, setOpen] = useState(false);
  const [productCode, setProductCode] = useState<R5007ProductCode>('R-360Y');
  const [gate, setGate] = useState<R5007Gate | null>(null);
  const [reason, setReason] = useState('');
  const [ackReference, setAckReference] = useState(false);
  const [ackHold, setAckHold] = useState(false);
  const [ackCorrection, setAckCorrection] = useState(false);
  const [commandId, setCommandId] = useState<string | null>(null);
  const [running, setRunning] = useState('');
  const [error, setError] = useState('');

  const frozen = R5_007_PROVISIONAL_TARGETS[productCode];

  function reset(next?: R5007ProductCode) {
    if (next) setProductCode(next);
    setGate(null);
    setReason('');
    setAckReference(false);
    setAckHold(false);
    setAckCorrection(false);
    setCommandId(null);
    setError('');
  }

  async function refresh() {
    setRunning('refresh');
    setError('');
    try {
      setGate(await readR5007Gate(supabase, productCode));
    } catch (readError) {
      setError(errorText(readError));
    } finally {
      setRunning('');
    }
  }

  async function apply() {
    if (!ackReference || !ackHold || !ackCorrection || !reason.trim()) return;
    const id = commandId ?? crypto.randomUUID();
    setCommandId(id);
    setRunning('apply');
    setError('');
    try {
      setGate(await recordR5007ProvisionalReference(supabase, productCode, { commandId: id, reason }));
      setCommandId(null);
      setAckReference(false);
      setAckHold(false);
      setAckCorrection(false);
    } catch (applyError) {
      setError(errorText(applyError));
    } finally {
      setRunning('');
    }
  }

  const canApply = gate?.provisionalEligible === true
    && !gate.provisionalEvidenceId
    && gate.commissioningStatus === 'DRAFT'
    && gate.commissioningRevision === 0
    && reason.trim().length > 0
    && ackReference
    && ackHold
    && ackCorrection;

  return (
    <div className="unleashed-r5-canary-carrier">
      <button type="button" aria-expanded={open} aria-controls="r5-007-provisional-opening" onClick={() => setOpen((v) => !v)} disabled={Boolean(running)}>
        <Database aria-hidden="true" size={17} />
        {open ? '关闭 provisional reference' : 'R5-007 provisional reference'}
      </button>

      {open ? (
        <div className="unleashed-acceptance unleashed-r5-canary" id="r5-007-provisional-opening">
          <div className="unleashed-acceptance-head">
            <div>
              <h3>R5-007 provisional reference opening</h3>
              <span>搬仓期间的 immutable reference planning evidence · 不宣称现场实盘</span>
            </div>
            <b className={`pill pill-${error ? 'danger' : gate?.provisionalStatus ? 'good' : 'neutral'}`}>
              {running ? '执行中' : gate?.provisionalStatus ?? '未读取'}
            </b>
          </div>

          <div className="unleashed-acceptance-warning">
            <AlertTriangle aria-hidden="true" size={16} />
            这不是 physical stocktake，也不是 opening quantity mutation。系统只记录冻结的 Unleashed QtyOnHand 与 planned location 作为 provisional reference evidence；不会创建 warehouse quantity、inventory movement 或可用库存。
          </div>

          <label>
            SKU
            <select value={productCode} disabled={Boolean(running)} onChange={(event) => reset(event.target.value as R5007ProductCode)}>
              {codes.map((code) => (
                <option key={code} value={code}>
                  {code} · reference {R5_007_PROVISIONAL_TARGETS[code].sourceQtyOnHand} · planned {R5_007_PROVISIONAL_TARGETS[code].plannedLocationCode}
                </option>
              ))}
            </select>
          </label>

          <div className="unleashed-acceptance-summary">
            <span>Reference <strong>{frozen.sourceQtyOnHand} cartons</strong></span>
            <span>Planned location <strong>{frozen.plannedLocationCode}</strong></span>
            <span>Barcode <strong>{frozen.barcode}</strong></span>
            <span>Inventory mutation <strong>NONE</strong></span>
          </div>

          <button type="button" onClick={() => void refresh()} disabled={Boolean(running)}>
            <RefreshCw aria-hidden="true" size={16} />
            刷新生产门禁
          </button>

          {error ? <div className="error-message" role="alert">{error}</div> : null}

          {gate ? (
            <div className="unleashed-acceptance-result">
              <div className="unleashed-acceptance-summary">
                <span>Commissioning <strong>{gate.commissioningStatus} rev{gate.commissioningRevision}</strong></span>
                <span>Eligible <strong>{gate.provisionalEligible ? 'YES' : 'NO'}</strong></span>
                <span>Existing movements <strong>{gate.existingInventoryMovements}</strong></span>
                <span>Physical count claimed <strong>NO</strong></span>
              </div>

              {gate.provisionalStatus === 'PROVISIONAL_REFERENCE' ? (
                <div className="unleashed-acceptance-warning" role="status">
                  Provisional reference 已建立：{gate.provisionalQuantity} cartons / planned {gate.plannedLocationCode}。这只是迁移规划证据，warehouse quantity 与 inventory movements 仍保持零；后续现场 stocktake 才能创建库存 authority。
                </div>
              ) : null}

              {gate.provisionalStatus === 'RECONCILED' ? (
                <div className="unleashed-acceptance-result" role="status">
                  后续真实 stocktake 已审批，provisional baseline 已标记 RECONCILED。
                </div>
              ) : null}

              {!gate.provisionalEvidenceId ? (
                <>
                  <label>
                    执行原因
                    <textarea
                      value={reason}
                      onChange={(event) => {
                        setReason(event.target.value);
                        setCommandId(null);
                      }}
                      placeholder="例如：ADL1 relocation in progress; record immutable Unleashed reference + planned location as evidence only; await field stocktake."
                    />
                  </label>

                  <label className="unleashed-acceptance-confirm">
                    <input type="checkbox" checked={ackReference} onChange={(event) => setAckReference(event.target.checked)} />
                    <span>我确认 {frozen.sourceQtyOnHand} 是 immutable Unleashed reference，不是现场实盘。</span>
                  </label>
                  <label className="unleashed-acceptance-confirm">
                    <input type="checkbox" checked={ackHold} onChange={(event) => setAckHold(event.target.checked)} />
                    <span>我确认 planned location {frozen.plannedLocationCode} 仅作为迁移规划证据记录；本动作不写 warehouse quantity 或 inventory movement。</span>
                  </label>
                  <label className="unleashed-acceptance-confirm">
                    <input type="checkbox" checked={ackCorrection} onChange={(event) => setAckCorrection(event.target.checked)} />
                    <span>我确认后续真实 stocktake 必须重新提供真实 location 与 counted cartons；reference evidence 不能替代现场盘点，也不能直接变成库存数量。</span>
                  </label>

                  <button type="button" className="primary" disabled={Boolean(running) || !canApply} onClick={() => void apply()}>
                    <Database aria-hidden="true" size={16} />
                    {commandId ? '重试同一 provisional command' : '记录 provisional reference evidence'}
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
