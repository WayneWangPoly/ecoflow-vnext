import { useMemo, useState } from 'react';
import { phase4DomainManifests } from '../domainIntelligence/domainRegistry';
import type { Phase4DomainId } from '../domainIntelligence/domainIntelligenceContract';
import {
  actionHandoffDefinitions,
  buildActionHandoff,
  validateActionHandoffRegistry,
} from './actionHandoffContract';
import {
  safeInlineActionRegistry,
  validateSafeInlineActionRegistry,
} from './safeInlineActionContract';
import './actionIntegrationWorkspace.css';

export function ActionIntegrationPanel() {
  const firstDomain = phase4DomainManifests[0];
  const [activeDomainId, setActiveDomainId] = useState<Phase4DomainId>(firstDomain?.id ?? 'inventory');
  const domain = phase4DomainManifests.find((candidate) => candidate.id === activeDomainId) ?? firstDomain;
  const handoffIssues = useMemo(() => validateActionHandoffRegistry(), []);
  const inlineIssues = useMemo(() => validateSafeInlineActionRegistry(), []);
  const registryIssues = handoffIssues.length + inlineIssues.length;
  const handoffs = useMemo(
    () => actionHandoffDefinitions.map((definition) => ({
      definition,
      result: buildActionHandoff(definition.key, {
        domainId: activeDomainId,
        sourceAsOfAt: domain?.freshness.sourceAsOfAt ?? null,
      }),
    })),
    [activeDomainId, domain?.freshness.sourceAsOfAt],
  );
  const availableInlineActions = safeInlineActionRegistry.filter((action) => action.eligibility === 'AVAILABLE');

  return (
    <section className="ef-action-integration" aria-labelledby="action-integration-title">
      <header className="ef-action-integration__header">
        <div>
          <span>PHASE 5 · ACTION INTEGRATION</span>
          <h2 id="action-integration-title">Governed operational handoff</h2>
          <p>
            Analytics passes bounded context into operational workspaces. Inline actions appear only after a server command, revision, idempotency and permission contract is complete.
          </p>
        </div>
        <div className="ef-action-integration__boundary" data-state={registryIssues === 0 ? 'ready' : 'blocked'}>
          <span>Write boundary</span>
          <strong>NO DIRECT WRITES</strong>
          <small>{availableInlineActions.length} migrated inline command family available.</small>
        </div>
      </header>

      <nav className="ef-action-integration__domains" aria-label="Action handoff source domain">
        {phase4DomainManifests.map((manifest) => (
          <button
            key={manifest.id}
            type="button"
            aria-pressed={manifest.id === activeDomainId}
            onClick={() => setActiveDomainId(manifest.id)}
          >
            <span>{manifest.eyebrow}</span>
            <strong>{manifest.title}</strong>
          </button>
        ))}
      </nav>

      {registryIssues > 0 || !domain ? (
        <div className="ef-action-integration__state" data-state="blocked" role="status">
          <strong>Action Integration registry unavailable</strong>
          <span>{registryIssues || 1} governed issue(s)</span>
        </div>
      ) : (
        <>
          <div className="ef-action-integration__source">
            <div>
              <span>ANALYSIS SOURCE</span>
              <h3>{domain.title}</h3>
              <p>{domain.summary}</p>
            </div>
            <dl>
              <div><dt>Domain</dt><dd>{domain.id}</dd></div>
              <div><dt>Data state</dt><dd>{domain.data}</dd></div>
              <div><dt>Freshness</dt><dd>{domain.freshness.state}</dd></div>
            </dl>
          </div>

          <div className="ef-action-integration__grid" aria-label={`${domain.title} operational handoffs`}>
            {handoffs.map(({ definition, result }) => (
              <article key={definition.key} className="ef-action-integration__card">
                <header>
                  <span>{definition.workspace.toUpperCase()}</span>
                  <strong>{definition.label}</strong>
                </header>
                <p>{definition.description}</p>
                {result.ok ? (
                  <a href={result.handoff.href}>
                    {definition.label}
                    <span aria-hidden="true">→</span>
                  </a>
                ) : (
                  <div className="ef-action-integration__blocked-link" role="status">
                    Handoff blocked
                  </div>
                )}
                <small>Context only · no command execution</small>
              </article>
            ))}
          </div>

          <section className="ef-action-integration__inline" aria-labelledby="safe-inline-title">
            <header>
              <div>
                <span>INTEL-ACT-002 · SAFE INLINE ACTIONS</span>
                <h3 id="safe-inline-title">Command migration eligibility</h3>
              </div>
              <strong>{availableInlineActions.length} / {safeInlineActionRegistry.length} available</strong>
            </header>
            <div className="ef-action-integration__inline-grid">
              {safeInlineActionRegistry.map((action) => (
                <article key={action.key} data-state={action.eligibility.toLowerCase()}>
                  <header>
                    <div>
                      <span>{action.key}</span>
                      <strong>{action.label}</strong>
                    </div>
                    <b>{action.eligibility}</b>
                  </header>
                  <p>{action.evidence}</p>
                  {action.eligibility === 'AVAILABLE' ? (
                    <dl>
                      <div><dt>Server command</dt><dd>{action.serverCommand}</dd></div>
                      <div><dt>Revision</dt><dd>{action.revisionContract}</dd></div>
                      <div><dt>Idempotency</dt><dd>{action.idempotencyContract}</dd></div>
                      <div><dt>Permission</dt><dd>{action.permissionContract}</dd></div>
                      <div><dt>Outcomes</dt><dd>{action.outcomeContract.join(' · ')}</dd></div>
                    </dl>
                  ) : (
                    <div className="ef-action-integration__inline-blocker">
                      <strong>Inline action blocked</strong>
                      <span>{action.blocker}</span>
                      <a href={action.operationalPath}>Open operational workspace</a>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>

          <footer className="ef-action-integration__footer">
            <strong>Destination-owned execution</strong>
            <span>
              Order release, inventory movement, customer changes, route control and return disposition remain blocked inline. The existing Exception lifecycle command is the sole migrated family and preserves accepted, conflict, rejected, replay and network-unknown outcomes.
            </span>
          </footer>
        </>
      )}
    </section>
  );
}
