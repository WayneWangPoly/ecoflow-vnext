import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export function FreshInventoryReferenceBridgePanel({ supabase }: { supabase: SupabaseClient }) {
  const [stage, setStage] = useState('CHECKING');
  const [activate, setActivate] = useState('CHECKING');

  useEffect(() => {
    let live = true;
    void supabase.rpc('ecoflow_read_r5_009_fresh_reference_bridge_gate').then(({ data, error }) => {
      if (!live) return;
      if (error) {
        setStage('UNKNOWN');
        setActivate('BLOCKED');
        return;
      }
      const status = data?.freshBatchStatus;
      setStage(status === 'STAGED' || status === 'SEALED' ? status : 'NOT RUN');
      setActivate(
        data?.safeToActivate === true
          ? 'READY'
          : status === 'SEALED'
            ? 'ACTIVATED'
            : 'BLOCKED',
      );
    });
    return () => { live = false; };
  }, [supabase]);

  async function runStage() {
    if (stage !== 'NOT RUN') return;
    if (!window.confirm('R5-009 A: stage 428-row evidence only; no inventory authority. Continue once?')) return;
    setStage('RUNNING');
    const { data, error } = await supabase.functions.invoke('stage-unleashed-inventory-reference', {
      body: { requestKey: 'ECOFLOW-R5-009A', confirm: true },
    });
    if (error || data?.ok !== true || data?.sourceRowCount !== 428 || data?.authorityEffect !== 'NONE') {
      setStage(`FAILED — ${error?.message ?? data?.error ?? 'contract violation'}`);
      return;
    }
    setStage('STAGED');
    const gate = await supabase.rpc('ecoflow_read_r5_009_fresh_reference_bridge_gate');
    setActivate(gate.error ? 'BLOCKED' : gate.data?.safeToActivate === true ? 'READY' : 'BLOCKED');
  }

  async function runActivate() {
    if (activate !== 'READY') return;
    if (!window.confirm('R5-009 B: seal fresh 1/1, supersede old 3/5; stocktake still required. Continue once?')) return;
    setActivate('RUNNING');
    const { data, error } = await supabase.rpc('ecoflow_activate_r5_009_fresh_reference_bridge');
    if (error || data?.authorityEffect !== 'NONE' || data?.inventoryAuthorityCreated !== false) {
      setActivate(`FAILED — ${error?.message ?? 'contract violation'}`);
      return;
    }
    setStage('SEALED');
    setActivate('ACTIVATED');
  }

  return (
    <div className="unleashed-acceptance" id="unleashed-r5-009-reference-bridge">
      <div className="unleashed-acceptance-head">
        <div>
          <h3>R5-009 fresh reference bridge</h3>
          <span>428-row R5-008 evidence · fresh 1/1 · stocktake required</span>
        </div>
      </div>
      <button type="button" onClick={() => void runStage()} disabled={stage !== 'NOT RUN'}>
        {stage === 'NOT RUN' ? 'Phase A · stage fresh reference once' : stage}
      </button>
      <button type="button" onClick={() => void runActivate()} disabled={activate !== 'READY'}>
        {activate === 'READY' ? 'Phase B · activate fresh reference once' : activate}
      </button>
    </div>
  );
}
