import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseAuthClient } from '@/lib/supabaseClient';

const writePattern = /receive|complete|post stock|save\s*\+|release|internalise|pick(ed)?|stage|loaded|delivered|confirm|start route|take on run|adjust|return to stock/i;
const safePattern = /logout|reload|refresh|back|inventory|map|previous|next|search|find|close|cancel/i;

function writeButtons() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter((button) => {
    const label = button.textContent?.trim() || button.getAttribute('aria-label') || '';
    return writePattern.test(label) && !safePattern.test(label);
  });
}

function liveDataError() {
  const banners = Array.from(document.querySelectorAll<HTMLElement>('.sync-error-banner, .warehouse-error-strip'));
  return banners.find((banner) => /fallback|demo|failed to load|not available|schema pending/i.test(banner.textContent || ''))?.textContent?.trim() || '';
}

export function ProductionWriteSafety() {
  const hardLock = useMemo(() => import.meta.env.PROD && !hasSupabaseAuthClient(), []);
  const [dataError, setDataError] = useState('');

  useEffect(() => {
    if (!import.meta.env.PROD) return;

    function apply() {
      const error = hardLock ? 'Secure Supabase access is not configured for this production build.' : liveDataError();
      setDataError(error);
      const locked = Boolean(error);
      document.body.classList.toggle('ecoflow-production-write-locked', locked);

      writeButtons().forEach((button) => {
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

    apply();
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      window.setTimeout(() => {
        pending = false;
        apply();
      }, 120);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'disabled'] });
    const timer = window.setInterval(apply, 1200);
    return () => {
      observer.disconnect();
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
