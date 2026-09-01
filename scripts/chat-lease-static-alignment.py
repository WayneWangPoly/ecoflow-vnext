from pathlib import Path

p = Path('scripts/unleashed-master-data-bridge-contract.test.mjs')
text = p.read_text()
replacements = {
    "  assert.match(edgeFunction, /COPY_RUN_LEASE_EXPIRED/);":
        "  assert.match(migration, /COPY_RUN_LEASE_EXPIRED/);",
    "  assert.match(edgeFunction, /failureStateLostLease = !updateError && !releasedAsset/);":
        "  assert.match(migration, /ecoflow_fail_unleashed_product_asset_copy/);",
    "  assert.match(edgeFunction, /\\.eq\\('asset_status', 'COPYING'\\)[\\s\\S]{0,120}\\.eq\\('claimed_in_run_id', run\\.id\\)/);":
        "  assert.match(edgeFunction, /rpc\\(\\s*'ecoflow_claim_unleashed_product_asset'/);",
    "  assert.match(edgeFunction, /\\.eq\\('id', run\\.id\\)\\.eq\\('status', 'RUNNING'\\)\\.select\\('\\*'\\)\\.maybeSingle\\(\\)/);":
        "  assert.match(edgeFunction, /rpc\\(\\s*'ecoflow_complete_unleashed_asset_copy_run'/);",
    "  assert.match(edgeFunction, /rpc\\('ecoflow_claim_unleashed_product_asset'/);":
        "  assert.match(edgeFunction, /rpc\\(\\s*'ecoflow_claim_unleashed_product_asset'/);",
    "  assert.match(edgeFunction, /rpc\\('ecoflow_commit_unleashed_product_asset_copy'/);":
        "  assert.match(edgeFunction, /rpc\\(\\s*'ecoflow_commit_unleashed_product_asset_copy'/);",
    "  assert.match(edgeFunction, /rpc\\('ecoflow_fail_unleashed_product_asset_copy'/);":
        "  assert.match(edgeFunction, /rpc\\(\\s*'ecoflow_fail_unleashed_product_asset_copy'/);",
    "  assert.match(edgeFunction, /rpc\\('ecoflow_expire_unleashed_asset_copy_run'/);":
        "  assert.match(edgeFunction, /rpc\\(\\s*'ecoflow_expire_unleashed_asset_copy_run'/);",
    "  assert.match(edgeFunction, /rpc\\('ecoflow_complete_unleashed_asset_copy_run'/);":
        "  assert.match(edgeFunction, /rpc\\(\\s*'ecoflow_complete_unleashed_asset_copy_run'/);",
}
for old, new in replacements.items():
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'static assertion replacement expected 1 match, found {count}: {old}')
    text = text.replace(old, new, 1)
p.write_text(text)
