import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import {
  analyticsPath,
  buildAnalyticsBarGeometry,
  buildAnalyticsLineGeometry,
  buildAnalyticsNumericTicks,
  selectAnalyticsLabelTicks,
  type AnalyticsSeriesDatum,
  type AnalyticsVisualTone,
} from './analyticsPrimitiveContract';
import './analyticsPrimitives.css';

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function formatDefault(value: number): string {
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 }).format(value);
}

export type AnalyticsMetricFrameProps = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  eyebrow?: ReactNode;
  title: ReactNode;
  value?: ReactNode;
  unit?: ReactNode;
  tone?: AnalyticsVisualTone;
  status?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
};

export function AnalyticsMetricFrame({
  eyebrow,
  title,
  value,
  unit,
  tone = 'neutral',
  status,
  meta,
  actions,
  footer,
  className,
  children,
  ...frameProps
}: AnalyticsMetricFrameProps) {
  return (
    <section
      {...frameProps}
      className={classes('ef-analytics-frame', className)}
      data-tone={tone}
    >
      <span className="ef-analytics-frame__rail" aria-hidden="true" />
      <header className="ef-analytics-frame__header">
        <div className="ef-analytics-frame__heading">
          {eyebrow ? <span>{eyebrow}</span> : null}
          <h2>{title}</h2>
          {meta ? <div className="ef-analytics-frame__meta">{meta}</div> : null}
        </div>
        {actions ? <div className="ef-analytics-frame__actions">{actions}</div> : null}
      </header>
      {value !== undefined || status ? (
        <div className="ef-analytics-frame__readout">
          {value !== undefined ? (
            <div className="ef-analytics-frame__value">
              <strong>{value}</strong>
              {unit ? <span>{unit}</span> : null}
            </div>
          ) : null}
          {status ? <div className="ef-analytics-frame__status">{status}</div> : null}
        </div>
      ) : null}
      <div className="ef-analytics-frame__body">{children}</div>
      {footer ? <footer className="ef-analytics-frame__footer">{footer}</footer> : null}
    </section>
  );
}

export type AnalyticsLineChartProps = {
  data: readonly AnalyticsSeriesDatum[];
  ariaLabel: string;
  tone?: AnalyticsVisualTone;
  valueFormatter?: (value: number) => string;
  height?: number;
  tickCount?: number;
  labelTickCount?: number;
  className?: string;
};

export function AnalyticsLineChart({
  data,
  ariaLabel,
  tone = 'information',
  valueFormatter = formatDefault,
  height = 260,
  tickCount = 5,
  labelTickCount = 6,
  className,
}: AnalyticsLineChartProps) {
  const geometry = buildAnalyticsLineGeometry(data, { width: 720, height, padding: 34 });
  const numericTicks = buildAnalyticsNumericTicks(geometry.domain, tickCount);
  const labelTicks = new Set(selectAnalyticsLabelTicks(geometry.points.length, labelTickCount));
  const innerHeight = geometry.height - geometry.padding * 2;
  const style = { '--ef-analytics-chart-height': `${geometry.height}px` } as CSSProperties;

  function yForValue(value: number): number {
    if (!geometry.domain) return geometry.height / 2;
    const ratio = (value - geometry.domain.min) / (geometry.domain.max - geometry.domain.min);
    return geometry.padding + innerHeight - ratio * innerHeight;
  }

  return (
    <figure
      className={classes('ef-analytics-line', className)}
      data-tone={tone}
      data-state={geometry.domain ? 'plottable' : 'empty'}
      data-issues={geometry.issues.length}
      style={style}
    >
      <svg
        viewBox={`0 0 ${geometry.width} ${geometry.height}`}
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="ef-analytics-line-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity=".16" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="ef-analytics-line__grid" aria-hidden="true">
          {numericTicks.map((tick) => {
            const y = yForValue(tick);
            return <line key={tick} x1={geometry.padding} x2={geometry.width - geometry.padding} y1={y} y2={y} />;
          })}
          {geometry.points.filter((point) => labelTicks.has(point.index)).map((point) => (
            <line key={point.key} x1={point.x} x2={point.x} y1={geometry.padding} y2={geometry.height - geometry.padding} />
          ))}
        </g>
        <g className="ef-analytics-line__missing">
          {geometry.points.filter((point) => point.y === null).map((point) => (
            <line
              key={point.key}
              x1={point.x}
              x2={point.x}
              y1={geometry.padding}
              y2={geometry.height - geometry.padding}
            >
              <title>{point.label}</title>
            </line>
          ))}
        </g>
        <g className="ef-analytics-line__series">
          {geometry.segments.map((segment) => {
            const path = analyticsPath(segment.points);
            if (!path) return null;
            const last = segment.points[segment.points.length - 1];
            const first = segment.points[0];
            const area = `${path} L ${last.x.toFixed(2)} ${(geometry.height - geometry.padding).toFixed(2)} L ${first.x.toFixed(2)} ${(geometry.height - geometry.padding).toFixed(2)} Z`;
            return (
              <g key={segment.key}>
                <path className="ef-analytics-line__area" d={area} />
                <path className="ef-analytics-line__glow" d={path} />
                <path className="ef-analytics-line__path" d={path} />
              </g>
            );
          })}
          {geometry.points.filter((point) => point.y !== null && point.value !== null).map((point) => (
            <circle key={point.key} cx={point.x} cy={point.y ?? 0} r="3.4">
              <title>{point.label} · {valueFormatter(point.value as number)}</title>
            </circle>
          ))}
        </g>
      </svg>
      <div className="ef-analytics-line__scale" aria-hidden="true">
        <div className="ef-analytics-line__values">
          {[...numericTicks].reverse().map((tick) => <span key={tick}>{valueFormatter(tick)}</span>)}
        </div>
        <div className="ef-analytics-line__labels">
          {geometry.points.filter((point) => labelTicks.has(point.index)).map((point) => (
            <span key={point.key}>{point.label}</span>
          ))}
        </div>
      </div>
    </figure>
  );
}

export type AnalyticsBarChartProps = {
  data: readonly AnalyticsSeriesDatum[];
  ariaLabel: string;
  tone?: AnalyticsVisualTone;
  valueFormatter?: (value: number) => string;
  missingAriaLabel: string;
  className?: string;
};

export function AnalyticsBarChart({
  data,
  ariaLabel,
  tone = 'information',
  valueFormatter = formatDefault,
  missingAriaLabel,
  className,
}: AnalyticsBarChartProps) {
  const geometry = buildAnalyticsBarGeometry(data);
  return (
    <div
      className={classes('ef-analytics-bars', className)}
      data-tone={tone}
      data-state={geometry.domain ? 'plottable' : 'empty'}
      data-issues={geometry.issues.length}
      role="img"
      aria-label={ariaLabel}
    >
      {geometry.rows.map((row) => (
        <div className="ef-analytics-bars__row" data-direction={row.direction} key={row.key}>
          <span className="ef-analytics-bars__label">{row.label}</span>
          <span className="ef-analytics-bars__track" aria-hidden="true">
            <i className="ef-analytics-bars__zero" style={{ left: `${geometry.zeroPercent}%` }} />
            {row.startPercent !== null && row.widthPercent !== null ? (
              <b style={{ left: `${row.startPercent}%`, width: `${row.widthPercent}%` }} />
            ) : null}
          </span>
          <strong aria-label={row.value === null ? missingAriaLabel : undefined}>
            {row.value === null ? '—' : valueFormatter(row.value)}
          </strong>
        </div>
      ))}
    </div>
  );
}

export type AnalyticsTableColumn<Row> = {
  key: string;
  header: ReactNode;
  render: (row: Row, index: number) => ReactNode;
  align?: 'start' | 'center' | 'end';
  width?: string;
  className?: string;
};

export type AnalyticsDataTableProps<Row> = {
  rows: readonly Row[];
  columns: readonly AnalyticsTableColumn<Row>[];
  rowKey: (row: Row, index: number) => string;
  ariaLabel: string;
  empty?: ReactNode;
  caption?: ReactNode;
  stickyHeader?: boolean;
  className?: string;
  rowClassName?: (row: Row, index: number) => string | undefined;
};

export function AnalyticsDataTable<Row>({
  rows,
  columns,
  rowKey,
  ariaLabel,
  empty,
  caption,
  stickyHeader = false,
  className,
  rowClassName,
}: AnalyticsDataTableProps<Row>) {
  return (
    <div className={classes('ef-analytics-table-shell', className)} data-sticky-header={stickyHeader ? 'true' : 'false'}>
      <table className="ef-analytics-table" aria-label={ariaLabel}>
        {caption ? <caption>{caption}</caption> : null}
        <colgroup>
          {columns.map((column) => <col key={column.key} style={column.width ? { width: column.width } : undefined} />)}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" data-align={column.align ?? 'start'} className={column.className}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowKey(row, rowIndex)} className={rowClassName?.(row, rowIndex)}>
              {columns.map((column) => (
                <td key={column.key} data-align={column.align ?? 'start'} className={column.className}>
                  {column.render(row, rowIndex)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && empty !== undefined ? <div className="ef-analytics-table__empty">{empty}</div> : null}
    </div>
  );
}
