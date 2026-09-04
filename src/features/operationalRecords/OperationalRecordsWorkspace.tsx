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
  CUSTOMER_MASTER_COLUMN_ORDER,
  CUSTOMER_MASTER_DETAIL_TAB_ORDER,
  CUSTOMER_MASTER_FILTER_ORDER,
  isDeferredCustomerMetricKey,
  projectCustomerMasterRow,
  readOperationalRecordDetail,
  readOperationalRecordsPage,
  type OperationalRecordDetail,
  type OperationalRecordsPage,
  type OperationalRecordsView,
  type OperationalRecordsWorkspace,
} from '@/data/repositories/operationalRecords';
import { AccountHoldCommandPanel } from './AccountHoldCommandPanel';
import { ReturnCommandPanel } from './ReturnCommandPanel';
import './operationalRecordsWorkspace.css';

const PAGE_SIZES = [10,20,25,50,100] as const;
type PageSize = (typeof PAGE_SIZES)[number];
type DataRow = Record<string, unknown>;
type Column = {
  key: string;
  label: string;
  format?: (value: unknown) => string;
  value?: (row: DataRow) => unknown;
  action?: boolean;
};
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
    detail: 'Ordermentum-owned Customer Master facts. Missing master fields stay unavailable and governed commercial metrics remain outside #340A.',
    eyebrow: 'CUSTOMER MASTER READ',
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

const CUSTOMER_OPERATIONAL_EVIDENCE_DOMAINS = ['Orders','Delivery','Pricing','Accounts','Contacts','Timeline'] as const;

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
    { label:'Details',kinds:['SUMMARY'] },
    { label:'Contact',kinds:['CONTACT'] },
    { label:'Address',kinds:['ADDRESS'] },
    { label:'Sell Price Tier',kinds:['PRICING'] },
    { label:'Other Customer Details',kinds:['CUSTOMER_DETAIL','ACCOUNT','TIMELINE'] },
    { label:'Sales',kinds:['ORDER'] },
    { label:'Shipments',kinds:['DELIVERY'] },
    { label:'Costings',kinds:[] },
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

function customerDisplay(value: unknown) {
  const rendered=display(value);
  return rendered==='—' ? 'Unavailable' : rendered;
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
  if (workspace==='customers') return projectCustomerMasterRow(row).recordId || '';
  if (workspace==='accounts') return text(row.store_id);
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
    {key:'code',label:'Code',value:(row)=>projectCustomerMasterRow(row).code,format:customerDisplay},
    {key:'name',label:'Name',value:(row)=>projectCustomerMasterRow(row).name,format:customerDisplay},
    {key:'customer-type',label:'Customer Type',value:(row)=>projectCustomerMasterRow(row).customerType,format:customerDisplay},
    {key:'currency',label:'Currency',value:(row)=>projectCustomerMasterRow(row).currency,format:customerDisplay},
    {key:'website',label:'Website',value:(row)=>projectCustomerMasterRow(row).website,format:customerDisplay},
    {key:'phone',label:'Phone',value:(row)=>projectCustomerMasterRow(row).phone,format:customerDisplay},
    {key:'mobile',label:'Mobile',value:(row)=>projectCustomerMasterRow(row).mobile,format:customerDisplay},
    {key:'email',label:'Email',value:(row)=>projectCustomerMasterRow(row).email,format:customerDisplay},
    {key:'action',label:'Action',action:true},
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

function SummaryStrip({ summary, workspace }: { summary: Record<string,unknown>; workspace: OperationalRecordsWorkspace }) {
  const values=Object.entries(summary)
    .filter(([key])=>workspace!=='customers' || !isDeferredCustomerMetricKey(key))
    .filter(([,value])=>['string','number'].includes(typeof value) || value===null)
    .slice(0,8);
  if (!values.length) return null;
  return <section className="operational-records-summary" aria-label="Workspace summary">
    {values.map(([key,value])=><article key={key}><span>{titleCase(key)}</span><strong>{display(value)}</strong></article>)}
  </section>;
}

function DetailRecord({ record, workspace }: { record: OperationalRecordDetail; workspace: OperationalRecordsWorkspace }) {
  const entries=Object.entries(record.data)
    .filter(([key])=>workspace!=='customers' || !isDeferredCustomerMetricKey(key))
    .filter(([,value])=>value!==null && value!==undefined && value!=='');
  return <article className="operational-record-detail-card">
    <dl>{entries.map(([key,value])=><div key={key}><dt>{titleCase(key)}</dt><dd>{key.endsWith('_at') ? adelaide(value) : display(value)}</dd></div>)}</dl>
  </article>;
}

function RecordDetail({
  workspace,
  recordId,
  profile,
  onAuthorityChanged,
}: {
  workspace: OperationalRecordsWorkspace;
  recordId: string;
  profile: EcoFlowAuthProfile;
  onAuthorityChanged: () => void;
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
  const deferredCustomerCostings=workspace==='customers' && active.label==='Costings';
  const refreshAfterCommand=()=>{
    setReloadKey((value)=>value+1);
    onAuthorityChanged();
  };
  return <aside className="operational-record-drawer" aria-label={`${WORKSPACE_COPY[workspace].title} record detail`}>
    <header><div><span className="section-eyebrow">AUTHORITATIVE DETAIL</span><h2>{text(summary?.store_name) || text(summary?.product_name) || text(summary?.return_code) || recordId}</h2><small>{recordId}</small></div><button type="button" onClick={()=>navigate(`${basePath(workspace)}${location.search}`)}>Close</button></header>
    {workspace==='accounts' ? <AccountHoldCommandPanel storeId={recordId} role={profile.app_role} onAuthorityChanged={refreshAfterCommand}/> : null}
    {workspace==='returns' ? <ReturnCommandPanel returnId={recordId} role={profile.app_role} onAuthorityChanged={refreshAfterCommand}/> : null}
    {workspace==='accounts' && summary ? <div className="operational-record-authority"><span>Release authority</span><strong>{display(summary.release_authority)}</strong></div> : null}
    {workspace==='returns' && summary ? <div className="operational-record-authority"><span>Inventory consequence</span><strong>{display(summary.inventory_consequence_status)}</strong></div> : null}
    {workspace==='customers' ? <div className="operational-record-authority"><span>Customer authority</span><strong>Ordermentum-owned facts only</strong></div> : null}
    {workspace==='customers' ? <div className="operational-record-authority"><span>Operational evidence coverage</span><strong>{CUSTOMER_OPERATIONAL_EVIDENCE_DOMAINS.join(' · ')}</strong></div> : null}
    {workspace==='inventory' ? <div className="operational-record-authority"><span>Inventory authority</span><strong>Governed location-ledger facts</strong></div> : null}
    <nav className="operational-record-detail-tabs" aria-label="Record detail sections">{tabs.map((tab)=><button key={tab.label} type="button" className={tab.label===active.label?'active':''} onClick={()=>setActiveTab(tab.label)}>{tab.label}</button>)}</nav>
    {loading ? <NativeWorkspaceLoading label="record detail"/> : null}
    {!loading && error ? <NativeWorkspaceUnavailable label="Record detail" detail={error} onRetry={()=>setReloadKey((value)=>value+1)}/> : null}
    {!loading && !error && deferredCustomerCostings ? <div className="operational-records-boundary" data-state="unavailable"><strong>Costings unavailable in #340A</strong><span>Revenue, Gross Profit and governed profitability metrics enter only through #345 metric registry. No local calculation is performed here.</span></div> : null}
    {!loading && !error && !deferredCustomerCostings && visible.length===0 ? <NativeWorkspaceEmpty title="No recorded evidence" detail="The server returned no records for this section. EcoFlow has not inferred missing history."/> : null}
    {!loading && !error && !deferredCustomerCostings && visible.length ? <div className="operational-record-detail-list">{visible.map((record,index)=><DetailRecord key={`${record.kind}:${text(record.data.id)||text(record.data.event_at)||index}`} record={record} workspace={workspace}/>)}</div> : null}
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
    allowedTabs,allowedFilters:workspace==='customers' ? [''] : undefined,allowedPageSizes:PAGE_SIZES,
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
        search:query.state.search,filter:workspace==='customers' ? null : query.state.filter,sort:query.state.sort,
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
  const releaseNotice=workspace==='accounts'
    ? '007B Accounts hold/release uses server-owned revision, idempotency and audit authority. The UI waits for server acknowledgement and authoritative readback.'
    : workspace==='returns'
      ? '007C Returns disposition/close uses server-owned revision, idempotency, inventory consequence and audit authority. The UI waits for server acknowledgement and authoritative readback.'
      : undefined;
  return <NativeWorkspaceFrame
    eyebrow={copy.eyebrow}
    title={copy.title}
    detail={copy.detail}
    actions={<><span className="status-chip">{profile.app_role}</span><span className="status-chip">Read {adelaide(result.readAt)}</span><button type="button" onClick={()=>setReloadKey((value)=>value+1)}>Reload</button></>}
    notice={releaseNotice}
    noticeTone="information"
  >
    <div
      data-customer-filter-contract={workspace==='customers' ? CUSTOMER_MASTER_FILTER_ORDER.join(',') : undefined}
      data-customer-column-contract={workspace==='customers' ? CUSTOMER_MASTER_COLUMN_ORDER.join(',') : undefined}
      data-customer-detail-contract={workspace==='customers' ? CUSTOMER_MASTER_DETAIL_TAB_ORDER.join(',') : undefined}
    >
      <nav className="native-workspace-tabs" aria-label={`${copy.title} views`}>{definitions.map((definition)=><button key={definition.id} type="button" className={definition.id===view?'active':''} onClick={()=>query.update({tab:definition.id})}>{definition.label}</button>)}</nav>
      {workspace==='customers' ? <form className="operational-records-toolbar customer-master-toolbar" onSubmit={search}>
        <label><span>Customer Type</span><select disabled defaultValue=""><option value="">Unavailable from governed master read</option></select></label>
        <label><span>Customer</span><input value={searchDraft} placeholder="Customer code or name" onChange={(event)=>setSearchDraft(event.target.value)}/></label>
        <label><span>Obsolete</span><select disabled defaultValue=""><option value="">Unavailable from governed master read</option></select></label>
        <label><span>Rows</span><select value={query.state.pageSize} onChange={(event)=>query.update({pageSize:Number(event.target.value)})}>{PAGE_SIZES.map((size)=><option key={size} value={size}>{size}</option>)}</select></label>
        <button type="submit">Apply customer search</button><button type="button" onClick={()=>{setSearchDraft('');query.clear();}}>Clear URL state</button>
      </form> : <form className="operational-records-toolbar" onSubmit={search}>
        <label><span>Search</span><input value={searchDraft} placeholder={`Search ${copy.title.toLowerCase()}`} onChange={(event)=>setSearchDraft(event.target.value)}/></label>
        <label><span>Filter</span><input value={query.state.filter} placeholder="Exact status / signal" onChange={(event)=>query.update({filter:event.target.value})}/></label>
        <label><span>Rows</span><select value={query.state.pageSize} onChange={(event)=>query.update({pageSize:Number(event.target.value)})}>{PAGE_SIZES.map((size)=><option key={size} value={size}>{size}</option>)}</select></label>
        <button type="submit">Apply search</button><button type="button" onClick={()=>{setSearchDraft('');query.clear();}}>Clear URL state</button>
      </form>}
      {workspace==='inventory' ? <section className="operational-records-boundary" data-state="governed"><strong>Governed inventory read authority</strong><span>Location-ledger and physical movement facts remain separate from Product Identity. Unleashed warehouse-level reference quantities are not allocated to a preferred Physical SKU.</span><small>Freshness: {adelaide(result.readAt)} · read-only server RPC</small></section> : null}
      {workspace==='customers' ? <section className="operational-records-boundary" data-state="governed"><strong>Ordermentum-owned Customer Master read</strong><span>Only explicit source-owned master fields are displayed. Missing Customer Type, Currency, Website, Phone, Mobile, Email or Obsolete facts remain Unavailable.</span><small>Revenue / Gross Profit are deferred to #345 governed metric registry · freshness {adelaide(result.readAt)}</small></section> : null}
      {workspace==='customers' ? null : <SummaryStrip summary={result.summary} workspace={workspace}/>}
      <div className={selected?'operational-records-layout has-detail':'operational-records-layout'}>
        <section className="operational-records-list">
          {loading ? <NativeWorkspaceLoading label={copy.title.toLowerCase()}/> : null}
          {!loading && error ? <NativeWorkspaceUnavailable label={copy.title} detail={error} onRetry={()=>setReloadKey((value)=>value+1)}/> : null}
          {!loading && !error && result.rows.length===0 ? <NativeWorkspaceEmpty title="No matching records" detail="The bounded server query completed successfully and returned no records."/> : null}
          {!loading && !error && result.rows.length ? <div className="native-server-table operational-records-table" role="region" aria-label={`${copy.title} results`} tabIndex={0}><table><caption>{result.totalCount.toLocaleString()} exact records</caption><thead><tr>{columns.map((column)=><th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{result.rows.map((row,index)=>{
            const id=recordIdFor(workspace,row);
            return <tr key={id||`${workspace}:${index}`} className={selected===id?'selected':undefined}>{columns.map((column,columnIndex)=>{
              const value=column.value ? column.value(row) : row[column.key];
              const rendered=column.format ? column.format(value) : display(value);
              if (column.action) return <td key={column.key}>{id && detailEligible ? <Link className="operational-record-link" to={`${detailPath(workspace,id)}${location.search}`}>View</Link> : 'Unavailable'}</td>;
              if (columnIndex===0 && id && detailEligible && workspace!=='customers') return <td key={column.key}><Link className="operational-record-link" to={`${detailPath(workspace,id)}${location.search}`}>{rendered}</Link></td>;
              return <td key={column.key}>{rendered}</td>;
            })}</tr>;
          })}</tbody></table></div> : null}
          {!loading && !error ? <nav className="native-workspace-pager" aria-label={`${copy.title} pagination`}><span>{result.totalCount.toLocaleString()} exact records · Page {Math.min(query.state.page,totalPages)} of {totalPages}</span><div className="row-actions"><button type="button" disabled={query.state.page<=1} onClick={()=>query.update({page:query.state.page-1},{preservePage:true})}>Previous</button><button type="button" disabled={query.state.page>=totalPages} onClick={()=>query.update({page:query.state.page+1},{preservePage:true})}>Next</button></div></nav> : null}
        </section>
        {selected ? <RecordDetail workspace={workspace} recordId={selected} profile={profile} onAuthorityChanged={()=>setReloadKey((value)=>value+1)}/> : null}
      </div>
    </div>
  </NativeWorkspaceFrame>;
}
