import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `${label}: expected source block was not found`);
  assert.equal(source.indexOf(before, first + before.length), -1, `${label}: source block is not unique`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const path = 'src/app/App.tsx';
let source = readFileSync(path, 'utf8');

source = replaceOnce(
  source,
  "import { OrdersControlPage } from '@/features/orders/OrdersControlPage';",
  "import { OrdersControlPage } from '@/features/orders/OrdersControlPage';\nimport { DeliveryDispatchCommandSurface } from '@/features/delivery/DeliveryDispatchCommandSurface';",
  'Delivery dispatch surface import',
);

source = replaceOnce(
  source,
`      <section className="quick-stats">
        <MetricCard label={\`RUN \${day.runCode} RELEASED\`} value={stops.length} tone="green" helper={businessDay.label} />
        <MetricCard label="ROUTE" value={day.pick ? \`Locked \${formatClockTime(day.pick.lockedAt)}\` : 'Office planning'} tone="gold" helper={day.routeStartedAt ? \`started \${formatClockTime(day.routeStartedAt)}\` : 'Owner/office approves order'} />
        <MetricCard label="STAGED" value={\`\${stagedCount}/\${stops.length}\`} tone="blue" helper="warehouse progress" />
        <MetricCard label="DELIVERED" value={\`\${deliveredCount}\${failedCount ? \` · \${failedCount} failed\` : ''}\`} tone="mint" helper={day.routeEndedAt ? \`run finished \${formatClockTime(day.routeEndedAt)}\` : 'live from driver'} />
      </section>`,
`      <section className="quick-stats">
        <MetricCard label={\`RUN \${day.runCode} RELEASED\`} value={stops.length} tone="green" helper={businessDay.label} />
        <MetricCard label="ROUTE" value={day.pick ? \`Locked \${formatClockTime(day.pick.lockedAt)}\` : 'Office planning'} tone="gold" helper={day.routeStartedAt ? \`started \${formatClockTime(day.routeStartedAt)}\` : 'Owner/office approves order'} />
        <MetricCard label="STAGED" value={\`\${stagedCount}/\${stops.length}\`} tone="blue" helper="warehouse progress" />
        <MetricCard label="DELIVERED" value={\`\${deliveredCount}\${failedCount ? \` · \${failedCount} failed\` : ''}\`} tone="mint" helper={day.routeEndedAt ? \`run finished \${formatClockTime(day.routeEndedAt)}\` : 'live from driver'} />
      </section>
      <DeliveryDispatchCommandSurface
        runCode={day.runCode}
        businessDayLabel={businessDay.label}
        stops={stops}
        warehousePoint={run.warehousePoint}
        day={day}
        assignedDriverLabel={lockedRouteRecord?.assignedDriverLabel || dispatchDrivers.find((driver) => driver.userId === assignedDriverUserId)?.label || ''}
      />`,
  'Delivery dispatch command surface mount',
);

writeFileSync(path, source);
console.log('TRANSFORM-006 dispatch command surface mounted.');
