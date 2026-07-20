import { useEffect } from 'react';
import { loadAccountsStatementCustomers } from '@/data/repositories/accountsStatement';
import { loadCustomerStoreDirectory } from '@/data/repositories/customerStoreCenter';

/**
 * Warms the two expensive desktop directories without rendering hidden pages.
 * Requests are sequential so Customer and Accounts never compete for the same
 * database statement budget during login.
 */
export function DesktopWarmWorkspace() {
  useEffect(() => {
    let cancelled = false;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          await loadCustomerStoreDirectory();
        } catch {
          // Visible workspaces retain their own error and retry handling.
        }
        if (cancelled) return;
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        if (cancelled) return;
        try {
          await loadAccountsStatementCustomers();
        } catch {
          // Do not surface background warmup failures as page errors.
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
