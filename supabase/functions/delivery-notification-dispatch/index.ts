import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type NotificationRow = {
  id: string;
  business_day: string;
  order_id: string;
  channel: 'EMAIL' | 'SMS' | 'INTERNAL';
  recipient: string | null;
  subject: string | null;
  message_text: string;
  message_html: string | null;
  pod1_path: string | null;
  pod2_path: string | null;
  notification_status: string;
};

type ResourceRow = {
  route_snapshot_id: string;
  run_code: string;
  assigned_driver_user_id: string;
  assigned_driver_label: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

type PodAsset = {
  url: string;
  filename: string;
  label: string;
  base64: string | null;
};

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function safePodPath(row: NotificationRow, path: string | null) {
  if (!path) return null;
  const prefix = `${row.business_day}/${row.order_id}/`;
  return path.startsWith(prefix) ? path : null;
}

/** Signed link plus downloaded bytes so the photo can ride inside the email itself. */
async function podAsset(
  supabase: ReturnType<typeof createClient>,
  path: string | null,
  filename: string,
  label: string,
): Promise<PodAsset | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('pod-photos').createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) throw error;
  let base64: string | null = null;
  try {
    const { data: file, error: downloadError } = await supabase.storage.from('pod-photos').download(path);
    if (!downloadError && file && file.size <= 5 * 1024 * 1024) {
      base64 = toBase64(await file.arrayBuffer());
    }
  } catch {
    // The inline <img> via signed URL still shows the photo; attachment is best-effort.
  }
  return { url: data.signedUrl, filename, label, base64 };
}

async function sendEmail(row: NotificationRow, assets: PodAsset[]) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('DELIVERY_FROM_EMAIL');
  const sender = Deno.env.get('DELIVERY_SENDER_NAME') || 'EcoFlow Packaging';
  if (!apiKey || !from) throw new Error('WAITING_CONFIG: RESEND_API_KEY and DELIVERY_FROM_EMAIL are required.');
  if (!row.recipient) throw new Error('WAITING_CONTACT: email recipient is missing.');

  const primaryLink = assets[0]?.url || '';
  const linkText = primaryLink || 'Proof of delivery is available from EcoFlow Packaging.';
  const text = row.message_text.replaceAll('{{POD_LINK}}', linkText);
  let html = (row.message_html || `<p>${row.message_text}</p>`).replaceAll('{{POD_LINK}}', primaryLink || '#');
  for (const asset of assets) {
    html += `<div style="margin:16px 0">`
      + `<p style="margin:0 0 6px;font:600 13px/1.4 -apple-system,Segoe UI,Arial,sans-serif;color:#0a2e22">${asset.label}</p>`
      + `<img src="${asset.url}" alt="${asset.label}" style="max-width:560px;width:100%;height:auto;border-radius:10px;border:1px solid #dfe7e2" />`
      + `<p style="margin:6px 0 0;font:400 12px/1.4 -apple-system,Segoe UI,Arial,sans-serif"><a href="${asset.url}">Open full-size photo</a></p>`
      + `</div>`;
  }

  const attachments = assets
    .filter((asset) => asset.base64)
    .map((asset) => ({ filename: asset.filename, content: asset.base64 }));

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${sender} <${from}>`,
      to: [row.recipient],
      subject: row.subject || 'EcoFlow Packaging delivery update',
      text,
      html,
      ...(attachments.length ? { attachments } : {}),
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Resend ${response.status}: ${JSON.stringify(result)}`);
  return String(result.id || 'RESEND_SENT');
}

async function sendSms(row: NotificationRow, podLink: string) {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from = Deno.env.get('TWILIO_FROM_NUMBER');
  if (!sid || !token || !from) throw new Error('WAITING_CONFIG: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER are required.');
  if (!row.recipient) throw new Error('WAITING_CONTACT: mobile recipient is missing.');

  const body = row.message_text.replaceAll('{{POD_LINK}}', podLink || 'POD available from EcoFlow Packaging.').slice(0, 1450);
  const payload = new URLSearchParams({ To: row.recipient, From: from, Body: body });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Twilio ${response.status}: ${JSON.stringify(result)}`);
  return String(result.sid || 'TWILIO_SENT');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRole) return json({ error: 'Supabase function environment is incomplete.' }, 500);

  const authHeader = request.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'MISSING_BEARER_TOKEN' }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return json({ error: 'INVALID_SESSION', details: userError?.message }, 401);

  const { data: profile, error: profileError } = await admin
    .from('app_user_profiles')
    .select('app_role,is_active,team_status')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (profileError) return json({ error: 'ACTOR_PROFILE_LOOKUP_FAILED', details: profileError.message }, 500);
  if (!profile || !profile.is_active || profile.team_status !== 'ACTIVE' || !['DRIVER', 'OWNER', 'ADMIN'].includes(profile.app_role)) {
    return json({ error: 'DELIVERY_NOTIFICATION_DISPATCH_ROLE_REQUIRED' }, 403);
  }

  const body = await request.json().catch(() => ({})) as { notificationId?: string; businessDay?: string; orderId?: string };
  let businessDay = String(body.businessDay ?? '').trim();
  let orderId = String(body.orderId ?? '').trim();
  const notificationId = String(body.notificationId ?? '').trim();

  if (notificationId) {
    const { data: target, error: targetError } = await admin
      .from('ecoflow_delivery_notifications')
      .select('id,business_day,order_id')
      .eq('id', notificationId)
      .maybeSingle();
    if (targetError) return json({ error: 'NOTIFICATION_LOOKUP_FAILED', details: targetError.message }, 500);
    if (!target) return json({ error: 'NOTIFICATION_NOT_FOUND' }, 404);
    if (businessDay && businessDay !== String(target.business_day)) return json({ error: 'NOTIFICATION_BUSINESS_DAY_MISMATCH' }, 409);
    if (orderId && orderId !== String(target.order_id)) return json({ error: 'NOTIFICATION_ORDER_MISMATCH' }, 409);
    businessDay = String(target.business_day);
    orderId = String(target.order_id);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDay) || !orderId) {
    return json({ error: 'SCOPED_DELIVERY_RESOURCE_REQUIRED' }, 400);
  }

  const { data: authorized, error: authorizationError } = await userClient.rpc('ecoflow_authorize_delivery_resource', {
    p_business_day: businessDay,
    p_route_reference: null,
    p_order_id: orderId,
  });
  if (authorizationError || !(authorized as ResourceRow[] | null)?.[0]?.route_snapshot_id) {
    return json({ error: 'DELIVERY_RESOURCE_FORBIDDEN', details: authorizationError?.message }, 403);
  }

  let query = admin
    .from('ecoflow_delivery_notifications')
    .select('*')
    .eq('notification_status', 'PENDING')
    .in('channel', ['EMAIL', 'SMS'])
    .eq('business_day', businessDay)
    .eq('order_id', orderId)
    .order('queued_at', { ascending: true })
    .limit(20);
  if (notificationId) query = query.eq('id', notificationId);
  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const row of (data || []) as NotificationRow[]) {
    await admin.from('ecoflow_delivery_notifications').update({ notification_status: 'SENDING', error_message: null }).eq('id', row.id);
    try {
      const assets = (await Promise.all([
        podAsset(admin, safePodPath(row, row.pod2_path), 'pod-goods-delivered.jpg', 'All goods delivered'),
        podAsset(admin, safePodPath(row, row.pod1_path), 'pod-drop-point.jpg', 'Store / drop point'),
      ])).filter((asset): asset is PodAsset => Boolean(asset));
      const podLink = assets[0]?.url || '';
      const providerId = row.channel === 'EMAIL' ? await sendEmail(row, assets) : await sendSms(row, podLink);
      await admin.from('ecoflow_delivery_notifications').update({ notification_status: 'SENT', provider_message_id: providerId, sent_at: new Date().toISOString(), error_message: null }).eq('id', row.id);
      results.push({ id: row.id, status: 'SENT', providerId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.startsWith('WAITING_CONFIG:') ? 'WAITING_CONFIG' : message.startsWith('WAITING_CONTACT:') ? 'WAITING_CONTACT' : 'FAILED';
      await admin.from('ecoflow_delivery_notifications').update({ notification_status: status, error_message: message }).eq('id', row.id);
      results.push({ id: row.id, status, error: message });
    }
  }

  return json({ processed: results.length, results });
});
