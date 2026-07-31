import { useMemo, useState } from 'react';
import { phase4DomainManifests } from '../domainIntelligence/domainRegistry';
import type { Phase4DomainId } from '../domainIntelligence/domainIntelligenceContract';
import {
  actionHandoffDefinitions,
  buildActionHandoff,
  validateActionHandoffRegistry,
} from './actionHandoffContract';
import './actionIntegrationWorkspace.css';

export function ActionIntegrationPanel() {
  const firstDomain = phase4DomainManifests[0];
  const [activeDomainId, setActiveDomainId] = useState<Phase4DomainId>(firstDomain?.id ?? 'inventory');
  const domain = phase4DomainManifests.find((candidate) => candidate.id === activeDomainId) ?? firstDomain;
  const registryIssues = useMemo(() => validateActionHandoffRegistry(), []);
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

  return (
    <section className="ef-action-integration" aria-labelledby="action-integration-title">
      <header className="ef-action-integration__header">
        <div>
          <span>PHASE 5 · ACTION INTEGRATION</span>
          <h2 id="action-integration-title">Governed operational handoff</h2>
          <p>
            Analytics passes bounded context into operational workspaces. The destination domain remains the authority for every command.
          </p>
        </div>
        <div className="ef-action-integration__boundary" data-state={registryIssues.length === 0 ? 'ready' : 'blocked'}>
          <span>Write boundary</span>
          <strong>READ ONLY</strong>
          <small>No business table update is issued here.</small>
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

      {registryIssues.length > 0 || !domain ? (
        <div className="ef-action-integration__state" data-state="blocked" role="status">
          <strong>Action handoff registry unavailable</strong>
          <span>{registryIssues.length || 1} governed issue(s)</span>
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

          <footer className="ef-action-integration__footer">
            <strong>Destination-owned execution</strong>
            <span>
              Order release, inventory movement, customer changes, route approval and exception lifecycle updates remain inside their governed domain command paths.
            </span>
          </footer>
        </>
      )}
    </section>
  );
}
