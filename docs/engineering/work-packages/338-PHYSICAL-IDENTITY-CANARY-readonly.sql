-- Read-only evidence inventory. No auth impersonation or mutating RPC.
begin transaction read only;
select a.external_product_code, p.commercial_sku_id, o.id as observation_id,
       o.carton_barcode, o.sleeve_status, o.sleeve_barcode,
       o.evidence_source, o.note, o.sku_product_name,
       o.request_fingerprint, o.occurred_at, r.reconciliation_status
from public.ecoflow_bounded_commercial_sku_promotion_allowlist a
join public.ecoflow_bounded_commercial_sku_promotions p using(external_product_code)
left join public.ecoflow_barcode_survey_observations o
  on o.sku_context=a.external_product_code
left join public.ecoflow_barcode_survey_identity_reconciliations r
  on r.survey_observation_id=o.id
where a.promotion_phase='AFTER_CANARY'
order by a.external_product_code,o.id;

select id,batch_name,batch_status,revision
from public.ecoflow_product_identity_batches
where batch_status in ('DRAFT','SUBMITTED');

select o.id,o.carton_barcode,o.sleeve_status,o.sleeve_barcode,o.evidence_source
from public.ecoflow_barcode_survey_observations o
where o.sku_context='CCSB6-80'
order by o.id;
rollback;
