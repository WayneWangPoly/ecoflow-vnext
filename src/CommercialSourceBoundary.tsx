import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { observeBody } from '@/lib/domObserver';
import {
  DATA_FLOW_STATEMENT,
  ECOFLOW_OPERATIONAL_DOMAINS,
  ORDERMENTUM_SOURCE_DOMAINS,
} from '@/domain/dataOwnership';

function ensureNotice(parent: Element, key: string, text: string, tone: 'source' | 'operational' = 'source') {
  if (parent.querySelector(`[data-source-boundary="${key}"]`)) return;
  const notice = document.createElement('div');
  notice.className = `source-boundary-inline source-boundary-inline-${tone}`;
  notice.dataset.sourceBoundary = key;
  notice.textContent = text;
  parent.prepend(notice);
}

function hideCommercialMutationControls() {
  const priceMount = document.querySelector<HTMLElement>('.price-matrix-workbench-mount');
  if (priceMount) priceMount.hidden = true;

  document.querySelectorAll<HTMLElement>('.owner-store-action-panel').forEach((panel) => {
    panel.hidden = true;
    const detail = panel.closest<HTMLElement>('.owner-store-detail');
    if (detail) ensureNotice(
      detail,
      'store-master-readonly',
      'ORDERMENTUM MANAGED · Store name, address, phone, delivery instructions and price group are read-only in EcoFlow. Correct them in Ordermentum and run the store mirror.',
    );
  });

  document.querySelectorAll<HTMLElement>('.accounts-form-card').forEach((card) => {
    const heading = card.querySelector('h4')?.textContent?.trim().toLowerCase();
    if (heading === 'record payment') card.hidden = true;
  });

  document.querySelectorAll<HTMLElement>('.accounts-history-grid > div').forEach((section) => {
    const heading = section.querySelector('h4')?.textContent?.trim().toLowerCase();
    if (heading === 'payment history') section.hidden = true;
  });

  document.querySelectorAll<HTMLElement>('.inventory-action-row').forEach((row) => {
    const button = row.querySelector('button');
    if (button?.textContent?.trim().toLowerCase().includes('set status')) row.hidden = true;
  });

  const inventoryActions = document.querySelector<HTMLElement>('.inventory-action-panel');
  if (inventoryActions) ensureNotice(
    inventoryActions,
    'inventory-source-status-readonly',
    'SOURCE SKU STATUS IS READ ONLY · Activate, discontinue or rename a commercial SKU in Ordermentum. EcoFlow may still control shelf, local scan barcode, reorder target, stock estimate and warehouse notes.',
  );

  const accountsGrid = document.querySelector<HTMLElement>('.accounts-commercial-grid');
  if (accountsGrid) ensureNotice(
    accountsGrid,
    'accounts-payment-readonly',
    'PAYMENTS ARE SOURCE FACTS · Mark payments, payment methods and invoice corrections in Ordermentum. EcoFlow statements and collection workflow refresh from the mirrored invoice balance.',
  );

  const accountsHero = document.querySelector<HTMLElement>('.accounts-hero');
  if (accountsHero) ensureNotice(accountsHero, 'accounts-mirror', 'VERIFIED ORDERMENTUM FINANCE MIRROR · EcoFlow does not create substitute invoice or payment facts.');

  const storeHero = document.querySelector<HTMLElement>('.owner-store-hero');
  if (storeHero) ensureNotice(storeHero, 'store-mirror', 'ORDERMENTUM CUSTOMER MIRROR · Commercial customer fields are source-owned and read-only here.');

  const inventoryMaster = document.querySelector<HTMLElement>('.inventory-master-catalog');
  if (inventoryMaster) ensureNotice(inventoryMaster, 'catalog-mirror', 'ORDERMENTUM CATALOG MIRROR · Product identity, SKU status and selling price come from Ordermentum. Shelf, stock and local barcode verification remain EcoFlow operations.');

  const releasePanel = document.querySelector<HTMLElement>('.sync-panel');
  if (releasePanel) ensureNotice(releasePanel, 'release-boundary', 'RELEASE CONTROL · Source order facts are read-only. This workspace may only create and release EcoFlow internal work after validation.');

  document.querySelectorAll<HTMLElement>('.owner-store-bottom-grid h3').forEach((heading) => {
    if (heading.textContent?.trim() === 'Owner customer action list') heading.textContent = 'Ordermentum source attention';
  });
  document.querySelectorAll<HTMLElement>('.owner-store-bottom-grid p').forEach((paragraph) => {
    if (paragraph.textContent?.includes('Address, tier')) paragraph.textContent = 'Address, price-group and source-master gaps to correct in Ordermentum.';
  });

  document.querySelectorAll<HTMLElement>('.accounts-panel header p').forEach((paragraph) => {
    if (paragraph.textContent?.includes('payments recorded in EcoFlow')) paragraph.textContent = 'Balances come from the latest mirrored Ordermentum invoice and payment status.';
    if (paragraph.textContent?.includes('after payment allocation')) paragraph.textContent = 'Collection and statement actions based on the mirrored amount due.';
  });
}

function OwnershipColumn({ title, system, rows }: {
  title: string;
  system: 'ORDERMENTUM' | 'ECOFLOW';
  rows: typeof ORDERMENTUM_SOURCE_DOMAINS;
}) {
  return (
    <section className={`source-boundary-column source-boundary-column-${system.toLowerCase()}`}>
      <header><span>{system}</span><h3>{title}</h3></header>
      <div>
        {rows.map((domain) => (
          <article key={domain.key}>
            <strong>{domain.label}</strong>
            <span>{domain.examples}</span>
            <small>{domain.changeRule}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function DataOwnershipPanel() {
  return (
    <section className="panel source-boundary-panel">
      <div className="source-boundary-hero">
        <div>
          <span>DATA OWNERSHIP · ONE-WAY CONTRACT</span>
          <h2>One commercial source. One operational system.</h2>
          <p>{DATA_FLOW_STATEMENT}</p>
        </div>
        <div className="source-boundary-direction"><b>ORDERMENTUM</b><i>→</i><b>ECOFLOW MIRROR</b><i>→</i><b>OPERATIONS</b></div>
      </div>
      <div className="source-boundary-grid">
        <OwnershipColumn title="Commercial facts — read-only mirror" system="ORDERMENTUM" rows={ORDERMENTUM_SOURCE_DOMAINS} />
        <OwnershipColumn title="Physical and workflow facts — EcoFlow controlled" system="ECOFLOW" rows={ECOFLOW_OPERATIONAL_DOMAINS} />
      </div>
      <div className="source-boundary-rule">
        <strong>Deletion and correction rule</strong>
        <span>EcoFlow never physically deletes mirrored history. A source record that disappears is retained as SOURCE_MISSING, removed from release eligibility and preserved for audit.</span>
      </div>
    </section>
  );
}

function useSettingsHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => observeBody(() => {
    hideCommercialMutationControls();
    const operatingRules = Array.from(document.querySelectorAll<HTMLElement>('.settings-panel h2'))
      .find((heading) => heading.textContent?.trim() === 'Operating rules')
      ?.closest<HTMLElement>('.panel');
    if (!operatingRules) { setHost(null); return; }
    let mount = document.querySelector<HTMLElement>('.source-boundary-settings-mount');
    if (!mount) {
      mount = document.createElement('section');
      mount.className = 'source-boundary-settings-mount';
      operatingRules.insertAdjacentElement('beforebegin', mount);
    }
    setHost(mount);
  }), []);
  return host;
}

export function CommercialSourceBoundary() {
  const host = useSettingsHost();
  useEffect(() => observeBody(hideCommercialMutationControls), []);
  return host ? createPortal(<DataOwnershipPanel />, host) : null;
}
