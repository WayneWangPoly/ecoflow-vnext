from pathlib import Path

p = Path('scripts/audit-unleashed-master-data-bridge.mjs')
text = p.read_text()
old = """check(\n  'copy budget has a recoverable singleton lease',\n  /where status='RUNNING'/.test(migration)\n    && /claimed_in_run_id/.test(migration + edge)\n    && /COPY_RUN_LEASE_EXPIRED/.test(edge)\n    && /COPY_RUN_ALREADY_RUNNING/.test(edge),\n  'only one run can spend the aggregate budget; expired claims fail closed',\n);"""
new = """check(\n  'copy budget has a recoverable singleton lease',\n  /where status='RUNNING'/.test(migration)\n    && /claimed_in_run_id/.test(migration + edge)\n    && /COPY_RUN_LEASE_EXPIRED/.test(migration)\n    && /COPY_RUN_ALREADY_RUNNING/.test(edge)\n    && /ecoflow_claim_unleashed_product_asset/.test(migration + edge)\n    && /ecoflow_expire_unleashed_asset_copy_run/.test(migration + edge)\n    && /ecoflow_complete_unleashed_asset_copy_run/.test(migration + edge)\n    && /interval '15 minutes'/.test(migration)\n    && /for update/.test(migration),\n  'only one run can spend the aggregate budget; database-owned lease transitions serialize claims and stale expiry',\n);"""
count = text.count(old)
if count != 1:
    raise SystemExit(f'audit lease replacement expected 1 match, found {count}')
p.write_text(text.replace(old, new, 1))
