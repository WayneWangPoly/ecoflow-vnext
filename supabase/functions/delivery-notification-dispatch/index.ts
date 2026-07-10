import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type NotificationRow = {
  id: string;
  channel: 'EMAIL' | 'SMS' | 'INTERNAL';
  recipient: string | null;
  subject: string | null;
  message_text: string;
  message_html: string | null;
  pod1_path: string | null;
  pod2_path: string | null;
  notification_status: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function signedPodLink(supabase: ReturnType<typeof createClient>, path: string | null) {
  if (!path) return '';
  const { data, error } = await supabase.storage.from('pod-photos').createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error) throw error;
  return data.signedUrl;
}

async function sendEmail(row: NotificationRow, podLink: string) {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('DELIVERY_FROM_EMAIL');
  const sender = Deno.env.get('DELIVERY_SENDER_NAME') || 'EcoFlow Packaging';
  if (!apiKey || !from) throw new Error('WAITING_CONFIG: RESEND_API_KEY and DELIVERY_FROM_EMAIL are required.');
  if (!row.recipient) throw new Error('WAITING_CONTACT: email recipient is missing.');

  const linkText = podLink || 'Proof of delivery is available from EcoFlow Packaging.';
  const text = row.message_text.replaceAll('{{POD_LINK}}', linkText);
  let html = (row.message_html || `<p>${row.message_text}</p>`).replaceAll('{{POD_LINK}}', podLink || '#');
  if (podLink) html += `<p><a href="${podLink}">Open proof of delivery</a></p><p><img src="${podLink}" alt="Proof of delivery" style="max-width:560px;width:100%;height:auto;border-radius:12px" /></p>`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${sender} <${from}>`, to: [row.recipient], subject: row.subject || 'EcoFlow Packaging delivery update', text, html }),
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
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRole) return json({ error: 'Supabase function environment is incomplete.' }, 500);
  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  const body = await request.json().catch(() => ({})) as { notificationId?: string; businessDay?: string; orderId?: string };
  let query = supabase.from('ecoflow_delivery_notifications').select('*').eq('notification_status', 'PENDING').in('channel', ['EMAIL', 'SMS']).order('queued_at', { ascending: true }).limit(20);
  if (body.notificationId) query = query.eq('id', body.notificationId);
  if (body.businessDay) query = query.eq('business_day', body.businessDay);
  if (body.orderId) query = query.eq('order_id', body.orderId);
  const { data, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const results: Array<Record<string, unknown>> = [];
  for (const row of (data || []) as NotificationRow[]) {
    await supabase.from('ecoflow_delivery_notifications').update({ notification_status: 'SENDING', error_message: null }).eq('id', row.id);
    try {
      const podLink = await signedPodLink(supabase, row.pod2_path || row.pod1_path);
      const providerId = row.channel === 'EMAIL' ? await sendEmail(row, podLink) : await sendSms(row, podLink);
      await supabase.from('ecoflow_delivery_notifications').update({ notification_status: 'SENT', provider_message_id: providerId, sent_at: new Date().toISOString(), error_message: null }).eq('id', row.id);
      results.push({ id: row.id, status: 'SENT', providerId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.startsWith('WAITING_CONFIG:') ? 'WAITING_CONFIG' : message.startsWith('WAITING_CONTACT:') ? 'WAITING_CONTACT' : 'FAILED';
      await supabase.from('ecoflow_delivery_notifications').update({ notification_status: status, error_message: message }).eq('id', row.id);
      results.push({ id: row.id, status, error: message });
    }
  }

  return json({ processed: results.length, results });
});
