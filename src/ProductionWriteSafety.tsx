import { useEffect, useMemo, useState } from 'react';
import { observeBody } from '@/lib/domObserver';
import { hasSupabaseAuthClient } from '@/lib/supabaseClient';

const writePattern = /receive|complete|post stock|save\s*\+|release|internalise|pick(ed)?|stage|loaded|delivered|confirm|start route|take on run|adjust|return to stock/i;
const safePattern = /logout|reload|refresh|back|inventory|map|previous|next|search|find|close|cancel/i;
const permanentlyBlockedPattern = /internalise eligible|create internal orders/i;
/** Pure navigation containers - a "Pick" tab is not a write action even though the label matches. */
const NAVIGATION_SCOPE = '.driver-nav, .mobile-tabs, .sidebar-nav, .pick-view-toggle, .view-toggle, .inbox-tabs, .order-platform-mode-tabs, .owner-window-toggle, .stops-toolbar';

function buttonLabel(button: HTMLButtonElement) {
  return button.textContent?.trim() || button.getAttribute('aria-label') || '';
}

function writeButtons() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter((button) => {
    if (button.closest(NAVIGATION_SCOPE)) return false;
    const label = buttonLabel(button);
    return writePattern.test(label) && !safePattern.test(label);
  });
}

function blockedInternalOrderButtons() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .filter((button) => permanentlyBlockedPattern.test(buttonLabel(button)));
}

function liveDataError() {
  const banners = Array.from(document.querySelectorAll<HTMLElement>('.sync-error-banner, .warehouse-error-strip'));
  return banners.find((banner) => /fallback|demo|failed to load|not available|schema pending/i.test(banner.textContent || ''))?.textContent?.trim() || '';
}

export function ProductionWriteSafety() {
  const hardLock = useMemo(() => import.meta.env.PROD && !hasSupabaseAuthClient(), []);
  const [dataError, setDataError] = useState('');

  useEffect(() => {
    function apply() {
      blockedInternalOrderButtons().forEach((button) => {
        button.disabled = true;
        button.hidden = true;
        button.setAttribute('aria-hidden', 'true');
        button.title = 'Bulk internal-order creation is unavailable. Orders must be reviewed individually before any future write workflow is enabled.';
        button.dataset.productionSafetyDisabled = 'permanent';
      });

      if (!import.meta.env.PROD) return;
      const error = hardLock ? 'Secure Supabase access is not configured for this production build.' : liveDataError();
      setDataError(error);
      const locked = Boolean(error);
      document.body.classList.toggle('ecoflow-production-write-locked', locked);

      writeButtons().forEach((button) => {
        if (button.dataset.productionSafetyDisabled === 'permanent') return;
        if (locked) {
          if (!button.dataset.productionSafetyDisabled) {
            button.dataset.productionSafetyDisabled = button.disabled ? 'already' : 'safety';
          }
          button.disabled = true;
          button.title = 'Write actions are locked until live operational data is available.';
        } else if (button.dataset.productionSafetyDisabled === 'safety') {
          button.disabled = false;
          delete button.dataset.productionSafetyDisabled;
          button.title = '';
        }
      });
    }

    const stopObserving = observeBody(apply);
    const timer = window.setInterval(apply, 3000);
    return () => {
      stopObserving();
      window.clearInterval(timer);
    };
  }, [hardLock]);

  if (!import.meta.env.PROD || !dataError) return null;
  return (
    <div className="production-write-lock-banner" role="alert">
      <strong>Read-only safety mode</strong>
      <span>{dataError} Operational writes are disabled; no fallback data can be posted as live work.</span>
    </div>
  );
}
