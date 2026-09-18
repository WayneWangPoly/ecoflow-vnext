import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  readR5006MappingPlanOnlyReconciliation,
  type R5006MappingPlanOnlyReconciliation,
} from '../team/unleashedMappingPlanOnly';

function tone(reconciliation: R5006MappingPlanOnlyReconciliation | null, error: string) {
  if (error) return 'danger';
  if (!reconciliation) return 'neutral';
  return reconciliation.accepted ? 'good' : 'warning';
}

export function MappingPlanOnlyPanel({ supabase }: { supabase: SupabaseClient }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reconciliation, setReconciliation] = useState<R5006MappingPlanOnlyReconciliation | null>(null);
  const [error, setError] = useState('');

  async function refreshReconciliation() {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      setReconciliation(await readR5006MappingPlanOnlyReconciliation(supabase));
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : String(readError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="unleashed-acceptance">
      <div className="unleashed-acceptance-head">
        <div>
          <h3>R5-006 产品映射收口</h3>
          <span>已接受 164 条唯一 ORDERMENTUM 精确映射 · 执行入口已关闭</span>
        </div>
        <b className={`pill pill-${tone(reconciliation, error)}`}>
          {loading ? '读取中' : reconciliation?.status ?? '未核验'}
        </b>
      </div>

      <p className="unleashed-acceptance-note">
        本模块现在仅用于只读核对已接受的生产结果。禁止再次执行 PLAN；不会调用供应商、
        不规划或复制图片、不创建 Physical Identity，也不会修改盘点或库存。
      </p>

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        disabled={loading}
      >
        {open ? '关闭 R5-006 收口核对' : '查看 R5-006 收口核对'}
      </button>

      {open ? (
        <>
          <div className="system-sync-actions unleashed-probe-actions">
            <button type="button" onClick={() => void refreshReconciliation()} disabled={loading}>
              {loading ? '核对中…' : '刷新只读核对'}
            </button>
          </div>

          {reconciliation ? (
            <div className="unleashed-acceptance-result" role="status">
              <div className="unleashed-acceptance-summary">
                <span>原冻结目标 <strong>{reconciliation.intendedFrozenCohortCount}</strong></span>
                <span>已接受精确映射 <strong>{reconciliation.acceptedExactMappingCount}</strong></span>
                <span>当前 reference 内 <strong>{reconciliation.acceptedReferenceCount}</strong></span>
                <span>reference 外 <strong>{reconciliation.acceptedOutsideReferenceCount}</strong></span>
                <span>code drift <strong>{reconciliation.acceptedCodeDriftReferenceCount}</strong></span>
                <span>不变量失败 <strong>{reconciliation.acceptedInvariantFailureCount}</strong></span>
              </div>

              <div className="unleashed-acceptance-summary">
                <span>待产品映射 <strong>{reconciliation.pendingProductMappingCount}</strong></span>
                <span>待 Physical Identity <strong>{reconciliation.pendingPhysicalIdentityCount}</strong></span>
                <span>可进入库位证据 <strong>{reconciliation.readyForLocationEvidenceCount}</strong></span>
              </div>

              <p className="unleashed-acceptance-note">
                失败 command：{reconciliation.failedCommandId}。成功执行审计：
                {reconciliation.audit.successAuditCount}；拒绝审计：
                {reconciliation.audit.rejectionCount}；本次 planner 审计：
                {reconciliation.audit.plannerAuditCount}。
              </p>

              <p className="unleashed-acceptance-note">
                状态为 ACCEPTED 仅表示已接受的 164 条精确 Product mapping 与当前 production
                数据一致，不代表库存、Physical Identity 或现场盘点已经完成。
              </p>
            </div>
          ) : null}

          {error ? <div className="error-message" role="alert">{error}</div> : null}

          <div className="unleashed-acceptance-note" role="note">
            <strong>执行已永久禁用：</strong>R5-006 不再提供 “Run mapping-only PLAN”。
            后续任何新增 mapping 必须使用新的、真正 bounded 的独立 authority。
          </div>
        </>
      ) : null}
    </div>
  );
}
