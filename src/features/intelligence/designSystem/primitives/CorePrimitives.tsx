import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import {
  controlClassName,
  primitiveModifier,
  type ControlButtonSize,
  type ControlButtonVariant,
  type ControlFieldDensity,
  type ControlPanelTone,
  type ControlSkeletonShape,
  type ControlStatusTone,
  type ControlTabVariant,
  type ControlTooltipPlacement,
} from './corePrimitiveContract';
import './corePrimitives.css';

export type ControlButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ControlButtonVariant;
  size?: ControlButtonSize;
  busy?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
};

export const ControlButton = forwardRef<HTMLButtonElement, ControlButtonProps>(function ControlButton(
  {
    variant = 'secondary',
    size = 'standard',
    busy = false,
    leading,
    trailing,
    className,
    children,
    disabled,
    type = 'button',
    ...buttonProps
  },
  ref,
) {
  return (
    <button
      {...buttonProps}
      ref={ref}
      type={type}
      className={controlClassName(
        'ef-control-button',
        primitiveModifier('ef-control-button', variant),
        primitiveModifier('ef-control-button-size', size),
        busy && 'is-busy',
        className,
      )}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      <span className="ef-control-button__surface" aria-hidden="true" />
      {busy ? <span className="ef-control-button__spinner" aria-hidden="true" /> : null}
      {leading ? <span className="ef-control-button__leading" aria-hidden="true">{leading}</span> : null}
      <span className="ef-control-button__label">{children}</span>
      {trailing ? <span className="ef-control-button__trailing" aria-hidden="true">{trailing}</span> : null}
    </button>
  );
});

export type ControlFieldFrameProps = {
  id: string;
  label: ReactNode;
  labelMode?: 'visible' | 'sr-only';
  hint?: ReactNode;
  error?: ReactNode;
  requiredIndicator?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function ControlFieldFrame({
  id,
  label,
  labelMode = 'visible',
  hint,
  error,
  requiredIndicator,
  className,
  children,
}: ControlFieldFrameProps) {
  return (
    <div className={controlClassName('ef-control-field', Boolean(error) && 'has-error', className)}>
      <label className={controlClassName('ef-control-field__label', labelMode === 'sr-only' && 'ef-control-sr-only')} htmlFor={id}>
        <span>{label}</span>
        {requiredIndicator ? <span className="ef-control-field__required">{requiredIndicator}</span> : null}
      </label>
      {children}
      {error ? <div className="ef-control-field__message ef-control-field__message--error" id={`${id}-error`}>{error}</div> : null}
      {!error && hint ? <div className="ef-control-field__message" id={`${id}-hint`}>{hint}</div> : null}
    </div>
  );
}

type FieldDecorationProps = {
  label: ReactNode;
  labelMode?: 'visible' | 'sr-only';
  hint?: ReactNode;
  error?: ReactNode;
  requiredIndicator?: ReactNode;
  density?: ControlFieldDensity;
  leading?: ReactNode;
  trailing?: ReactNode;
  fieldClassName?: string;
};

export type ControlInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & FieldDecorationProps;

export const ControlInput = forwardRef<HTMLInputElement, ControlInputProps>(function ControlInput(
  {
    id,
    label,
    labelMode,
    hint,
    error,
    requiredIndicator,
    density = 'standard',
    leading,
    trailing,
    fieldClassName,
    className,
    ...inputProps
  },
  ref,
) {
  const generatedId = useId();
  const controlId = id || generatedId;
  const describedBy = [
    inputProps['aria-describedby'],
    error ? `${controlId}-error` : undefined,
    !error && hint ? `${controlId}-hint` : undefined,
  ].filter(Boolean).join(' ') || undefined;

  return (
    <ControlFieldFrame
      id={controlId}
      label={label}
      labelMode={labelMode}
      hint={hint}
      error={error}
      requiredIndicator={requiredIndicator}
      className={fieldClassName}
    >
      <div className={controlClassName('ef-control-input-shell', primitiveModifier('ef-control-density', density), className)}>
        {leading ? <span className="ef-control-input-shell__slot" aria-hidden="true">{leading}</span> : null}
        <input
          {...inputProps}
          ref={ref}
          id={controlId}
          className="ef-control-input"
          aria-describedby={describedBy}
          aria-invalid={error ? true : inputProps['aria-invalid']}
        />
        {trailing ? <span className="ef-control-input-shell__slot" aria-hidden="true">{trailing}</span> : null}
      </div>
    </ControlFieldFrame>
  );
});

export type ControlSelectProps = SelectHTMLAttributes<HTMLSelectElement> & Omit<FieldDecorationProps, 'leading' | 'trailing'>;

export const ControlSelect = forwardRef<HTMLSelectElement, ControlSelectProps>(function ControlSelect(
  {
    id,
    label,
    labelMode,
    hint,
    error,
    requiredIndicator,
    density = 'standard',
    fieldClassName,
    className,
    children,
    ...selectProps
  },
  ref,
) {
  const generatedId = useId();
  const controlId = id || generatedId;
  const describedBy = [
    selectProps['aria-describedby'],
    error ? `${controlId}-error` : undefined,
    !error && hint ? `${controlId}-hint` : undefined,
  ].filter(Boolean).join(' ') || undefined;

  return (
    <ControlFieldFrame
      id={controlId}
      label={label}
      labelMode={labelMode}
      hint={hint}
      error={error}
      requiredIndicator={requiredIndicator}
      className={fieldClassName}
    >
      <div className={controlClassName('ef-control-select-shell', primitiveModifier('ef-control-density', density), className)}>
        <select
          {...selectProps}
          ref={ref}
          id={controlId}
          className="ef-control-select"
          aria-describedby={describedBy}
          aria-invalid={error ? true : selectProps['aria-invalid']}
        >
          {children}
        </select>
        <span className="ef-control-select__chevron" aria-hidden="true" />
      </div>
    </ControlFieldFrame>
  );
});

export type ControlStatusProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: ControlStatusTone;
  label: ReactNode;
  pulse?: boolean;
  compact?: boolean;
  live?: boolean;
};

export function ControlStatus({
  tone = 'neutral',
  label,
  pulse = false,
  compact = false,
  live = false,
  className,
  role,
  ...statusProps
}: ControlStatusProps) {
  return (
    <span
      {...statusProps}
      role={live ? 'status' : role}
      className={controlClassName(
        'ef-control-status',
        primitiveModifier('ef-control-status', tone),
        pulse && 'is-pulsing',
        compact && 'is-compact',
        className,
      )}
    >
      <span className="ef-control-status__signal" aria-hidden="true" />
      <span className="ef-control-status__label">{label}</span>
    </span>
  );
}

export type ControlPanelProps = HTMLAttributes<HTMLElement> & {
  tone?: ControlPanelTone;
  eyebrow?: ReactNode;
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
};

export function ControlPanel({
  tone = 'default',
  eyebrow,
  title,
  meta,
  actions,
  footer,
  className,
  children,
  ...panelProps
}: ControlPanelProps) {
  const hasHeader = eyebrow || title || meta || actions;
  return (
    <section
      {...panelProps}
      className={controlClassName('ef-control-panel', primitiveModifier('ef-control-panel', tone), className)}
    >
      <span className="ef-control-panel__edge" aria-hidden="true" />
      {hasHeader ? (
        <header className="ef-control-panel__header">
          <div className="ef-control-panel__heading">
            {eyebrow ? <span className="ef-control-panel__eyebrow">{eyebrow}</span> : null}
            {title ? <h2>{title}</h2> : null}
            {meta ? <div className="ef-control-panel__meta">{meta}</div> : null}
          </div>
          {actions ? <div className="ef-control-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="ef-control-panel__body">{children}</div>
      {footer ? <footer className="ef-control-panel__footer">{footer}</footer> : null}
    </section>
  );
}

export type ControlTabItem = {
  id: string;
  label: ReactNode;
  count?: ReactNode;
  disabled?: boolean;
};

export type ControlTabsProps = Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  items: readonly ControlTabItem[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  variant?: ControlTabVariant;
};

export function ControlTabs({
  items,
  activeId,
  onChange,
  ariaLabel,
  variant = 'rail',
  className,
  ...tabsProps
}: ControlTabsProps) {
  return (
    <div
      {...tabsProps}
      className={controlClassName('ef-control-tabs', primitiveModifier('ef-control-tabs', variant), className)}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            className={controlClassName('ef-control-tab', active && 'is-active')}
            onClick={() => onChange(item.id)}
          >
            <span>{item.label}</span>
            {item.count !== undefined ? <b>{item.count}</b> : null}
          </button>
        );
      })}
    </div>
  );
}

export type ControlTooltipProps = HTMLAttributes<HTMLSpanElement> & {
  trigger: ReactNode;
  content: ReactNode;
  placement?: ControlTooltipPlacement;
};

export function ControlTooltip({
  trigger,
  content,
  placement = 'top',
  className,
  ...tooltipProps
}: ControlTooltipProps) {
  const tooltipId = useId();
  return (
    <span
      {...tooltipProps}
      className={controlClassName('ef-control-tooltip', primitiveModifier('ef-control-tooltip', placement), className)}
      tabIndex={0}
      aria-describedby={tooltipId}
    >
      <span className="ef-control-tooltip__trigger">{trigger}</span>
      <span className="ef-control-tooltip__bubble" role="tooltip" id={tooltipId}>{content}</span>
    </span>
  );
}

export type ControlSkeletonProps = HTMLAttributes<HTMLSpanElement> & {
  shape?: ControlSkeletonShape;
  lines?: number;
  width?: CSSProperties['width'];
};

export function ControlSkeleton({
  shape = 'text',
  lines = 1,
  width,
  className,
  style,
  ...skeletonProps
}: ControlSkeletonProps) {
  const safeLines = Math.max(1, Math.min(lines, 12));
  const skeletonStyle = { ...style, '--ef-skeleton-width': width } as CSSProperties;
  return (
    <span
      {...skeletonProps}
      aria-hidden="true"
      className={controlClassName('ef-control-skeleton', primitiveModifier('ef-control-skeleton', shape), className)}
      style={skeletonStyle}
    >
      {Array.from({ length: safeLines }, (_, index) => <i key={index} />)}
    </span>
  );
}

export type ControlBannerProps = HTMLAttributes<HTMLDivElement> & {
  tone?: ControlStatusTone;
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
};

export function ControlBanner({
  tone = 'information',
  title,
  icon,
  actions,
  className,
  children,
  ...bannerProps
}: ControlBannerProps) {
  return (
    <div
      {...bannerProps}
      className={controlClassName('ef-control-banner', primitiveModifier('ef-control-banner', tone), className)}
    >
      <span className="ef-control-banner__rail" aria-hidden="true" />
      {icon ? <span className="ef-control-banner__icon" aria-hidden="true">{icon}</span> : null}
      <div className="ef-control-banner__copy">
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
      {actions ? <div className="ef-control-banner__actions">{actions}</div> : null}
    </div>
  );
}
