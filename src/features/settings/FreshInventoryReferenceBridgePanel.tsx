import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export function FreshInventoryReferenceBridgePanel({ supabase }: { supabase: SupabaseClient }) {
  const [stage, setStage] = useState('NOT RUN');
  const [activate, setActivate] = useState('BLOCKED');

  async function runStage() {
    if (stage !== 'NOT RUN') return;
    if (!window.confirm(
      'R5-009 Phase A creates 428-row membership/reference evidence only. No provider traffic, stocktake, quantity or inventory authority. Continue once?',
    )) return;
    setStage('RUNNING');
    const { data, error } = await supabase.functions.invoke('stage-unleashed-inventory-reference', {
      body: { requestKey: 'ECOFLOW-R5-009A', confirm: true },
    });
    if (error || data?.ok !== true || data?.sourceRowCount !== 428 || data?.authorityEffect !== 'NONE') {
      setStage(`FAILED — ${error?.message ?? data?.error ?? 'contract violation'}`);
      return;
    }
    setStage('STAGED · 428 rows · authority NONE');
    const gate = await supabase.rpc('ecoflow_read_r5_009_fresh_reference_bridge_gate');
    setActivate(gate.error ? 'BLOCKED' : gate.data?.safeToActivate === true ? 'READY' : 'BLOCKED');
  }

  async function runActivate() {
    if (activate !== 'READY') return;
    if (!window.confirm(
      'R5-009 Phase B seals the fresh 1/1 reference and supersedes old 3/5 planning evidence only. Physical stocktake remains mandatory. Continue once?',
    )) return;
    setActivate('RUNNING');
    const { data, error } = await supabase.rpc('ecoflow_activate_r5_009_fresh_reference_bridge');
    if (error || data?.authorityEffect !== 'NONE' || data?.inventoryAuthorityCreated !== false) {
      setActivate(`FAILED — ${error?.message ?? 'contract violation'}`);
      return;
    }
    setActivate('ACTIVATED · inventory authority NONE');
  }

  return (
    <div className="unleashed-acceptance" id="unleashed-r5-009-reference-bridge">
      <div className="unleashed-acceptance-head">
        <div>
          <h3>R5-009 fresh reference bridge</h3>
          <span>428-row R5-008 evidence · fresh QtyOnHand 1/1 · physical stocktake still required</span>
        </div>
      </div>
      <p className="unleashed-acceptance-note">
        Phase A reconstructs/stages immutable evidence. Phase B separately supersedes the old 3/5 planning reference.
        Neither phase creates stocktake approval, warehouse quantity, movement or inventory authority.
      </p>
      <div className="unleashed-acceptance-summary">
        <span>Phase A <strong>{stage}</strong></span>
        <span>Phase B <strong>{activate}</strong></span>
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
