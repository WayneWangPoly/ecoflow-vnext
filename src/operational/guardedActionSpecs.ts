export type GuardedAction = {
  title: string;
  actionLabel: string;
  entity: string;
  count: number;
  objects: string[];
  impacts: string[];
  confirmToken?: string;
  suppressNativeConfirm?: boolean;
  requireExactObjects?: boolean;
};

export function cleanOperationalText(value?: string | null) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values: string[]) {
  return [...new Set(values.map(cleanOperationalText).filter(Boolean))];
}

function firstText(root: Element | null, selectors: string) {
  return cleanOperationalText(root?.querySelector<HTMLElement>(selectors)?.textContent);
}

function selectedOrderObjects(root: Element | null) {
  if (!root) return [];
  return unique(
    Array.from(root.querySelectorAll<HTMLInputElement>('.order-list-item input[type="checkbox"]:checked'))
      .map((input) => firstText(input.closest('.order-list-item'), '.order-main-copy strong')),
  );
}

function routeStopObjects(root: Element | null) {
  if (!root) return [];
  return unique(Array.from(root.querySelectorAll<HTMLElement>('.stop-row strong')).map((node) => node.textContent || ''));
}

function accountsContext(button: HTMLButtonElement) {
  const detail = button.closest<HTMLElement>('.accounts-detail');
  const actionCard = button.closest<HTMLElement>('.accounts-action-card');
  if (!detail || !actionCard) return null;
  const customer = firstText(detail, '.accounts-detail-hero h3') || 'Selected customer';
  const note = actionCard.querySelector<HTMLTextAreaElement>('textarea')?.value.trim() || '';
  return { detail, customer, note };
}

export function guardedForm(form: HTMLFormElement) {
  return Boolean(form.closest('.desktop-app')) && form.matches('.team-create-row, .team-password-row');
}

export function guardedButtonSpec(button: HTMLButtonElement): GuardedAction | null {
  if (!button.closest('.desktop-app')) return null;

  const label = cleanOperationalText(button.textContent || button.getAttribute('aria-label'));
  if (!label || button.disabled) return null;
  if (button.type === 'submit' && button.form && guardedForm(button.form)) return null;

  if (/^release to run$/i.test(label)) {
    const row = button.closest<HTMLElement>('.table-row');
    if (!row?.closest('.inbox-table-like')) return null;
    const order = firstText(row, 'span:first-child strong') || 'Selected order';
    const store = firstText(row, 'span:nth-child(2) strong');
    return {
      title: 'Release order to today’s run',
      actionLabel: 'Release to run',
      entity: order,
      count: 1,
      objects: [store ? `${order} · ${store}` : order],
      impacts: [
        'The order becomes visible to warehouse picking and route planning.',
        'This does not deduct stock or start the driver route.',
      ],
      requireExactObjects: true,
    };
  }

  const releaseMatch = label.match(/^release\s+(\d+)$/i);
  if (releaseMatch) {
    const panel = button.closest<HTMLElement>('.panel');
    if (!panel || !/^release queue$/i.test(firstText(panel, '.panel-head h2'))) return null;
    const count = Number(releaseMatch[1]);
    return {
      title: 'Release selected orders to today’s run',
      actionLabel: label,
      entity: `${count} selected orders`,
      count,
      objects: selectedOrderObjects(panel),
      impacts: [
        'Every listed order enters the shared warehouse and delivery run.',
        'Only orders already passing the release gate are included.',
      ],
      confirmToken: count > 1 ? `RELEASE ${count}` : undefined,
      requireExactObjects: true,
    };
  }

  if (/^(approve\s*&\s*)?lock route$/i.test(label)) {
    const panel = button.closest<HTMLElement>('.panel');
    if (!panel || !/^office route approval$/i.test(firstText(panel, '.panel-head h2'))) return null;
    const objects = routeStopObjects(panel);
    return {
      title: 'Approve and lock the warehouse route',
      actionLabel: label,
      entity: objects.length ? `${objects.length} stops` : 'Current delivery run',
      count: objects.length,
      objects,
      impacts: [
        'Stop order and box codes become the shared picking plan.',
        'Labels printed after this point depend on the locked order.',
      ],
      requireExactObjects: true,
    };
  }

  if (/^(unlock before picking|unlock(?: route)?)$/i.test(label)) {
    const panel = button.closest<HTMLElement>('.panel');
    if (!panel || !/^office route approval$/i.test(firstText(panel, '.panel-head h2'))) return null;
    const objects = routeStopObjects(panel);
    return {
      title: 'Unlock the current route',
      actionLabel: label,
      entity: objects.length ? `${objects.length} stops` : 'Current delivery run',
      count: objects.length || 1,
      objects,
      impacts: [
        'Printed labels become invalid and must be reprinted.',
        'Unlocking is blocked after picking, staging or route execution has started.',
      ],
      confirmToken: 'UNLOCK',
      suppressNativeConfirm: true,
    };
  }

  if (/^start next delivery run$/i.test(label)) {
    const panel = button.closest<HTMLElement>('.panel');
    const title = firstText(panel, 'h2');
    if (!panel || !/^run\s+.+\s+completed$/i.test(title)) return null;
    return {
      title: 'Start the next delivery run',
      actionLabel: label,
      entity: title,
      count: 1,
      objects: [],
      impacts: [
        'The completed run remains in server history.',
        'Newly released orders will belong to the new run code.',
      ],
      confirmToken: 'NEXT RUN',
      suppressNativeConfirm: true,
    };
  }

  if (/^generate\s*&\s*send$/i.test(label)) {
    const detail = button.closest<HTMLElement>('.accounts-detail');
    if (!detail) return null;
    const customer = firstText(detail, '.accounts-detail-hero h3') || 'Selected customer';
    const email = (detail.querySelector<HTMLInputElement>('input[type="email"]')?.value || '').trim();
    const dates = Array.from(detail.querySelectorAll<HTMLInputElement>('input[type="date"]'))
      .map((input) => input.value)
      .filter(Boolean);
    return {
      title: 'Generate and send customer statement',
      actionLabel: label,
      entity: customer,
      count: 1,
      objects: [
        email || 'No recipient email',
        dates.length === 2 ? `${dates[0]} → ${dates[1]}` : 'Selected statement period',
      ],
      impacts: [
        'A statement snapshot and PDF will be created.',
        'The email dispatch is attempted immediately after generation.',
      ],
    };
  }

  if (/^(promise|dispute|hold|clear hold)$/i.test(label)) {
    const context = accountsContext(button);
    if (!context) return null;
    const { customer, note } = context;
    if (/^promise$/i.test(label)) {
      return {
        title: 'Record promise to pay',
        actionLabel: label,
        entity: customer,
        count: 1,
        objects: [note || 'Promise to pay recorded'],
        impacts: [
          'This becomes the latest auditable Accounts action for the customer.',
          'It does not change the Ordermentum invoice balance or record a payment.',
        ],
      };
    }
    if (/^dispute$/i.test(label)) {
      return {
        title: 'Record customer account dispute',
        actionLabel: label,
        entity: customer,
        count: 1,
        objects: [note || 'Dispute raised'],
        impacts: [
          'This records a formal dispute in the EcoFlow Accounts history.',
          'It does not alter the source invoice amount in Ordermentum.',
        ],
      };
    }
    if (/^hold$/i.test(label)) {
      return {
        title: 'Place customer account on operational hold',
        actionLabel: label,
        entity: customer,
        count: 1,
        objects: [note || 'Operational release hold recorded'],
        impacts: [
          'This customer becomes ON HOLD in the Accounts work queue.',
          'The hold remains the active Accounts priority until a later action clears it.',
        ],
        confirmToken: 'HOLD',
      };
    }
    return {
      title: 'Clear customer operational hold',
      actionLabel: label,
      entity: customer,
      count: 1,
      objects: [note || 'Operational release hold cleared'],
      impacts: [
        'The latest ON HOLD marker is cleared for this customer.',
        'Accounts priority is recalculated from the current invoice and overdue state.',
      ],
      confirmToken: 'CLEAR HOLD',
    };
  }

  if (/^(suspend|activate)$/i.test(label)) {
    const entry = button.closest<HTMLElement>('.team-account-entry');
    if (!entry) return null;
    const email = firstText(entry, '.team-account-row small') || firstText(entry, '.team-account-row strong') || 'Selected account';
    const suspend = /^suspend$/i.test(label);
    return {
      title: suspend ? 'Suspend team account' : 'Activate team account',
      actionLabel: label,
      entity: email.replace(/\s*·\s*YOU$/i, ''),
      count: 1,
      objects: [],
      impacts: [
        suspend ? 'The user will lose application access.' : 'The user will regain application access.',
        'The account record and audit history remain available.',
      ],
      confirmToken: suspend ? 'SUSPEND' : undefined,
    };
  }

  return null;
}

export function guardedFormSpec(form: HTMLFormElement): GuardedAction | null {
  if (!guardedForm(form)) return null;
  if (form.matches('.team-create-row')) {
    const email = form.querySelector<HTMLInputElement>('input[type="email"]')?.value.trim() || 'New account';
    const role = form.querySelector<HTMLSelectElement>('select')?.value || 'Role pending';
    return {
      title: 'Create team login',
      actionLabel: 'Create account',
      entity: email,
      count: 1,
      objects: [role],
      impacts: [
        'The login can access EcoFlow immediately with the selected role.',
        'The email is an internal login identifier and does not need a working inbox.',
      ],
    };
  }
  if (form.matches('.team-password-row')) {
    const email = firstText(form, 'strong').replace(/^new password for\s+/i, '') || 'Selected account';
    return {
      title: 'Reset team account password',
      actionLabel: 'Save password',
      entity: email,
      count: 1,
      objects: [],
      impacts: [
        'The previous password stops working immediately.',
        'Existing access role and account history are unchanged.',
      ],
    };
  }
  return null;
}

export function guardedRoleChangeSpec(
  select: HTMLSelectElement,
  previousRole: string,
  nextRole: string,
): GuardedAction {
  const entry = select.closest('.team-account-entry');
  const email = firstText(entry, '.team-account-row small') || firstText(entry, '.team-account-row strong') || 'Selected account';
  return {
    title: 'Change team role',
    actionLabel: `${previousRole} → ${nextRole}`,
    entity: email.replace(/\s*·\s*YOU$/i, ''),
    count: 1,
    objects: [`Current: ${previousRole}`, `New: ${nextRole}`],
    impacts: [
      'Navigation, read access and write permissions change immediately.',
      'The account remains active unless its status is changed separately.',
    ],
    confirmToken: nextRole === 'OWNER' ? 'OWNER' : undefined,
  };
}
