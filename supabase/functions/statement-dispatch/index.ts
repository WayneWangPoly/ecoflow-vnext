import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
type Body={statementId?:string;send?:boolean};
type DocumentRow={id:string;statement_number:string;store_id:string;store_name:string;period_start:string;period_end:string;issue_date:string;due_date:string|null;opening_balance:number;period_invoice_total:number;period_payment_total:number;closing_balance:number;document_status:string;storage_path:string|null;recipient_email:string|null};
type LineRow={invoice_number:string|null;order_number:string|null;invoice_date:string|null;due_date:string|null;original_amount:number;allocated_amount:number;outstanding_amount:number;line_status:string};
function json(status:number,body:unknown){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});}
function clean(value:unknown){return String(value??'').trim();}
/** PDF text uses the built-in Helvetica font (Latin only). Strip diacritics first
 * so "Café Athéna" renders as "Cafe Athena" instead of "Caf? Ath?na"; only
 * genuinely non-Latin characters fall back to '?'. */
function ascii(value:unknown){return String(value??'').normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^\x20-\x7E]/g,'?');}
function pdfEscape(value:string){return ascii(value).replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)');}
function money(value:unknown){const amount=Number(value)||0;return `$${amount.toFixed(2)}`;}
function displayDate(value:string|null|undefined){if(!value)return'-';const date=new Date(`${value}T12:00:00+09:30`);return Number.isNaN(date.getTime())?String(value):new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Adelaide',day:'2-digit',month:'short',year:'numeric'}).format(date);}
function toBase64(bytes:Uint8Array){let binary='';const size=0x8000;for(let i=0;i<bytes.length;i+=size)binary+=String.fromCharCode(...bytes.subarray(i,i+size));return btoa(binary);}

function buildPdf(document:DocumentRow,lines:LineRow[]){
  const rows=[
    'EcoFlow Packaging',
    'GREEN PACK SA PTY LTD  |  ABN 91 681 108 930',
    '',
    `STATEMENT ${document.statement_number}`,
    `Customer: ${document.store_name}`,
    `Statement period: ${displayDate(document.period_start)} to ${displayDate(document.period_end)}`,
    `Issue date: ${displayDate(document.issue_date)}   Due date: ${displayDate(document.due_date)}`,
    '',
    `Opening balance: ${money(document.opening_balance)}`,
    `Invoices in period: ${money(document.period_invoice_total)}`,
    `Payments in period: ${money(document.period_payment_total)}`,
    `AMOUNT DUE: ${money(document.closing_balance)}`,
    '',
    'Invoice       Invoice date   Due date      Original      Paid/allocated   Outstanding',
    '-------------------------------------------------------------------------------------',
    ...lines.map((line)=>{
      const invoice=(line.invoice_number||line.order_number||'Pending').slice(0,13).padEnd(13);
      return `${invoice} ${displayDate(line.invoice_date).padEnd(14)} ${displayDate(line.due_date).padEnd(13)} ${money(line.original_amount).padStart(11)} ${money(line.allocated_amount).padStart(15)} ${money(line.outstanding_amount).padStart(13)}`;
    }),
    '',
    'All amounts are in AUD and GST inclusive where applicable.',
    'Please quote the statement number and invoice number with your payment.',
    'For account queries, reply to the EcoFlow Packaging accounts team.',
  ];
  const chunks:string[][]=[];const pageSize=43;for(let i=0;i<rows.length;i+=pageSize)chunks.push(rows.slice(i,i+pageSize));
  const objects:string[]=[''];
  objects[1]='<< /Type /Catalog /Pages 2 0 R >>';
  objects[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const kids:string[]=[];
  chunks.forEach((page,index)=>{
    const pageObject=4+index*2;const streamObject=pageObject+1;kids.push(`${pageObject} 0 R`);
    const commands=['BT','/F1 9 Tf','48 790 Td'];
    page.forEach((line,lineIndex)=>{if(lineIndex)commands.push('0 -16 Td');if(line.startsWith('AMOUNT DUE')||line.startsWith('STATEMENT '))commands.push('/F1 12 Tf');commands.push(`(${pdfEscape(line)}) Tj`);if(line.startsWith('AMOUNT DUE')||line.startsWith('STATEMENT '))commands.push('/F1 9 Tf');});commands.push('ET');
    const stream=commands.join('\n');
    objects[pageObject]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamObject} 0 R >>`;
    objects[streamObject]=`<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`;
  });
  objects[2]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${chunks.length} >>`;
  let output='%PDF-1.4\n';const offsets:number[]=[0];
  for(let i=1;i<objects.length;i++){offsets[i]=new TextEncoder().encode(output).length;output+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=new TextEncoder().encode(output).length;output+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;for(let i=1;i<objects.length;i++)output+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;output+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(output);
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
  const url=Deno.env.get('SUPABASE_URL');const anon=Deno.env.get('SUPABASE_ANON_KEY');const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!anon||!service)return json(500,{error:'MISSING_SUPABASE_FUNCTION_SECRETS'});
  const authorization=req.headers.get('authorization')??'';if(!authorization.startsWith('Bearer '))return json(401,{error:'MISSING_BEARER_TOKEN'});
  const userClient=createClient(url,anon,{global:{headers:{Authorization:authorization}}});
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const{data:userData,error:userError}=await userClient.auth.getUser();if(userError||!userData.user)return json(401,{error:'INVALID_SESSION',details:userError?.message});
  const{data:profile,error:profileError}=await admin.from('app_user_profiles').select('user_id,email,display_name,app_role,is_active,team_status').eq('user_id',userData.user.id).maybeSingle();
  if(profileError)return json(500,{error:'ACTOR_PROFILE_LOOKUP_FAILED',details:profileError.message});
  if(!profile||!profile.is_active||profile.team_status!=='ACTIVE'||!['OWNER','ADMIN','ACCOUNT'].includes(profile.app_role))return json(403,{error:'OFFICE_ROLE_REQUIRED'});
  let body:Body;try{body=await req.json();}catch{return json(400,{error:'INVALID_JSON_BODY'});}const statementId=clean(body.statementId);if(!statementId)return json(400,{error:'STATEMENT_ID_REQUIRED'});
  const{data:doc,error:docError}=await admin.from('ecoflow_statement_documents').select('*').eq('id',statementId).maybeSingle();if(docError||!doc)return json(404,{error:'STATEMENT_NOT_FOUND',details:docError?.message});
  const document=doc as DocumentRow;const{data:lineData,error:lineError}=await admin.from('ecoflow_statement_document_lines').select('*').eq('statement_id',statementId).order('due_date',{ascending:true});if(lineError)return json(500,{error:'STATEMENT_LINES_FAILED',details:lineError.message});const lines=(lineData??[]) as LineRow[];
  let storagePath=document.storage_path;let pdf:Uint8Array|null=null;
  if(!storagePath){pdf=buildPdf(document,lines);storagePath=`${document.store_id}/${document.statement_number}.pdf`;const{error:uploadError}=await admin.storage.from('account-statements').upload(storagePath,pdf,{contentType:'application/pdf',upsert:true});if(uploadError)return json(500,{error:'STATEMENT_PDF_UPLOAD_FAILED',details:uploadError.message});await admin.from('ecoflow_statement_documents').update({storage_path:storagePath,document_status:'GENERATED',generated_at:new Date().toISOString(),error_message:null}).eq('id',statementId);}
  if(!body.send)return json(200,{ok:true,status:'GENERATED',statementId,storagePath});
  const{data:contact}=await admin.from('ecoflow_accounts_billing_contacts').select('*').eq('store_id',document.store_id).maybeSingle();const recipient=clean(contact?.billing_email||document.recipient_email).toLowerCase();
  if(contact?.enabled===false||!recipient){await admin.from('ecoflow_statement_documents').update({document_status:'CONFIGURATION_REQUIRED',error_message:'Billing email is missing or disabled.'}).eq('id',statementId);return json(200,{ok:true,status:'CONFIGURATION_REQUIRED',statementId,storagePath});}
  const apiKey=Deno.env.get('RESEND_API_KEY');const fromEmail=Deno.env.get('STATEMENT_FROM_EMAIL')||Deno.env.get('DELIVERY_FROM_EMAIL');const sender=Deno.env.get('STATEMENT_FROM_NAME')||Deno.env.get('DELIVERY_FROM_NAME')||'EcoFlow Packaging';const replyTo=Deno.env.get('STATEMENT_REPLY_TO_EMAIL')||Deno.env.get('DELIVERY_REPLY_TO_EMAIL')||undefined;
  if(!apiKey||!fromEmail){await admin.from('ecoflow_statement_documents').update({document_status:'CONFIGURATION_REQUIRED',recipient_email:recipient,error_message:'RESEND_API_KEY and a statement/delivery from email are required.'}).eq('id',statementId);return json(200,{ok:true,status:'CONFIGURATION_REQUIRED',statementId,storagePath});}
  if(!pdf){const{data:file,error:downloadError}=await admin.storage.from('account-statements').download(storagePath!);if(downloadError||!file)return json(500,{error:'STATEMENT_PDF_DOWNLOAD_FAILED',details:downloadError?.message});pdf=new Uint8Array(await file.arrayBuffer());}
  const{data:signed,error:signedError}=await admin.storage.from('account-statements').createSignedUrl(storagePath!,60*60*24*30);if(signedError)return json(500,{error:'STATEMENT_SIGNED_URL_FAILED',details:signedError.message});
  const greeting=clean(contact?.contact_name)?`Hi ${clean(contact.contact_name)},`:`Hi ${document.store_name} team,`;
  const html=`<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#17362b;line-height:1.55"><h1>EcoFlow Packaging statement</h1><p>${greeting}</p><p>Please find attached statement <strong>${document.statement_number}</strong> for ${displayDate(document.period_start)} to ${displayDate(document.period_end)}.</p><p style="font-size:20px"><strong>Amount due: ${money(document.closing_balance)}</strong></p><p><a href="${signed.signedUrl}">Open statement PDF</a> (link valid for 30 days).</p><p style="font-size:12px;color:#5b6b62">All amounts are in AUD and GST inclusive where applicable.</p><p>Thank you for your business.<br>EcoFlow Packaging</p></div>`;
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({from:`${sender} <${fromEmail}>`,to:[recipient],subject:`EcoFlow Packaging statement ${document.statement_number}`,html,reply_to:replyTo,attachments:[{filename:`${document.statement_number}.pdf`,content:toBase64(pdf)}]})});
  const responseText=await response.text();let provider:Record<string,unknown>={};try{provider=responseText?JSON.parse(responseText):{};}catch{provider={raw:responseText};}
  if(!response.ok){const detail=`Email provider ${response.status}: ${responseText.slice(0,500)}`;await admin.from('ecoflow_statement_documents').update({document_status:'FAILED',recipient_email:recipient,error_message:detail}).eq('id',statementId);return json(502,{error:'STATEMENT_EMAIL_FAILED',details:detail});}
  const sentAt=new Date().toISOString();await admin.from('ecoflow_statement_documents').update({document_status:'SENT',recipient_email:recipient,provider_message_id:clean(provider.id)||null,sent_at:sentAt,error_message:null}).eq('id',statementId);
  await admin.from('ecoflow_accounts_statement_actions').insert({store_id:document.store_id,action:'SEND_STATEMENT_DRAFT',action_note:`Formal statement ${document.statement_number} sent`,action_value:recipient,action_status:'STATEMENT_SENT',action_by:userData.user.id,action_at:sentAt});
  return json(200,{ok:true,status:'SENT',statementId,storagePath,recipient,providerMessageId:clean(provider.id)||null});
});
