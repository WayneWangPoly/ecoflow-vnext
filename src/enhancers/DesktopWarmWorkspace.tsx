import { useEffect } from 'react';
import { loadAccountsStatementCustomers } from '@/data/repositories/accountsStatement';
import { loadCustomerStoreContacts, loadCustomerStoreDirectory, loadStoreCampaignHistory } from '@/data/repositories/customerStoreCenter';
import {
  loadOwnerStoreExperienceGaps,
  loadOwnerStoreReorderWatch,
  loadOwnerStoreSkuMix,
  loadOwnerStoreStatementSummary,
} from '@/data/repositories/storeIntelligence';

/**
 * Warms expensive desktop data without rendering hidden pages. Customer data
 * completes first; Accounts starts afterwards so the two heavy views never
 * compete for the same database statement budget during login.
 */
export function DesktopWarmWorkspace() {
  useEffect(() => {
    let cancelled = false;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await loadCustomerStoreDirectory();
          if (cancelled) return;
          await Promise.allSettled([
            loadOwnerStoreSkuMix(),
            loadOwnerStoreStatementSummary(),
            loadOwnerStoreReorderWatch(),
            loadOwnerStoreExperienceGaps(),
            loadCustomerStoreContacts(),
            loadStoreCampaignHistory(),
          ]);
        } catch {
          // Visible Customer workspace owns its retry and error state.
        }
        if (cancelled) return;
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        if (cancelled) return;
        try {
          await loadAccountsStatementCustomers();
        } catch {
          // Background warmup failures remain silent; visible Accounts can retry.
        }
      })();
    }, 700);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
