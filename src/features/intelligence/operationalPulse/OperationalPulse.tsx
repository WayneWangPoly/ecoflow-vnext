import type { HTMLAttributes } from 'react';
import {
  formatOperationalPulseMoment,
  operationalPulseSignalTone,
  type OperationalPulseDeck,
  type OperationalPulseMetric,
  type OperationalPulseTone,
} from './operationalPulseContract';
import './operationalPulse.css';

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function PulseSignal({ tone, label }: { tone: OperationalPulseTone; label: string }) {
  return (
    <span className="ef-operational-pulse__signal" data-tone={tone}>
      {label}
    </span>
  );
}

export type OperationalPulseCardProps = HTMLAttributes<HTMLElement> & {
  metric: OperationalPulseMetric;
};

export function OperationalPulseCard({ metric, className, ...articleProps }: OperationalPulseCardProps) {
  const tone = operationalPulseSignalTone(metric);
  const accessibleValue = metric.availability === 'READY'
    ? metric.displayValue
    : metric.availability;

  return (
    <article
      {...articleProps}
      className={classes('ef-operational-pulse__card', className)}
      data-availability={metric.availability.toLowerCase()}
      data-freshness={metric.freshness.toLowerCase()}
      data-quality={metric.quality.toLowerCase()}
      data-tone={tone}
      aria-label={`${metric.displayName}: ${accessibleValue}`}
    >
      <i className="ef-operational-pulse__rail" aria-hidden="true" />
      <header className="ef-operational-pulse__header">
        <div>
          <span>{metric.metricKey.replace(/_/g, ' ')}</span>
          <h3>{metric.displayName}</h3>
        </div>
        <PulseSignal tone={tone} label={metric.availability} />
      </header>

      <div className="ef-operational-pulse__value">
        <strong>{metric.availability === 'READY' ? metric.displayValue : '—'}</strong>
        <span>{metric.unitKind}</span>
      </div>

      {metric.blockerCodes.length ? (
        <div className="ef-operational-pulse__blockers" aria-label="Metric blockers">
          {metric.blockerCodes.map((code) => <code key={code}>{code}</code>)}
        </div>
      ) : null}

      <footer className="ef-operational-pulse__footer">
        <span>{metric.freshness}</span>
        <span>{metric.quality}</span>
        <time dateTime={metric.asOfAt ?? undefined}>{formatOperationalPulseMoment(metric.asOfAt)}</time>
      </footer>
    </article>
  );
}

export type OperationalPulseDeckProps = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  deck: OperationalPulseDeck;
  ariaLabel: string;
};

export function OperationalPulseDeck({
  deck,
  ariaLabel,
  className,
  ...sectionProps
}: OperationalPulseDeckProps) {
  return (
    <section
      {...sectionProps}
      className={classes('ef-operational-pulse', className)}
      data-state={deck.state}
      data-issue-count={deck.issues.length}
      aria-label={ariaLabel}
    >
      {deck.metrics.map((metric) => (
        <OperationalPulseCard key={metric.metricKey} metric={metric} />
      ))}
    </section>
  );
}
