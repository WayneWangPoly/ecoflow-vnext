import { ArrowUpRight, Inspect, ListFilter, ShieldAlert } from 'lucide-react';
import {
  ControlButton,
  ControlPanel,
  ControlStatus,
  ControlTabs,
} from '@/features/intelligence/designSystem/primitives';
import type {
  CrossFilterAffectedEntity,
  CrossFilterDrillModel,
  CrossFilterOperationalRoute,
} from './crossFilterDrillContract';
import {
  crossFilterBreakdownMeta,
  crossFilterDrillMetricLabel,
  crossFilterDrillStatePresentation,
  crossFilterEntityKindLabel,
  crossFilterOperationalRouteLabel,
  resolveCrossFilterBreakdown,
} from './crossFilterDrillPresentationContract';
import './crossFilterDrillSurface.css';

export type CrossFilterDrillSurfaceProps = {
  model: CrossFilterDrillModel;
  activeBreakdownKey?: string | null;
  onBreakdownChange: (breakdownKey: string) => void;
  onInspectEntity: (entity: CrossFilterAffectedEntity) => void;
  onOpenOperationalRoute: (
    route: CrossFilterOperationalRoute,
    entity: CrossFilterAffectedEntity,
  ) => void;
};

export function CrossFilterDrillSurface({
  model,
  activeBreakdownKey,
  onBreakdownChange,
  onInspectEntity,
  onOpenOperationalRoute,
}: CrossFilterDrillSurfaceProps) {
  const presentation = crossFilterDrillStatePresentation(model);
  const activeBreakdown = resolveCrossFilterBreakdown(model, activeBreakdownKey);
  const requestedSelectionMissing = Boolean(
    activeBreakdownKey?.trim()
    && (model.state === 'ready' || model.state === 'partial')
    && model.breakdowns.length > 0
    && !activeBreakdown,
  );
  const meta = [
    model.metricAvailability,
    model.metricQuality,
    model.metricFreshness,
    model.issues.length ? `${model.issues.length} issues` : null,
  ].filter(Boolean).join(' · ');

  return (
    <ControlPanel
      tone="raised"
      className="ef-cross-filter-drill"
      eyebrow="CROSS-FILTER DRILL"
      title={crossFilterDrillMetricLabel(model)}
      meta={meta || 'Governed drill contract'}
      actions={(
        <ControlStatus
          tone={presentation.tone}
          label={presentation.label}
          compact
        />
      )}
      footer={(
        <div className="ef-cross-filter-drill__boundary">
          <ShieldAlert aria-hidden="true" />
          <span>Breakdowns, affected entities, detail drawers and routes are shown only from validated contract data.</span>
        </div>
      )}
    >
      {model.state === 'blocked' || model.state === 'invalid' || model.state === 'empty' ? (
        <div className="ef-cross-filter-drill__state" data-state={model.state} role="status">
          <ListFilter aria-hidden="true" />
          <strong>{presentation.title}</strong>
          <span>{presentation.description}</span>
        </div>
      ) : requestedSelectionMissing ? (
        <div className="ef-cross-filter-drill__state" data-state="partial" role="status">
          <ListFilter aria-hidden="true" />
          <strong>Selected breakdown is unavailable</strong>
          <span>The requested cross-filter key is not present in the validated model.</span>
        </div>
      ) : activeBreakdown ? (
        <div className="ef-cross-filter-drill__workspace">
          <ControlTabs
            items={model.breakdowns.map((breakdown) => ({
              id: breakdown.key,
              label: breakdown.valueLabel,
              count: breakdown.affectedCount,
            }))}
            activeId={activeBreakdown.key}
            onChange={onBreakdownChange}
            ariaLabel="Metric breakdown values"
            variant="segmented"
          />

          <header className="ef-cross-filter-drill__selection">
            <div>
              <span>{activeBreakdown.dimensionLabel}</span>
              <strong>{activeBreakdown.valueLabel}</strong>
            </div>
            <ControlStatus
              tone={activeBreakdown.truncated ? 'warning' : 'information'}
              label={crossFilterBreakdownMeta(activeBreakdown)}
              compact
            />
          </header>

          {activeBreakdown.entities.length === 0 ? (
            <div className="ef-cross-filter-drill__state" data-state="empty" role="status">
              <ListFilter aria-hidden="true" />
              <strong>No routed entities available</strong>
              <span>The breakdown count is preserved, but no validated operational entity route was returned.</span>
            </div>
          ) : (
            <div className="ef-cross-filter-drill__entity-list" role="list" aria-label="Affected operational entities">
              {activeBreakdown.entities.map((entity) => (
                <article className="ef-cross-filter-drill__entity" role="listitem" key={entity.key}>
                  <div className="ef-cross-filter-drill__entity-copy">
                    <span>{crossFilterEntityKindLabel(entity)}</span>
                    <strong>{entity.label}</strong>
                    {entity.subtitle ? <small>{entity.subtitle}</small> : null}
                  </div>
                  <div className="ef-cross-filter-drill__entity-actions">
                    <ControlButton
                      variant="quiet"
                      size="compact"
                      leading={<Inspect />}
                      onClick={() => onInspectEntity(entity)}
                    >
                      Inspect
                    </ControlButton>
                    <ControlButton
                      variant="secondary"
                      size="compact"
                      trailing={<ArrowUpRight />}
                      onClick={() => onOpenOperationalRoute(entity.operationalRoute, entity)}
                    >
                      {crossFilterOperationalRouteLabel(entity)}
                    </ControlButton>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="ef-cross-filter-drill__state" data-state="partial" role="status">
          <ListFilter aria-hidden="true" />
          <strong>{presentation.title}</strong>
          <span>{presentation.description}</span>
        </div>
      )}
    </ControlPanel>
  );
}
