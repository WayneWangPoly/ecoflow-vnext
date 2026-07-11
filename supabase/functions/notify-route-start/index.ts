// Supabase Edge Function: notify-route-start
// Sends one idempotent "delivery today" email per store after the driver starts a route.
// Recipient addresses are loaded server-side from ecoflow_store_sites; the browser cannot
// choose arbitrary recipients. Required secrets: RESEND_API_KEY, DELIVERY_FROM_EMAIL.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const POLICY_VERSION = '2026-07-11-v1';

type Body = {
  businessDay?: string;
  routeId?: string;
  orderIds?: string[];
  startedAt?: string;
};

type StoreGroup = {
  retailerId: string | null;
  storeKey: string;
  storeName: string;
  orderIds: string[];
  orderNumbers: string[];
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

function storeKey(retailerId: unknown, storeName: unknown) {
  return clean(retailerId) || clean(storeName).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'UNKNOWN-STORE';
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function displayDate(value: string) {
  const date = new Date(`${value}T12:00:00+09:30`);
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Adelaide',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
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
  if (!profile || !profile.is_active || profile.team_status !== 'ACTIVE' || !['DRIVER', 'OWNER', 'ADMIN'].includes(profile.app_role)) {
    return json(403, { error: 'ACTIVE_DRIVER_ROLE_REQUIRED' });
  }

  let body: Body;
  try { body = await req.json(); } catch { return json(400, { error: 'INVALID_JSON_BODY' }); }

  const businessDay = clean(body.businessDay);
  const routeId = clean(body.routeId);
  const startedAt = clean(body.startedAt);
  const orderIds = [...new Set((body.orderIds ?? []).map(clean).filter(Boolean))].slice(0, 200);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDay)) return json(400, { error: 'VALID_BUSINESS_DAY_REQUIRED' });
  if (!routeId) return json(400, { error: 'ROUTE_ID_REQUIRED' });
  if (!startedAt || Number.isNaN(new Date(startedAt).getTime())) return json(400, { error: 'VALID_ROUTE_START_REQUIRED' });
  if (!orderIds.length) return json(200, { ok: true, sent: 0, alreadySent: 0, missingContact: 0, disabled: 0, failed: 0, details: [] });

  const { data: acknowledgement, error: acknowledgementError } = await admin
    .from('ecoflow_driver_departure_acknowledgements')
    .select('id')
    .eq('business_day', businessDay)
    .eq('route_id', routeId)
    .eq('driver_user_id', actor.id)
    .eq('policy_version', POLICY_VERSION)
    .maybeSingle();
  if (acknowledgementError) return json(500, { error: 'DEPARTURE_ACKNOWLEDGEMENT_LOOKUP_FAILED', details: acknowledgementError.message });
  if (!acknowledgement && profile.app_role === 'DRIVER') return json(409, { error: 'PRE_DEPARTURE_ACKNOWLEDGEMENT_REQUIRED' });

  let orders: Array<Record<string, unknown>> = [];
  const primary = await admin
    .from('om_orders')
    .select('id,order_number,retailer_id,retailer_name')
    .in('id', orderIds);
  if (!primary.error) orders = (primary.data ?? []) as Array<Record<string, unknown>>;

  const foundIds = new Set(orders.map((row) => clean(row.id)));
  const remaining = orderIds.filter((id) => !foundIds.has(id));
  if (remaining.length) {
    const secondary = await admin
      .from('om_orders')
      .select('id,order_number,retailer_id,retailer_name')
      .in('order_number', remaining);
    if (!secondary.error) orders.push(...((secondary.data ?? []) as Array<Record<string, unknown>>));
  }

  const groups = new Map<string, StoreGroup>();
  for (const order of orders) {
    const retailerId = clean(order.retailer_id) || null;
    const storeName = clean(order.retailer_name) || 'Customer';
    const key = storeKey(retailerId, storeName);
    const current = groups.get(key) ?? { retailerId, storeKey: key, storeName, orderIds: [], orderNumbers: [] };
    current.orderIds.push(clean(order.id));
    current.orderNumbers.push(clean(order.order_number) || clean(order.id));
    groups.set(key, current);
  }

  // Do not pretend unresolved order IDs were notified.
  if (!groups.size) return json(422, { error: 'ROUTE_ORDERS_NOT_FOUND', details: 'No released route orders could be matched to om_orders.' });

  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const fromEmail = Deno.env.get('DELIVERY_FROM_EMAIL');
  const replyTo = Deno.env.get('DELIVERY_REPLY_TO_EMAIL') || undefined;
  const senderName = Deno.env.get('DELIVERY_FROM_NAME') || 'EcoFlow Packaging';
  const details: Array<Record<string, unknown>> = [];
  let sent = 0;
  let alreadySent = 0;
  let missingContact = 0;
  let disabled = 0;
  let failed = 0;
  let configurationRequired = false;

  for (const group of groups.values()) {
    const { data: previous } = await admin
      .from('ecoflow_delivery_notification_log')
      .select('id,status,recipient_email')
      .eq('business_day', businessDay)
      .eq('route_id', routeId)
      .eq('store_key', group.storeKey)
      .eq('notification_type', 'ROUTE_STARTED_TODAY')
      .maybeSingle();

    if (previous?.status === 'SENT') {
      alreadySent += 1;
      details.push({ store: group.storeName, status: 'ALREADY_SENT', recipient: previous.recipient_email });
      continue;
    }

    let contactQuery = admin
      .from('ecoflow_store_sites')
      .select('retailer_id,store_name,contact_email,notification_contact_name,delivery_notification_enabled');
    contactQuery = group.retailerId
      ? contactQuery.eq('retailer_id', group.retailerId)
      : contactQuery.ilike('store_name', group.storeName);
    const { data: contact, error: contactError } = await contactQuery.limit(1).maybeSingle();

    const recipient = clean(contact?.contact_email).toLowerCase() || null;
    let status = 'PENDING';
    let providerError: string | null = null;
    let providerMessageId: string | null = null;
    let sentAt: string | null = null;

    if (contactError) {
      status = 'FAILED';
      providerError = contactError.message;
      failed += 1;
    } else if (contact?.delivery_notification_enabled === false) {
      status = 'SKIPPED_DISABLED';
      disabled += 1;
    } else if (!recipient) {
      status = 'MISSING_CONTACT';
      missingContact += 1;
    } else if (!resendApiKey || !fromEmail) {
      status = 'CONFIGURATION_REQUIRED';
      providerError = 'RESEND_API_KEY and DELIVERY_FROM_EMAIL must be configured in Supabase Edge Function secrets.';
      configurationRequired = true;
      failed += 1;
    } else {
      const orderReference = [...new Set(group.orderNumbers.filter(Boolean))].join(', ');
      const contactName = clean(contact?.notification_contact_name);
      const greeting = contactName ? `Hi ${escapeHtml(contactName)},` : `Hi ${escapeHtml(group.storeName)} team,`;
      const subject = `Your EcoFlow Packaging delivery is on the way today`;
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#17362b;line-height:1.55">
          <div style="border-bottom:4px solid #1f6b4f;padding:18px 0"><strong style="font-size:22px">EcoFlow Packaging</strong></div>
          <h1 style="font-size:25px;margin:28px 0 10px">Your delivery is on the way today</h1>
          <p>${greeting}</p>
          <p>Our driver has started today’s delivery run and your EcoFlow Packaging order is scheduled to arrive on <strong>${escapeHtml(displayDate(businessDay))}</strong>.</p>
          <div style="background:#f2f6f4;border:1px solid #d8e5df;border-radius:10px;padding:16px;margin:20px 0">
            <strong>${escapeHtml(group.storeName)}</strong><br>
            Order reference${group.orderNumbers.length === 1 ? '' : 's'}: ${escapeHtml(orderReference)}
          </div>
          <p>Route timing may change with traffic and earlier deliveries. Please make sure the normal delivery access is available and a team member can receive the goods where required.</p>
          <p>Thank you for choosing EcoFlow Packaging. We appreciate your business.</p>
          <p style="margin-top:28px">EcoFlow Packaging<br><small>This operational notice does not include the driver’s delivery sequence or live location.</small></p>
        </div>`;

      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `${senderName} <${fromEmail}>`,
            to: [recipient],
            subject,
            html,
            reply_to: replyTo,
            tags: [
              { name: 'event', value: 'route_started_today' },
              { name: 'business_day', value: businessDay.replaceAll('-', '_') },
            ],
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

    const logRow = {
      business_day: businessDay,
      route_id: routeId,
      retailer_id: group.retailerId,
      store_key: group.storeKey,
      store_name: group.storeName,
      recipient_email: recipient,
      order_ids: [...new Set(group.orderIds.filter(Boolean))],
      order_numbers: [...new Set(group.orderNumbers.filter(Boolean))],
      notification_type: 'ROUTE_STARTED_TODAY',
      status,
      provider_message_id: providerMessageId,
      provider_error: providerError,
      requested_by: actor.id,
      requested_at: new Date().toISOString(),
      sent_at: sentAt,
      payload: { routeStartedAt: startedAt, driverRole: profile.app_role, acknowledgementId: acknowledgement?.id ?? null },
    };
    const { error: logError } = await admin
      .from('ecoflow_delivery_notification_log')
      .upsert(logRow, { onConflict: 'business_day,route_id,store_key,notification_type' });
    if (logError) {
      failed += 1;
      details.push({ store: group.storeName, status: 'LOG_FAILED', error: logError.message });
    } else {
      details.push({ store: group.storeName, status, recipient, error: providerError });
    }
  }

  return json(200, {
    ok: failed === 0,
    sent,
    alreadySent,
    missingContact,
    disabled,
    failed,
    configurationRequired,
    details,
  });
});
