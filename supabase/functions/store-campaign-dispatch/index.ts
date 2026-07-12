// Supabase Edge Function: store-campaign-dispatch
// Owner/Admin-only customer campaign sender. The browser supplies store IDs and
// content, never recipient addresses. Recipients are resolved server-side from
// the protected store contact master and each store receives a separate email.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Body = {
  storeIds?: string[];
  campaignName?: string;
  subject?: string;
  bodyText?: string;
};

type StoreRow = {
  retailer_id: string;
  store_name: string;
};

type ContactRow = {
  retailer_id: string | null;
  store_key: string;
  store_name: string;
  contact_email: string | null;
  contact_name: string | null;
  enabled: boolean;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function clean(value: unknown) {
  return String(value ?? '').trim();
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function personalised(value: string, store: StoreRow, contact?: ContactRow) {
  return value
    .replaceAll('{{store_name}}', store.store_name)
    .replaceAll('{{contact_name}}', clean(contact?.contact_name) || store.store_name);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json(500, { error: 'MISSING_SUPABASE_FUNCTION_SECRETS' });

  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'MISSING_BEARER_TOKEN' });

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json(401, { error: 'INVALID_SESSION', details: userError?.message });

  const actor = userData.user;
  const { data: profile, error: profileError } = await admin
    .from('app_user_profiles')
    .select('user_id,email,display_name,app_role,is_active,team_status')
    .eq('user_id', actor.id)
    .maybeSingle();
  if (profileError) return json(500, { error: 'ACTOR_PROFILE_LOOKUP_FAILED', details: profileError.message });
  if (!profile || !profile.is_active || profile.team_status !== 'ACTIVE' || !['OWNER', 'ADMIN'].includes(profile.app_role)) {
    return json(403, { error: 'OWNER_OR_ADMIN_REQUIRED' });
  }

  let body: Body;
  try { body = await req.json(); } catch { return json(400, { error: 'INVALID_JSON_BODY' }); }

  const storeIds = [...new Set((body.storeIds ?? []).map(clean).filter(Boolean))].slice(0, 250);
  const campaignName = clean(body.campaignName) || 'Customer update';
  const subject = clean(body.subject);
  const bodyText = clean(body.bodyText);
  if (!storeIds.length) return json(400, { error: 'STORE_SELECTION_REQUIRED' });
  if (!subject || subject.length > 180) return json(400, { error: 'VALID_SUBJECT_REQUIRED' });
  if (!bodyText || bodyText.length > 12000) return json(400, { error: 'VALID_BODY_REQUIRED' });

  const { data: storesData, error: storesError } = await admin
    .from('ecoflow_store_sites')
    .select('retailer_id,store_name')
    .in('retailer_id', storeIds);
  if (storesError) return json(500, { error: 'STORE_LOOKUP_FAILED', details: storesError.message });
  const stores = (storesData ?? []) as StoreRow[];
  if (!stores.length) return json(404, { error: 'STORES_NOT_FOUND' });

  const { data: contactsData, error: contactsError } = await admin
    .from('ecoflow_delivery_notification_contacts')
    .select('retailer_id,store_key,store_name,contact_email,contact_name,enabled')
    .in('retailer_id', stores.map((store) => store.retailer_id));
  if (contactsError) return json(500, { error: 'CONTACT_LOOKUP_FAILED', details: contactsError.message });
  const contacts = (contactsData ?? []) as ContactRow[];
  const contactByStore = new Map(contacts.filter((row) => row.retailer_id).map((row) => [String(row.retailer_id), row]));

  const { data: campaign, error: campaignError } = await admin
    .from('ecoflow_store_email_campaigns')
    .insert({
      campaign_name: campaignName,
      subject,
      body_text: bodyText,
      status: 'SENDING',
      selected_store_count: storeIds.length,
      created_by: actor.id,
    })
    .select('id')
    .single();
  if (campaignError || !campaign) return json(500, { error: 'CAMPAIGN_CREATE_FAILED', details: campaignError?.message });

  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const fromEmail = Deno.env.get('DELIVERY_FROM_EMAIL');
  const replyTo = Deno.env.get('DELIVERY_REPLY_TO_EMAIL') || undefined;
  const senderName = Deno.env.get('DELIVERY_FROM_NAME') || 'EcoFlow Packaging';

  let recipientCount = 0;
  let sent = 0;
  let missingContact = 0;
  let disabled = 0;
  let failed = 0;
  let configurationRequired = 0;
  const deliveryRows: Array<Record<string, unknown>> = [];

  for (const store of stores) {
    const contact = contactByStore.get(String(store.retailer_id));
    const recipient = clean(contact?.contact_email).toLowerCase() || null;
    let status = 'PENDING';
    let providerError: string | null = null;
    let providerMessageId: string | null = null;
    let sentAt: string | null = null;

    if (contact?.enabled === false) {
      status = 'SKIPPED_DISABLED';
      disabled += 1;
    } else if (!recipient) {
      status = 'MISSING_CONTACT';
      missingContact += 1;
    } else if (!resendApiKey || !fromEmail) {
      status = 'CONFIGURATION_REQUIRED';
      providerError = 'RESEND_API_KEY and DELIVERY_FROM_EMAIL must be configured.';
      configurationRequired += 1;
      failed += 1;
    } else {
      recipientCount += 1;
      const personalisedSubject = personalised(subject, store, contact);
      const personalisedBody = personalised(bodyText, store, contact);
      const greetingName = clean(contact?.contact_name) || `${store.store_name} team`;
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#17362b;line-height:1.6">
          <div style="border-bottom:4px solid #1f6b4f;padding:18px 0"><strong style="font-size:22px">EcoFlow Packaging</strong></div>
          <p style="margin-top:28px">Hi ${escapeHtml(greetingName)},</p>
          <div style="white-space:pre-wrap">${escapeHtml(personalisedBody)}</div>
          <p style="margin-top:30px">Kind regards,<br>EcoFlow Packaging</p>
        </div>`;
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: `${senderName} <${fromEmail}>`,
            to: [recipient],
            subject: personalisedSubject,
            html,
            reply_to: replyTo,
            tags: [{ name: 'event', value: 'store_campaign' }, { name: 'campaign_id', value: String(campaign.id).replaceAll('-', '_') }],
          }),
        });
        const responseText = await response.text();
        let payload: Record<string, unknown> = {};
        try { payload = responseText ? JSON.parse(responseText) : {}; } catch { payload = { raw: responseText }; }
        if (!response.ok) throw new Error(`Email provider ${response.status}: ${responseText.slice(0, 500)}`);
        status = 'SENT';
        providerMessageId = clean(payload.id) || null;
        sentAt = new Date().toISOString();
        sent += 1;
      } catch (sendError) {
        status = 'FAILED';
        providerError = sendError instanceof Error ? sendError.message : String(sendError);
        failed += 1;
      }
    }

    deliveryRows.push({
      campaign_id: campaign.id,
      store_id: String(store.retailer_id),
      store_name: store.store_name,
      recipient_email: recipient,
      status,
      provider_message_id: providerMessageId,
      provider_error: providerError,
      requested_at: new Date().toISOString(),
      sent_at: sentAt,
    });
  }

  if (deliveryRows.length) {
    const { error: deliveryError } = await admin.from('ecoflow_store_email_deliveries').insert(deliveryRows);
    if (deliveryError) failed += deliveryRows.length;
  }

  const finalStatus = configurationRequired && !sent
    ? 'CONFIGURATION_REQUIRED'
    : failed || missingContact || disabled
      ? (sent ? 'PARTIAL' : 'FAILED')
      : 'COMPLETED';
  const providerSummary = { requested: storeIds.length, storesFound: stores.length, recipientCount, sent, missingContact, disabled, failed, configurationRequired };
  await admin
    .from('ecoflow_store_email_campaigns')
    .update({
      status: finalStatus,
      recipient_count: recipientCount,
      sent_count: sent,
      missing_contact_count: missingContact,
      disabled_count: disabled,
      failed_count: failed,
      completed_at: new Date().toISOString(),
      provider_summary: providerSummary,
    })
    .eq('id', campaign.id);

  return json(200, { ok: finalStatus === 'COMPLETED' || finalStatus === 'PARTIAL', campaignId: campaign.id, status: finalStatus, ...providerSummary });
});
