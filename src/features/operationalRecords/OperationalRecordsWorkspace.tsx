import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { EcoFlowAuthProfile } from '@/features/auth/authTypes';
import {
  NativeWorkspaceEmpty,
  NativeWorkspaceFrame,
  NativeWorkspaceLoading,
  NativeWorkspaceUnavailable,
} from '@/features/navigation/NativeWorkspaceFrame';
import { useWorkspaceQueryState } from '@/features/navigation/useWorkspaceQueryState';
import {
  readOperationalRecordDetail,
  readOperationalRecordsPage,
  type OperationalRecordDetail,
  type OperationalRecordsPage,
  type OperationalRecordsView,
  type OperationalRecordsWorkspace,
} from '@/data/repositories/operationalRecords';
import './operationalRecordsWorkspace.css';

const PAGE_SIZES = [10,20,25,50,100] as const;
type PageSize = (typeof PAGE_SIZES)[number];
type DataRow = Record<string, unknown>;
type Column = { key: string; label: string; format?: (value: unknown) => string };
type ViewDefinition = { id: OperationalRecordsView; label: string };
type DetailTab = { label: string; kinds: readonly string[] };

const WORKSPACE_COPY: Record<OperationalRecordsWorkspace,{ title:string; detail:string; eyebrow:string }> = {
  inventory: {
    title: 'Inventory',
    detail: 'Live physical locations, commercial demand and movement evidence. Location is never inferred from a static shelf when the warehouse ledger exists.',
    eyebrow: 'PHYSICAL STOCK AUTHORITY',
  },
  customers: {
    title: 'Customers',
    detail: 'Ordermentum-owned store facts with bounded EcoFlow operational, delivery and account context.',
    eyebrow: 'CUSTOMER OPERATIONS',
  },
  accounts: {
    title: 'Accounts',
    detail: 'Source-owned receivables plus EcoFlow release-hold authority and affected operational records.',
    eyebrow: 'COMMERCIAL CONTROL',
  },
  returns: {
    title: 'Returns',
    detail: 'Physical return lifecycle from report to explicit disposition and inventory consequence.',
    eyebrow: 'RETURN CONSEQUENCE CONTROL',
  },
};

const VIEWS: Record<OperationalRecordsWorkspace,readonly ViewDefinition[]> = {
  inventory: [
    { id:'overview',label:'Overview' },
    { id:'sku',label:'By SKU' },
    { id:'location',label:'By location' },
    { id:'below-target',label:'Below target' },
    { id:'inconsistent',label:'Negative / inconsistent' },
    { id:'movements',label:'Movement ledger' },
    { id:'cycle-count',label:'Cycle count' },
  ],
  customers: [{ id:'overview',label:'Overview' }],
  accounts: [
    { id:'overview',label:'Overview' },
    { id:'held',label:'Held' },
    { id:'overdue',label:'Overdue' },
    { id:'open',label:'Open balance' },
  ],
  returns: [
    { id:'overview',label:'Overview' },
    { id:'reported',label:'Reported' },
    { id:'received',label:'Received' },
    { id:'inspection',label:'Inspection' },
    { id:'consequence',label:'Missing consequence' },
    { id:'closed',label:'Closed' },
  ],
};

const DETAIL_TABS: Record<OperationalRecordsWorkspace,readonly DetailTab[]> = {
  inventory: [
    { label:'Overview',kinds:['SUMMARY'] },
    { label:'Locations',kinds:['LOCATION'] },
    { label:'Physical SKUs',kinds:['PHYSICAL_SKU'] },
    { label:'Packaging',kinds:['PACKAGE'] },
    { label:'Barcodes',kinds:['BARCODE'] },
    { label:'Movements',kinds:['MOVEMENT'] },
    { label:'Identity exceptions',kinds:['IDENTITY_EXCEPTION'] },
  ],
  customers: [
    { label:'Overview',kinds:['SUMMARY'] },
    { label:'Orders',kinds:['ORDER'] },
    { label:'Delivery',kinds:['DELIVERY'] },
    { label:'Pricing',kinds:['PRICING'] },
    { label:'Accounts',kinds:['ACCOUNT'] },
    { label:'Contacts',kinds:['CONTACT'] },
    { label:'Timeline',kinds:['TIMELINE'] },
  ],
  accounts: [
    { label:'Overview',kinds:['SUMMARY'] },
    { label:'Invoices',kinds:['INVOICE'] },
    { label:'Actions',kinds:['ACTION'] },
    { label:'Documents',kinds:['DOCUMENT'] },
    { label:'Affected Orders',kinds:['AFFECTED_ORDER'] },
  ],
  returns: [
    { label:'Overview',kinds:['SUMMARY'] },
    { label:'Inspection',kinds:['INSPECTION'] },
    { label:'Scans',kinds:['SCAN'] },
    { label:'Inventory consequence',kinds:['INVENTORY_CONSEQUENCE'] },
  ],
};

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function display(value: unknown) {
  if (value===null || value===undefined || value==='') return '—';
  if (typeof value==='boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value==='object') return JSON.stringify(value);
  return String(value);
}

function numberValue(value: unknown) {
  const parsed=Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberFormat(value: unknown) {
  return numberValue(value).toLocaleString('en-AU',{maximumFractionDigits:2});
}

function money(value: unknown) {
  return new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:2}).format(numberValue(value));
}

function adelaide(value: unknown) {
  if (typeof value!=='string' || Number.isNaN(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('en-AU',{
    timeZone:'Australia/Adelaide',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',
  }).format(new Date(value));
}

function titleCase(value: string) {
  return value.replaceAll('_',' ').replaceAll('-',' ').replace(/\b\w/g,(letter)=>letter.toUpperCase());
}

function basePath(workspace: OperationalRecordsWorkspace) {
  if (workspace==='customers') return '/customers';
  return `/${workspace}`;
}

function recordIdFor(workspace: OperationalRecordsWorkspace,row: DataRow) {
  if (workspace==='inventory') return text(row.sku);
  if (workspace==='customers' || workspace==='accounts') return text(row.store_id);
  return text(row.return_code) || text(row.id);
}

function selectedId(pathname: string,workspace: OperationalRecordsWorkspace) {
  const patterns: Record<OperationalRecordsWorkspace,RegExp> = {
    inventory:/^\/inventory\/commercial\/([^/]+)\/?$/,
    customers:/^\/(?:customers|stores)\/([^/]+)\/?$/,
    accounts:/^\/accounts\/([^/]+)\/?$/,
    returns:/^\/returns\/([^/]+)\/?$/,
  };
  const match=patterns[workspace].exec(pathname);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

function detailPath(workspace: OperationalRecordsWorkspace,id: string) {
  const encoded=encodeURIComponent(id);
  if (workspace==='inventory') return `/inventory/commercial/${encoded}`;
  return `${basePath(workspace)}/${encoded}`;
}

function columnsFor(workspace: OperationalRecordsWorkspace,view: OperationalRecordsView): readonly Column[] {
  if (workspace==='inventory') {
    if (view==='location') return [
      {key:'location_code',label:'Location'}, {key:'sku',label:'SKU'}, {key:'product_name',label:'Product'},
      {key:'unit_level',label:'Unit'}, {key:'on_hand_location',label:'On hand',format:numberFormat},
      {key:'last_movement_at',label:'Latest movement',format:adelaide},
    ];
    if (view==='movements') return [
      {key:'moved_at',label:'Time',format:adelaide}, {key:'movement_type',label:'Movement'}, {key:'sku',label:'SKU'},
      {key:'quantity',label:'Quantity',format:numberFormat}, {key:'from_location',label:'From'}, {key:'to_location',label:'To'},
      {key:'source_authority',label:'Authority'},
    ];
    if (view==='cycle-count') return [
      {key:'title',label:'Session'}, {key:'session_type',label:'Type'}, {key:'session_status',label:'Status'},
      {key:'revision',label:'Revision'}, {key:'location_count',label:'Locations'},
      {key:'unresolved_exception_count',label:'Exceptions'}, {key:'updated_at',label:'Updated',format:adelaide},
    ];
    return [
      {key:'sku',label:'SKU'}, {key:'product_name',label:'Product'},
      {key:'authoritative_on_hand',label:'On hand',format:numberFormat}, {key:'stock_authority',label:'Authority'},
      {key:'inventory_signal',label:'Signal'}, {key:'reorder_target',label:'Target',format:numberFormat},
      {key:'units_30d',label:'30d demand',format:numberFormat},
    ];
  }
  if (workspace==='customers') return [
    {key:'store_name',label:'Store'}, {key:'suburb',label:'Suburb'}, {key:'price_group_id',label:'Price group'},
    {key:'orders_30d',label:'Orders 30d',format:numberFormat}, {key:'revenue_30d',label:'Revenue 30d',format:money},
    {key:'store_signal',label:'Signal'}, {key:'account_hold_active',label:'Hold'},
  ];
  if (workspace==='accounts') return [
    {key:'store_name',label:'Store'}, {key:'accounts_priority',label:'Priority'},
    {key:'open_statement_value',label:'Open',format:money}, {key:'overdue_statement_value',label:'Overdue',format:money},
    {key:'worst_overdue_days',label:'Worst days',format:numberFormat}, {key:'hold_active',label:'Hold'},
    {key:'hold_reason',label:'Reason'},
  ];
  return [
    {key:'return_code',label:'Return'}, {key:'store_name',label:'Store'}, {key:'order_number',label:'Order'},
    {key:'lifecycle_stage',label:'Stage'}, {key:'return_status',label:'Status'},
    {key:'inventory_consequence_status',label:'Inventory consequence'},
    {key:'account_consequence_status',label:'Account consequence'}, {key:'recorded_at',label:'Reported',format:adelaide},
  ];
}

function SummaryStrip({ summary }: { summary: Record<string,unknown> }) {
  const values=Object.entries(summary).filter(([,value])=>['string','number'].includes(typeof value) || value===null).slice(0,8);
  if (!values.length) return null;
  return <section className="operational-records-summary" aria-label="Workspace summary">
    {values.map(([key,value])=><article key={key}><span>{titleCase(key)}</span><strong>{display(value)}</strong></article>)}
  </section>;
}

function DetailRecord({ record }: { record: OperationalRecordDetail }) {
  const entries=Object.entries(record.data).filter(([,value])=>value!==null && value!==undefined && value!=='');
  return <article className="operational-record-detail-card">
    <dl>{entries.map(([key,value])=><div key={key}><dt>{titleCase(key)}</dt><dd>{key.endsWith('_at') ? adelaide(value) : display(value)}</dd></div>)}</dl>
  </article>;
}

function RecordDetail({
  workspace,
  recordId,
}: {
  workspace: OperationalRecordsWorkspace;
  recordId: string;
}) {
  const navigate=useNavigate();
  const location=useLocation();
  const tabs=DETAIL_TABS[workspace];
  const [activeTab,setActiveTab]=useState(tabs[0].label);
  const [records,setRecords]=useState<OperationalRecordDetail[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [reloadKey,setReloadKey]=useState(0);

  useEffect(()=>{ setActiveTab(tabs[0].label); },[recordId,workspace]);
  useEffect(()=>{
    let current=true;
    setLoading(true);
    setError('');
    void readOperationalRecordDetail({workspace,recordId,limit:50}).then((next)=>{
      if (current) setRecords(next);
    }).catch((detailError)=>{
      if (current) { setRecords([]); setError(detailError instanceof Error ? detailError.message : String(detailError)); }
    }).finally(()=>{ if (current) setLoading(false); });
    return ()=>{ current=false; };
  },[recordId,reloadKey,workspace]);

  const active=tabs.find((tab)=>tab.label===activeTab) ?? tabs[0];
  const visible=records.filter((record)=>active.kinds.includes(record.kind));
  const summary=records.find((record)=>record.kind==='SUMMARY')?.data;
  return <aside className="operational-record-drawer" aria-label={`${WORKSPACE_COPY[workspace].title} record detail`}>
    <header><div><span className="section-eyebrow">AUTHORITATIVE DETAIL</span><h2>{text(summary?.store_name) || text(summary?.product_name) || text(summary?.return_code) || recordId}</h2><small>{recordId}</small></div><button type="button" onClick={()=>navigate(`${basePath(workspace)}${location.search}`)}>Close</button></header>
    {(workspace==='accounts' || workspace==='returns') ? <div className="operational-record-command-gate">Commands remain withheld until the CAS gate passes.</div> : null}
    {workspace==='accounts' && summary ? <div className="operational-record-authority"><span>Release authority</span><strong>{display(summary.release_authority)}</strong></div> : null}
    {workspace==='returns' && summary ? <div className="operational-record-authority"><span>Inventory consequence</span><strong>{display(summary.inventory_consequence_status)}</strong></div> : null}
    <nav className="operational-record-detail-tabs" aria-label="Record detail sections">{tabs.map((tab)=><button key={tab.label} type="button" className={tab.label===active.label?'active':''} onClick={()=>setActiveTab(tab.label)}>{tab.label}</button>)}</nav>
    {loading ? <NativeWorkspaceLoading label="record detail"/> : null}
    {!loading && error ? <NativeWorkspaceUnavailable label="Record detail" detail={error} onRetry={()=>setReloadKey((value)=>value+1)}/> : null}
    {!loading && !error && visible.length===0 ? <NativeWorkspaceEmpty title="No recorded evidence" detail="The server returned no records for this section. EcoFlow has not inferred missing history."/> : null}
    {!loading && !error && visible.length ? <div className="operational-record-detail-list">{visible.map((record,index)=><DetailRecord key={`${record.kind}:${text(record.data.id)||text(record.data.event_at)||index}`} record={record}/>)}</div> : null}
  </aside>;
}

export function OperationalRecordsWorkspace({
  workspace,
  profile,
}: {
  workspace: OperationalRecordsWorkspace;
  profile: EcoFlowAuthProfile;
}) {
  const location=useLocation();
  const selected=selectedId(location.pathname,workspace);
  const definitions=VIEWS[workspace];
  const allowedTabs=definitions.map((view)=>view.id);
  const query=useWorkspaceQueryState({
    tab:definitions[0].id,search:'',filter:'',sort:'',page:1,pageSize:25,
    allowedTabs,allowedPageSizes:PAGE_SIZES,
  });
  const [searchDraft,setSearchDraft]=useState(query.state.search);
  const [result,setResult]=useState<OperationalRecordsPage>({rows:[],summary:{},totalCount:0,readAt:null});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [reloadKey,setReloadKey]=useState(0);
  const copy=WORKSPACE_COPY[workspace];
  const view=query.state.tab as OperationalRecordsView;
  const columns=useMemo(()=>columnsFor(workspace,view),[view,workspace]);

  const load=useCallback(async()=>{
    setLoading(true);
    setError('');
    try {
      setResult(await readOperationalRecordsPage({
        workspace,view,page:query.state.page,pageSize:query.state.pageSize as PageSize,
        search:query.state.search,filter:query.state.filter,sort:query.state.sort,
      }));
    } catch(loadError) {
      setResult({rows:[],summary:{},totalCount:0,readAt:null});
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally { setLoading(false); }
  },[query.state.filter,query.state.page,query.state.pageSize,query.state.search,query.state.sort,reloadKey,view,workspace]);

  useEffect(()=>{ void load(); },[load]);
  useEffect(()=>{ setSearchDraft(query.state.search); },[query.state.search]);

  function search(event: FormEvent) {
    event.preventDefault();
    query.update({search:searchDraft});
  }

  const totalPages=Math.max(1,Math.ceil(result.totalCount/query.state.pageSize));
  const detailEligible=view!=='movements' && view!=='cycle-count';
  return <NativeWorkspaceFrame
    eyebrow={copy.eyebrow}
    title={copy.title}
    detail={copy.detail}
    actions={<><span className="status-chip">{profile.app_role}</span><span className="status-chip">Read {adelaide(result.readAt)}</span><button type="button" onClick={()=>setReloadKey((value)=>value+1)}>Reload</button></>}
    notice={(workspace==='accounts' || workspace==='returns') ? '007A is deliberately read-only. Critical state changes stay unavailable until revision, idempotency and audit gates pass.' : undefined}
    noticeTone="information"
  >
    <nav className="native-workspace-tabs" aria-label={`${copy.title} views`}>{definitions.map((definition)=><button key={definition.id} type="button" className={definition.id===view?'active':''} onClick={()=>query.update({tab:definition.id})}>{definition.label}</button>)}</nav>
    <form className="operational-records-toolbar" onSubmit={search}>
      <label><span>Search</span><input value={searchDraft} placeholder={`Search ${copy.title.toLowerCase()}`} onChange={(event)=>setSearchDraft(event.target.value)}/></label>
      <label><span>Filter</span><input value={query.state.filter} placeholder="Exact status / signal" onChange={(event)=>query.update({filter:event.target.value})}/></label>
      <label><span>Rows</span><select value={query.state.pageSize} onChange={(event)=>query.update({pageSize:Number(event.target.value)})}>{PAGE_SIZES.map((size)=><option key={size} value={size}>{size}</option>)}</select></label>
      <button type="submit">Apply search</button><button type="button" onClick={()=>{setSearchDraft('');query.clear();}}>Clear URL state</button>
    </form>
    <SummaryStrip summary={result.summary}/>
    <div className={selected?'operational-records-layout has-detail':'operational-records-layout'}>
      <section className="operational-records-list">
        {loading ? <NativeWorkspaceLoading label={copy.title.toLowerCase()}/> : null}
        {!loading && error ? <NativeWorkspaceUnavailable label={copy.title} detail={error} onRetry={()=>setReloadKey((value)=>value+1)}/> : null}
        {!loading && !error && result.rows.length===0 ? <NativeWorkspaceEmpty title="No matching records" detail="The bounded server query completed successfully and returned no records."/> : null}
        {!loading && !error && result.rows.length ? <div className="native-server-table operational-records-table" role="region" aria-label={`${copy.title} results`} tabIndex={0}><table><caption>{result.totalCount.toLocaleString()} exact records</caption><thead><tr>{columns.map((column)=><th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{result.rows.map((row,index)=>{
          const id=recordIdFor(workspace,row);
          return <tr key={id||`${workspace}:${index}`} className={selected===id?'selected':undefined}>{columns.map((column,columnIndex)=><td key={column.key}>{columnIndex===0 && id && detailEligible ? <Link className="operational-record-link" to={`${detailPath(workspace,id)}${location.search}`}>{column.format?column.format(row[column.key]):display(row[column.key])}</Link> : column.format?column.format(row[column.key]):display(row[column.key])}</td>)}</tr>;
        })}</tbody></table></div> : null}
        {!loading && !error ? <nav className="native-workspace-pager" aria-label={`${copy.title} pagination`}><span>{result.totalCount.toLocaleString()} exact records · Page {Math.min(query.state.page,totalPages)} of {totalPages}</span><div className="row-actions"><button type="button" disabled={query.state.page<=1} onClick={()=>query.update({page:query.state.page-1},{preservePage:true})}>Previous</button><button type="button" disabled={query.state.page>=totalPages} onClick={()=>query.update({page:query.state.page+1},{preservePage:true})}>Next</button></div></nav> : null}
      </section>
      {selected ? <RecordDetail workspace={workspace} recordId={selected}/> : null}
    </div>
  </NativeWorkspaceFrame>;
}
