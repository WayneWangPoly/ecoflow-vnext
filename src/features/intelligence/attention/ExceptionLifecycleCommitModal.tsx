import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import {
  ControlButton,
  ControlFieldFrame,
  ControlInput,
  ControlSelect,
  ControlStatus,
} from '@/features/intelligence/designSystem/primitives';
import type {
  ActionableExceptionLifecycleCommandInput,
  ActionableExceptionLifecycleCommandRecord,
  ActionableExceptionLifecycleCommandResult,
  ActionableExceptionLifecycleRecord,
} from './actionableExceptionLifecycleContract';
import type { ActionableExceptionLifecycleAccess } from './actionableExceptionLifecycleAccessContract';
import {
  actionableExceptionLifecycleActionOptions,
  actionableExceptionLifecycleCurrentState,
  type ActionableExceptionLifecycleActionOption,
} from './actionableExceptionLifecyclePresentationContract';
import './exceptionLifecycleCommitModal.css';

export type ExceptionLifecycleCommitModalProps = {
  open: boolean;
  exceptionId: string;
  exceptionTitle: string;
  lifecycle: ActionableExceptionLifecycleRecord | null;
  access: ActionableExceptionLifecycleAccess | null;
  onClose: () => void;
  onCommit: (input: ActionableExceptionLifecycleCommandInput) => Promise<ActionableExceptionLifecycleCommandResult>;
  onCommitted: (record: ActionableExceptionLifecycleCommandRecord) => void;
  onConflict: () => void;
};

function createCommandId(): string | null {
  return globalThis.crypto?.randomUUID?.() ?? null;
}

function errorMessage(result: ActionableExceptionLifecycleCommandResult | null): string | null {
  if (!result || result.ok) return null;
  if (result.state === 'conflict') return `Lifecycle changed before this commit: ${result.error.message}`;
  if (result.state === 'forbidden') return 'Your current account cannot commit lifecycle actions.';
  if (result.state === 'invalid') return `Commit details are invalid: ${result.error.message}`;
  if (result.state === 'unavailable') return 'Lifecycle commands are temporarily unavailable.';
  return `Lifecycle commit failed: ${result.error.message}`;
}

function thrownCommitFailure(error: unknown): ActionableExceptionLifecycleCommandResult {
  return {
    ok: false,
    data: null,
    state: 'failed',
    error: {
      state: 'failed',
      code: 'UI_COMMIT_THROWN',
      message: error instanceof Error ? error.message : 'Unexpected lifecycle commit failure.',
    },
  };
}

export function ExceptionLifecycleCommitModal({
  open,
  exceptionId,
  exceptionTitle,
  lifecycle,
  access,
  onClose,
  onCommit,
  onCommitted,
  onConflict,
}: ExceptionLifecycleCommitModalProps) {
  const options = useMemo(
    () => actionableExceptionLifecycleActionOptions(access, lifecycle),
    [access, lifecycle],
  );
  const optionsKey = options.map((option) => option.action).join('|');
  const [selectedAction, setSelectedAction] = useState<string>('');
  const [ownerTeam, setOwnerTeam] = useState('');
  const [snoozedUntil, setSnoozedUntil] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [note, setNote] = useState('');
  const [commandId, setCommandId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ActionableExceptionLifecycleCommandResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedAction(options[0]?.action ?? '');
    setOwnerTeam(lifecycle?.ownerTeam ?? '');
    setSnoozedUntil('');
    setResolutionNote('');
    setNote('');
    setCommandId(createCommandId());
    setSubmitting(false);
    setResult(null);
  }, [open, exceptionId, optionsKey]);

  const selectedOption = options.find((option) => option.action === selectedAction) ?? options[0] ?? null;
  const submissionError = errorMessage(result);
  const secureCommandUnavailable = !commandId;

  function changeDraft(update: () => void) {
    update();
    setCommandId(createCommandId());
    setResult(null);
  }

  function fieldValue(option: ActionableExceptionLifecycleActionOption | null): string {
    if (!option) return '';
    if (option.fieldKind === 'ownerTeam') return ownerTeam;
    if (option.fieldKind === 'snoozedUntil') return snoozedUntil;
    if (option.fieldKind === 'resolutionNote') return resolutionNote;
    if (option.fieldKind === 'note') return note;
    return '';
  }

  function requiredFieldError(option: ActionableExceptionLifecycleActionOption | null): string | null {
    if (!option || option.fieldKind === 'none') return null;
    return fieldValue(option).trim() ? null : `${option.fieldLabel ?? 'Required field'} is required.`;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOption || !commandId || submitting) return;
    const fieldError = requiredFieldError(selectedOption);
    if (fieldError) {
      setResult({
        ok: false,
        data: null,
        state: 'invalid',
        error: { state: 'invalid', code: 'UI_REQUIRED_FIELD', message: fieldError },
      });
      return;
    }

    let snoozeIso: string | undefined;
    if (selectedOption.fieldKind === 'snoozedUntil') {
      const parsed = new Date(snoozedUntil);
      if (Number.isNaN(parsed.getTime())) {
        setResult({
          ok: false,
          data: null,
          state: 'invalid',
          error: { state: 'invalid', code: 'UI_INVALID_SNOOZE', message: 'Snooze deadline is invalid.' },
        });
        return;
      }
      snoozeIso = parsed.toISOString();
    }

    setSubmitting(true);
    let nextResult: ActionableExceptionLifecycleCommandResult;
    try {
      nextResult = await onCommit({
        commandId,
        exceptionId,
        action: selectedOption.action,
        ownerTeam: selectedOption.fieldKind === 'ownerTeam' ? ownerTeam : undefined,
        snoozedUntil: snoozeIso,
        resolutionNote: selectedOption.fieldKind === 'resolutionNote' ? resolutionNote : undefined,
        note: selectedOption.fieldKind === 'note' ? note : undefined,
      });
    } catch (error: unknown) {
      nextResult = thrownCommitFailure(error);
    }
    setSubmitting(false);
    setResult(nextResult);
    if (nextResult.ok) {
      onCommitted(nextResult.data);
    } else if (nextResult.state === 'conflict') {
      onConflict();
    }
  }

  function handleBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget && !submitting) onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !submitting) onClose();
  }

  if (!open) return null;

  return (
    <div
      className="ef-lifecycle-commit-modal"
      role="presentation"
      onMouseDown={handleBackdrop}
      onKeyDown={handleKeyDown}
    >
      <section
        className="ef-lifecycle-commit-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ef-lifecycle-commit-title"
        aria-describedby="ef-lifecycle-commit-description"
      >
        <header className="ef-lifecycle-commit-modal__header">
          <div>
            <span className="ef-lifecycle-commit-modal__eyebrow">Governed lifecycle commit</span>
            <h2 id="ef-lifecycle-commit-title">{exceptionTitle}</h2>
            <p id="ef-lifecycle-commit-description">
              Review and commit one auditable lifecycle action. This does not change the Ordermentum order.
            </p>
          </div>
          <ControlButton variant="quiet" size="compact" onClick={onClose} disabled={submitting} aria-label="Close lifecycle commit modal">
            Close
          </ControlButton>
        </header>

        <div className="ef-lifecycle-commit-modal__signals">
          <ControlStatus tone="information" compact label={`Current: ${actionableExceptionLifecycleCurrentState(lifecycle)}`} />
          <ControlStatus tone="neutral" compact label={lifecycle?.ownerTeam ? `Owner: ${lifecycle.ownerTeam}` : 'Owner: Unassigned'} />
          <ControlStatus tone="neutral" compact label={`Exception: ${exceptionId.slice(-12)}`} />
        </div>

        {options.length === 0 ? (
          <div className="ef-lifecycle-commit-modal__message" data-state="read-only">
            <strong>No lifecycle commands available</strong>
            <span>The server access envelope and lifecycle row do not authorise a commit for this item.</span>
          </div>
        ) : (
          <form className="ef-lifecycle-commit-modal__form" onSubmit={handleSubmit}>
            <ControlSelect
              id="ef-lifecycle-action"
              label="Lifecycle action"
              value={selectedOption?.action ?? ''}
              onChange={(event) => changeDraft(() => setSelectedAction(event.target.value))}
              disabled={submitting}
            >
              {options.map((option) => (
                <option key={option.action} value={option.action}>{option.label}</option>
              ))}
            </ControlSelect>

            {selectedOption?.fieldKind === 'ownerTeam' ? (
              <ControlInput
                id="ef-lifecycle-owner-team"
                label={selectedOption.fieldLabel ?? 'Owner / team'}
                requiredIndicator="Required"
                value={ownerTeam}
                maxLength={80}
                placeholder={selectedOption.fieldPlaceholder ?? undefined}
                onChange={(event) => changeDraft(() => setOwnerTeam(event.target.value))}
                disabled={submitting}
              />
            ) : null}

            {selectedOption?.fieldKind === 'snoozedUntil' ? (
              <ControlInput
                id="ef-lifecycle-snooze-until"
                label={selectedOption.fieldLabel ?? 'Snooze until'}
                requiredIndicator="Required"
                type="datetime-local"
                value={snoozedUntil}
                hint={`Maximum ${access?.maxSnoozeDays ?? 30} days. Database time and transition checks remain authoritative.`}
                onChange={(event) => changeDraft(() => setSnoozedUntil(event.target.value))}
                disabled={submitting}
              />
            ) : null}

            {selectedOption?.fieldKind === 'resolutionNote' ? (
              <ControlFieldFrame
                id="ef-lifecycle-resolution-note"
                label={selectedOption.fieldLabel ?? 'Resolution note'}
                requiredIndicator="Required"
                hint="Maximum 2,000 characters. Use factual, verifiable wording."
              >
                <textarea
                  id="ef-lifecycle-resolution-note"
                  className="ef-lifecycle-commit-modal__textarea"
                  value={resolutionNote}
                  maxLength={2000}
                  placeholder={selectedOption.fieldPlaceholder ?? undefined}
                  onChange={(event) => changeDraft(() => setResolutionNote(event.target.value))}
                  disabled={submitting}
                />
              </ControlFieldFrame>
            ) : null}

            {selectedOption?.fieldKind === 'note' ? (
              <ControlFieldFrame
                id="ef-lifecycle-note"
                label={selectedOption.fieldLabel ?? 'Operator note'}
                requiredIndicator="Required"
                hint="Maximum 2,000 characters. The note becomes immutable audit history."
              >
                <textarea
                  id="ef-lifecycle-note"
                  className="ef-lifecycle-commit-modal__textarea"
                  value={note}
                  maxLength={2000}
                  placeholder={selectedOption.fieldPlaceholder ?? undefined}
                  onChange={(event) => changeDraft(() => setNote(event.target.value))}
                  disabled={submitting}
                />
              </ControlFieldFrame>
            ) : null}

            <div className="ef-lifecycle-commit-modal__review" data-tone={selectedOption?.tone ?? 'default'}>
              <strong>{selectedOption?.description}</strong>
              <span>{selectedOption?.confirmation}</span>
              <code>{commandId ?? 'Secure command ID unavailable'}</code>
            </div>

            {submissionError || secureCommandUnavailable ? (
              <div className="ef-lifecycle-commit-modal__message" data-state={result && !result.ok ? result.state : 'failed'} role="alert">
                <strong>{secureCommandUnavailable ? 'Secure command ID unavailable' : 'Commit not applied'}</strong>
                <span>{secureCommandUnavailable ? 'This browser cannot create the required idempotent command identifier.' : submissionError}</span>
              </div>
            ) : null}

            <footer className="ef-lifecycle-commit-modal__footer">
              <ControlButton variant="secondary" onClick={onClose} disabled={submitting} type="button">
                Cancel
              </ControlButton>
              <ControlButton
                variant={selectedOption?.tone === 'danger' ? 'danger' : 'primary'}
                type="submit"
                busy={submitting}
                disabled={!selectedOption || secureCommandUnavailable || submitting}
              >
                {selectedOption?.commitLabel ?? 'Commit lifecycle action'}
              </ControlButton>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
