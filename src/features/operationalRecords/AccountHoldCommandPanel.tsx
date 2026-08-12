import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { EcoFlowAppRole } from '@/features/auth/authTypes';
import {
  readAccountHoldState,
  setAccountReleaseHold,
  type AccountHoldState,
} from '@/data/repositories/accountHoldAuthority';
import { getOperationalDeviceId } from '@/operational/operationalDeviceIdentity';
import './AccountHoldCommandPanel.css';

const COMMAND_ROLES = new Set<EcoFlowAppRole>(['OWNER', 'ADMIN', 'ACCOUNT']);

type RetryIntent = {
  idempotencyKey: string;
  targetActive: boolean;
  expectedRevision: number;
  reason: string;
};

function commandId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function timestamp(value: string | null) {
  if (!value || Number.isNaN(Date.parse(value))) return 'Never';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Adelaide',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function AccountHoldCommandPanel({
  storeId,
  role,
  onAuthorityChanged,
}: {
  storeId: string;
  role: EcoFlowAppRole;
  onAuthorityChanged: () => void;
}) {
  const canCommand = COMMAND_ROLES.has(role);
  const [state, setState] = useState<AccountHoldState | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(canCommand);
  const [pending, setPending] = useState(false);
  const [retryIntent, setRetryIntent] = useState<RetryIntent | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!canCommand) return;
    setLoading(true);
    setError('');
    try {
      setState(await readAccountHoldState(storeId));
    } catch (loadError) {
      setState(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [canCommand, storeId]);

  useEffect(() => {
    setReason('');
    setRetryIntent(null);
    setNotice('');
    void load();
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!state || pending) return;
    const cleanReason = reason.trim();
    if (!cleanReason) {
      setError('A reason is required for every hold or release command.');
      return;
    }

    const targetActive = !state.active;
    const reusableIntent = retryIntent
      && retryIntent.targetActive === targetActive
      && retryIntent.expectedRevision === state.revision
      && retryIntent.reason === cleanReason
      ? retryIntent
      : null;
    const intent: RetryIntent = reusableIntent ?? {
      idempotencyKey: commandId(),
      targetActive,
      expectedRevision: state.revision,
      reason: cleanReason,
    };

    setPending(true);
    setError('');
    setNotice('');
    try {
      const result = await setAccountReleaseHold({
        storeId,
        targetActive: intent.targetActive,
        expectedRevision: intent.expectedRevision,
        idempotencyKey: intent.idempotencyKey,
        deviceId: getOperationalDeviceId(),
        reason: intent.reason,
      });

      const authoritative = await readAccountHoldState(storeId);
      setState(authoritative);
      setRetryIntent(null);
      if (result.status === 'CONFLICT') {
        setNotice(`State changed on the server. Refreshed to revision ${authoritative.revision}; review it before trying again.`);
      } else {
        setReason('');
        setNotice(`${result.status === 'REPLAYED' ? 'Recovered' : 'Applied'} by server · revision ${authoritative.revision}.`);
        onAuthorityChanged();
      }
    } catch (commandError) {
      const message = commandError instanceof Error ? commandError.message : String(commandError);
      try {
        const authoritative = await readAccountHoldState(storeId);
        setState(authoritative);
        if (
          authoritative.sourceActionId === intent.idempotencyKey
          && authoritative.revision === intent.expectedRevision + 1
          && authoritative.active === intent.targetActive
        ) {
          setRetryIntent(null);
          setReason('');
          setNotice(`Applied by server and recovered by authoritative readback · revision ${authoritative.revision}.`);
          onAuthorityChanged();
          return;
        }
      } catch {
        // Keep the original command error as the primary evidence if readback also fails.
      }
      setRetryIntent(intent);
      setError(`${message} · Server acknowledgement is unresolved. Retrying the unchanged intent will reuse the same command ID.`);
    } finally {
      setPending(false);
    }
  }

  const retryMatchesCurrentState = Boolean(
    state
    && retryIntent
    && retryIntent.targetActive === !state.active
    && retryIntent.expectedRevision === state.revision
    && retryIntent.reason === reason.trim(),
  );

  if (!canCommand) {
    return <section className="operational-record-command-panel is-readonly" aria-label="Account hold command">
      <span className="section-eyebrow">ACCOUNT HOLD AUTHORITY</span>
      <p>Your role is read-only for account hold commands.</p>
    </section>;
  }

  return <section className="operational-record-command-panel" aria-label="Account hold command">
    <div className="operational-record-command-heading">
      <div><span className="section-eyebrow">ACCOUNT HOLD AUTHORITY</span><h3>{state?.active ? 'Release account hold' : 'Place account hold'}</h3></div>
      <button type="button" disabled={loading || pending} onClick={() => void load()}>Refresh authority</button>
    </div>
    {loading ? <p>Reading authoritative hold state…</p> : null}
    {!loading && state ? <div className="operational-record-command-state">
      <div><span>State</span><strong>{state.active ? 'HELD' : 'RELEASED'}</strong></div>
      <div><span>Revision</span><strong>{state.revision}</strong></div>
      <div><span>Last reason</span><strong>{state.holdReason || '—'}</strong></div>
      <div><span>Updated</span><strong>{timestamp(state.updatedAt)}</strong></div>
    </div> : null}
    {state ? <form onSubmit={submit} className="operational-record-command-form">
      <label><span>Reason <strong aria-hidden="true">*</strong></span><textarea rows={3} maxLength={500} disabled={pending} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={state.active ? 'Why can this store be released?' : 'Why must this store be held?'}/></label>
      <p className="operational-record-command-help">The server will compare revision {state.revision}, bind your authenticated identity and device context, and record before/after audit evidence. No optimistic state is shown.</p>
      <button type="submit" disabled={pending || !reason.trim()}>{pending ? 'Waiting for server…' : retryMatchesCurrentState ? 'Retry same command' : state.active ? 'Release hold' : 'Place hold'}</button>
    </form> : null}
    {notice ? <div className="operational-record-command-notice" role="status">{notice}</div> : null}
    {error ? <div className="operational-record-command-error" role="alert">{error}</div> : null}
  </section>;
}
