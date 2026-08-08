import { useCallback, useEffect, useState } from 'react';
import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import type { Role } from '@/domain/types';
import {
  NativeWorkspaceEmpty,
  NativeWorkspaceFrame,
  NativeWorkspaceLoading,
  NativeWorkspaceUnavailable,
} from '@/features/navigation/NativeWorkspaceFrame';
import { useWorkspaceQueryState } from '@/features/navigation/useWorkspaceQueryState';
import { OrdersCommandWorkspace } from '@/features/orders/OrdersCommandWorkspace';
import { actionableExceptionLifecycleRepository } from '@/data/repositories/actionableExceptionLifecycleRepository';
import {
  completeBusinessDayClose,
  readBusinessDayCloseReadiness,
  readOperationalPage,
  type OperationalPageResource,
  type OperationalPageResult,
} from '@/data/repositories/operationalStability';
import { OperationalPagedWorkspace as BaseOperationalPagedWorkspace } from './OperationalStabilityWorkspaceV2';

const PAGE_SIZES = [10,20,25,50,100] as const;
type PageSize = (typeof PAGE_SIZES)[number];
type Row = Record<string,unknown>;

type Props = {
  resource: OperationalPageResource;
  role: Role;
  profile: EcoFlowAuthProfile;
  businessDay: string;
};

function value(input: unknown) {
  if (input===null || input===undefined || input==='') return '—';
  return String(input);
}

function adelaide(input: unknown) {
  if (typeof input!=='string' || Number.isNaN(Date.parse(input))) return '—';
  return new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Adelaide',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(input));
}

function age(input: unknown) {
  const seconds=Number(input);
  if (!Number.isFinite(seconds)) return '—';
  if (seconds<3600) return `${Math.max(0,Math.floor(seconds/60))}m`;
  if (seconds<86400) return `${Math.floor(seconds/3600)}h`;
  return `${Math.floor(seconds/86400)}d`;
}

function ExceptionLifecycleActions({ row, reload }: { row: Row; reload: () => void }) {
  const exceptionId=typeof row.exception_id==='string' ? row.exception_id : '';
  const [owner,setOwner]=useState(typeof row.owner_team==='string' ? row.owner_team : 'Operations queue');
  const [note,setNote]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);

  async function apply(action: 'ACKNOWLEDGE'|'ASSIGN'|'RESOLVE') {
    if (!exceptionId) return;
    setBusy(true); setMessage('');
    const result=await actionableExceptionLifecycleRepository.applyCommand({
      commandId:crypto.randomUUID(),exceptionId,action,
      ownerTeam:action==='ASSIGN'?owner:null,
      resolutionNote:action==='RESOLVE'?note:null,
    });
    if (!result.ok) setMessage(result.error.message);
    else { setMessage(`${action} applied.`); reload(); }
    setBusy(false);
  }

  return <details className="native-exception-actions"><summary>Manage</summary>
    <div className="row-actions"><button type="button" disabled={busy} onClick={()=>void apply('ACKNOWLEDGE')}>Acknowledge</button><input aria-label="Owner team" value={owner} maxLength={80} onChange={(event)=>setOwner(event.target.value)}/><button type="button" disabled={busy||!owner.trim()} onClick={()=>void apply('ASSIGN')}>Assign</button></div>
    <textarea aria-label="Resolution note" value={note} maxLength={2000} placeholder="Mandatory resolution note" onChange={(event)=>setNote(event.target.value)}/>
    <button type="button" disabled={busy||!note.trim()} onClick={()=>void apply('RESOLVE')}>Resolve with note</button>
    {message?<small>{message}</small>:null}
  </details>;
}

function ClosePanel({ businessDay,role }: { businessDay:string; role:Role }) {
  const [checks,setChecks]=useState<Array<{check_key:string;check_status:string;detail:string;blocking:boolean;read_at:string}>>([]);
  const [nextDay,setNextDay]=useState(()=>{const date=new Date(`${businessDay}T12:00:00+09:30`);date.setDate(date.getDate()+1);return date.toISOString().slice(0,10);});
  const [reason,setReason]=useState('Daily operational reconciliation completed');
  const [ack,setAck]=useState('Accounts variance reviewed and acknowledged.');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const mayClose=role==='owner'||role==='admin';

  const load=useCallback(async()=>{try{setChecks(await readBusinessDayCloseReadiness(businessDay));setMessage('');}catch(error){setMessage(error instanceof Error?error.message:String(error));}},[businessDay]);
  useEffect(()=>{void load();},[load]);
  const blocked=checks.some((check)=>check.blocking&&check.check_key!=='ACCOUNTS_VARIANCE');

  async function close() {
    setBusy(true);
    try {
      const result=await completeBusinessDayClose({businessDay,nextBusinessDay:nextDay,expectedRevision:0,reason,acknowledgementNote:ack});
      setMessage(`Business Day Close ${value(result?.close_status)} · ${value(result?.carry_over_count)} carry-over records.`);
      await load();
    } catch(error) { setMessage(error instanceof Error?error.message:String(error)); }
    finally { setBusy(false); }
  }

  return <section className="native-close-panel"><header><div><span className="eyebrow">ADELAIDE BUSINESS DAY</span><h2>Close readiness</h2></div><button type="button" onClick={()=>void load()}>Refresh checks</button></header>
    <div className="native-close-checks">{checks.map((check)=><article key={check.check_key} className={check.blocking?'blocking':''}><strong>{check.check_key.replaceAll('_',' ')}</strong><span>{check.check_status}</span><p>{check.detail}</p></article>)}</div>
    {mayClose?<div className="native-close-form"><label>Next business day<input type="date" min={businessDay} value={nextDay} onChange={(event)=>setNextDay(event.target.value)}/></label><label>Close reason<input value={reason} onChange={(event)=>setReason(event.target.value)}/></label><label>Accounts variance acknowledgement<textarea value={ack} onChange={(event)=>setAck(event.target.value)}/></label><button className="primary-button" type="button" disabled={busy||blocked||!reason.trim()||!ack.trim()} onClick={()=>void close()}>Close and carry forward</button></div>:<p>Owner or Admin approval is required to close the business day.</p>}
    {message?<div className="native-workspace-notice">{message}</div>:null}
  </section>;
}

function ExceptionQueue({ role,profile,businessDay }: Omit<Props,'resource'>) {
  const query=useWorkspaceQueryState({tab:'list',search:'',filter:'',sort:'oldest',page:1,pageSize:25,allowedTabs:['list','close'],allowedFilters:['','open','acknowledged','snoozed'],allowedSorts:['oldest','latest'],allowedPageSizes:PAGE_SIZES});
  const [result,setResult]=useState<OperationalPageResult>({rows:[],totalCount:0,readAt:null});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [reloadKey,setReloadKey]=useState(0);

  const load=useCallback(async()=>{setLoading(true);try{setResult(await readOperationalPage({resource:'exceptions',page:query.state.page,pageSize:query.state.pageSize as PageSize,search:query.state.search,filter:query.state.filter,sort:query.state.sort}));setError('');}catch(loadError){setResult({rows:[],totalCount:0,readAt:null});setError(loadError instanceof Error?loadError.message:String(loadError));}finally{setLoading(false);}},[query.state.page,query.state.pageSize,query.state.search,query.state.filter,query.state.sort,reloadKey]);
  useEffect(()=>{void load();},[load]);

  if (query.state.tab==='close') return <NativeWorkspaceFrame eyebrow="CONTROL & RECONCILIATION" title="Business Day Close" detail="Review source cut-off, exception ownership, execution progress and accounts variance before explicit carry-over." actions={<button type="button" onClick={()=>query.update({tab:'list'})}>Back to queue</button>}><ClosePanel businessDay={businessDay} role={role}/></NativeWorkspaceFrame>;

  const pages=Math.max(1,Math.ceil(result.totalCount/query.state.pageSize));
  return <NativeWorkspaceFrame eyebrow="SERVER-AUTHORITATIVE OPERATIONS" title="Exception Action Queue" detail="Each item exposes age, cause, policy severity, governed owner, due time and a direct recommended action." actions={<><span className="status-chip">{profile.app_role}</span><button type="button" onClick={()=>query.update({tab:'close'})}>Business Day Close</button><button type="button" onClick={()=>setReloadKey((key)=>key+1)}>Reload</button></>}>
    <div className="native-workspace-toolbar"><label><span>Search</span><input value={query.state.search} placeholder="Search exception queue" onChange={(event)=>query.update({search:event.target.value})}/></label><label><span>Lifecycle</span><select value={query.state.filter} onChange={(event)=>query.update({filter:event.target.value})}><option value="">All</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="snoozed">Snoozed</option></select></label><label><span>Sort</span><select value={query.state.sort} onChange={(event)=>query.update({sort:event.target.value})}><option value="oldest">Oldest / due first</option><option value="latest">Latest</option></select></label><button type="button" onClick={query.clear}>Clear URL state</button></div>
    {loading?<NativeWorkspaceLoading label="exception queue"/>:null}
    {!loading&&error?<NativeWorkspaceUnavailable label="Exception Action Queue" detail={error} onRetry={()=>setReloadKey((key)=>key+1)}/>:null}
    {!loading&&!error&&result.rows.length===0?<NativeWorkspaceEmpty title="No open exceptions" detail="The server query completed successfully and returned no matching work."/>:null}
    {!loading&&!error&&result.rows.length>0?<div className="native-server-table" role="region" aria-label="Exception action results" tabIndex={0}><table><caption>{result.totalCount.toLocaleString()} exact records · read {adelaide(result.readAt)}</caption><thead><tr><th>Order</th><th>Cause</th><th>Category</th><th>Severity</th><th>Age</th><th>Owner</th><th>Due</th><th>Recommended action</th><th>Lifecycle</th><th>Manage</th></tr></thead><tbody>{result.rows.map((row,index)=><tr key={typeof row.exception_id==='string'?row.exception_id:String(index)}><td>{value(row.order_number||row.external_order_number)}</td><td>{value(row.exception_type)}</td><td>{value(row.category)}</td><td>{value(row.severity)}</td><td>{age(row.age_seconds)}</td><td>{value(row.owner_team)}</td><td>{adelaide(row.due_at)}</td><td>{value(row.recommended_action)}</td><td>{value(row.lifecycle_status)}</td><td><ExceptionLifecycleActions row={row} reload={()=>setReloadKey((key)=>key+1)}/></td></tr>)}</tbody></table></div>:null}
    {!loading&&!error?<nav className="native-workspace-pager" aria-label="Exception pagination"><span>{result.totalCount.toLocaleString()} exact records · Page {Math.min(query.state.page,pages)} of {pages}</span><div className="row-actions"><select value={query.state.pageSize} aria-label="Rows per page" onChange={(event)=>query.update({pageSize:Number(event.target.value)})}>{PAGE_SIZES.map((size)=><option key={size} value={size}>{size} rows</option>)}</select><button type="button" disabled={query.state.page<=1} onClick={()=>query.update({page:query.state.page-1},{preservePage:true})}>Previous</button><button type="button" disabled={query.state.page>=pages} onClick={()=>query.update({page:query.state.page+1},{preservePage:true})}>Next</button></div></nav>:null}
  </NativeWorkspaceFrame>;
}

export function OperationalPagedWorkspace(props: Props) {
  if (props.resource==='orders') return <OrdersCommandWorkspace role={props.role} profile={props.profile} businessDay={props.businessDay} />;
  if (props.resource==='exceptions') return <ExceptionQueue role={props.role} profile={props.profile} businessDay={props.businessDay}/>;
  return <BaseOperationalPagedWorkspace {...props}/>;
}
