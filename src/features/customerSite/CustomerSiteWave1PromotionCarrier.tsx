import { useState } from 'react';
import type { Role } from '@/domain/types';
import {
  executeCustomerWave1Promotion,
  executeSiteWave1Promotion,
} from '@/data/repositories/customerSiteWave1Promotion';
import {
  CUSTOMER_SITE_WAVE1_PROMOTION,
  assertCustomerWave1PromotionResult,
  assertSiteWave1PromotionResult,
  customerSiteWave1Error,
  type CustomerWave1PromotionResult,
  type SiteWave1PromotionResult,
} from './customerSiteWave1PromotionContract';

type Props = { role: Role };

export function CustomerSiteWave1PromotionCarrier({ role }: Props) {
  const authorized = role === 'owner' || role === 'admin';
  const [busy, setBusy] = useState<'customer' | 'site' | null>(null);
  const [customerResult, setCustomerResult] = useState<CustomerWave1PromotionResult | null>(null);
  const [siteResult, setSiteResult] = useState<SiteWave1PromotionResult | null>(null);
  const [message, setMessage] = useState('No Customer/Site production command has run in this browser session.');

  if (!authorized) return null;

  const customer = CUSTOMER_SITE_WAVE1_PROMOTION.customer;
  const site = CUSTOMER_SITE_WAVE1_PROMOTION.site;
  const customerSatisfied = customerResult?.accepted === true && customerResult.status === 'PROMOTED';

  async function runCustomer() {
    const confirmed = window.confirm(
      `CUSTOMER WAVE-1 PRODUCTION BUSINESS MUTATION\n\nThis authenticated command promotes exactly ${customer.expectedPromotedCount} frozen AUTO Customers and preserves ${customer.expectedHoldCount} HOLD rows.\n\nCommand: ${customer.commandId}\nMembership: ${customer.expectedMembershipSha256}\nSource evidence: ${customer.expectedSourceEvidenceSha256}\n\nNo provider traffic, Site promotion, inventory, Product Identity, credit, price-group or route mutation is included.\n\nExecute or exactly-once replay this Customer command?`,
    );
    if (!confirmed) return;

    setBusy('customer');
    setMessage('Executing caller-authenticated Customer Wave-1 command…');
    try {
      const result = await executeCustomerWave1Promotion();
      assertCustomerWave1PromotionResult(result);
      setCustomerResult(result);
      setMessage(`Customer Wave-1 PASS · promoted ${result.customer_count} · HOLD ${result.held_customer_count} · replayed ${String(result.replayed)}. Site command is now eligible for separate confirmation.`);
    } catch (error) {
      setCustomerResult(null);
      setMessage(customerSiteWave1Error(error));
    } finally {
      setBusy(null);
    }
  }

  async function runSite() {
    if (!customerSatisfied) return;
    const confirmed = window.confirm(
      `SITE WAVE-1 PRODUCTION BUSINESS MUTATION\n\nCustomer Wave-1 has been proven in this browser session. This authenticated command promotes exactly ${site.expectedPromotedCount} frozen AUTO Sites, preserving ${site.expectedDuplicateParentHoldCount} duplicate-parent HOLD rows and ${site.expectedLocationHoldCount} location HOLD row.\n\nCommand: ${site.commandId}\nMembership: ${site.expectedMembershipSha256}\nSource evidence: ${site.expectedSourceEvidenceSha256}\n\nNo provider traffic, inventory, Product Identity, contact-name/phone inference, credit, price-group or route mutation is included.\n\nExecute or exactly-once replay this Site command?`,
    );
    if (!confirmed) return;

    setBusy('site');
    setMessage('Executing caller-authenticated Site Wave-1 command…');
    try {
      const result = await executeSiteWave1Promotion();
      assertSiteWave1PromotionResult(result);
      setSiteResult(result);
      setMessage(`Site Wave-1 PASS · promoted ${result.site_count} · duplicate-parent HOLD ${result.duplicate_parent_hold_count} · location HOLD ${result.location_hold_count} · replayed ${String(result.replayed)}.`);
    } catch (error) {
      setSiteResult(null);
      setMessage(customerSiteWave1Error(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="native-workspace-frame" aria-label="Customer and Site Wave-1 governed production promotion">
      <header className="native-workspace-header">
        <div>
          <span>OWNER / ADMIN · ECOFLOW-340B-2-R2P</span>
          <h2>Customer / Site Wave-1 governed promotion</h2>
          <p>This operator carrier never runs automatically. Production migration deployment remains a separate release authority. Every command is caller-authenticated, frozen, exactly-once and fail-closed on live evidence drift.</p>
        </div>
      </header>

      <div className="native-workspace-card">
        <h3>1. Customer Wave-1 · exactly 82 AUTO</h3>
        <p>Command <code>{customer.commandId}</code></p>
        <p>82 promoted · 8 duplicate purchaser HOLD · no Site/provider/inventory/Product Identity authority.</p>
        <button type="button" disabled={busy !== null || siteResult !== null} onClick={() => void runCustomer()}>
          {busy === 'customer' ? 'Executing Customer Wave-1…' : 'Execute / replay Customer Wave-1'}
        </button>
        {customerResult ? (
          <details>
            <summary>Customer machine acknowledgement</summary>
            <pre>{JSON.stringify(customerResult, null, 2)}</pre>
          </details>
        ) : null}
      </div>

      <div className="native-workspace-card">
        <h3>2. Site Wave-1 · exactly 71 AUTO</h3>
        <p>Command <code>{site.commandId}</code></p>
        <p>Locked until the frozen Customer command returns a valid PROMOTED acknowledgement in this session.</p>
        <button type="button" disabled={busy !== null || !customerSatisfied || siteResult !== null} onClick={() => void runSite()}>
          {busy === 'site' ? 'Executing Site Wave-1…' : customerSatisfied ? 'Execute / replay Site Wave-1' : 'Site Wave-1 locked'}
        </button>
        {siteResult ? (
          <details>
            <summary>Site machine acknowledgement</summary>
            <pre>{JSON.stringify(siteResult, null, 2)}</pre>
          </details>
        ) : null}
      </div>

      <p className="survey-reconciliation-message" role="status">{message}</p>
    </section>
  );
}
