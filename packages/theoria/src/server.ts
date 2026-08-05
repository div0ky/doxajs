import { createServer, type Server } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

import { TheoriaStore } from './store.js'

export interface TheoriaServerOptions {
  readonly connectionString: string
  readonly host?: string
  readonly port?: number
  readonly profile?: 'development' | 'production-diagnostics'
  readonly access?: TheoriaAccess
  readonly audit?: (event: TheoriaAccessAuditEvent) => void
}

export type TheoriaAccess =
  | { readonly mode: 'loopback' }
  | { readonly mode: 'bearer'; readonly token: string; readonly operatorId: string }
  | {
      readonly mode: 'trusted-proxy'
      readonly identityHeader: string
      readonly allowedOperators: readonly string[]
      readonly trustedProxyAddresses: readonly string[]
      readonly proxyTrusted: true
    }

export interface TheoriaAccessAuditEvent {
  readonly occurredAt: string
  readonly path: string
  readonly method: string
  readonly remoteAddress?: string
  readonly operatorId?: string
  readonly outcome: 'allowed' | 'denied'
}

export interface TheoriaHost {
  readonly url: URL
  readonly shutdown: () => Promise<void>
}

export async function listenTheoria(options: TheoriaServerOptions): Promise<TheoriaHost> {
  const host = options.host ?? '127.0.0.1'
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'
  const access = options.access ?? { mode: 'loopback' }
  if (!loopback && options.profile !== 'production-diagnostics') {
    throw new Error('Non-loopback Theoria requires the production-diagnostics profile.')
  }
  if (!loopback && access.mode === 'loopback')
    throw new Error('Non-loopback Theoria requires protected operator access.')
  if (!loopback && !options.audit)
    throw new Error('Non-loopback Theoria requires operator access auditing.')
  validateAccess(access)
  const port = options.port ?? 4_400
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new TypeError('Theoria port must be between 0 and 65535.')
  const store = new TheoriaStore(options.connectionString)
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${host}`)
      const operatorId = authorizeRequest(request, access)
      if (!operatorId && access.mode !== 'loopback') {
        options.audit?.(accessEvent(request, url.pathname, 'denied'))
        if (access.mode === 'bearer') {
          response.setHeader('www-authenticate', 'Bearer realm="Theoria"')
        }
        return json(response, 401, {
          ok: false,
          code: 'operator_authentication_required',
          message: 'Protected Theoria operator access is required.',
          data: null,
        })
      }
      if (access.mode !== 'loopback')
        options.audit?.(accessEvent(request, url.pathname, 'allowed', operatorId))
      if (request.method !== 'GET')
        return json(response, 405, {
          ok: false,
          code: 'method_not_allowed',
          message: 'Theoria is read-only.',
          data: null,
        })
      if (url.pathname === '/api/executions') {
        const data = await store.executions({
          ...(url.searchParams.get('kind') ? { kind: url.searchParams.get('kind')! } : {}),
          ...(url.searchParams.get('phase') ? { phase: url.searchParams.get('phase')! } : {}),
          ...(url.searchParams.get('search') ? { search: url.searchParams.get('search')! } : {}),
          ...pagination(url),
        })
        return json(response, 200, { ok: true, data })
      }
      if (url.pathname === '/api/entries') {
        const kind = url.searchParams.get('kind')
        const data = await store.entries({
          ...(kind ? { kind } : {}),
          ...(url.searchParams.get('phase') ? { phase: url.searchParams.get('phase')! } : {}),
          ...(url.searchParams.get('search') ? { search: url.searchParams.get('search')! } : {}),
          ...pagination(url),
        })
        return json(response, 200, { ok: true, data })
      }
      if (url.pathname.startsWith('/api/timeline/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/timeline/'.length))
        if (!/^[0-9a-f-]{36}$/i.test(id))
          return json(response, 400, {
            ok: false,
            code: 'invalid_execution',
            message: 'Execution ID is invalid.',
            data: null,
          })
        return json(response, 200, {
          ok: true,
          data: await store.timeline(id, pagination(url)),
        })
      }
      if (url.pathname.startsWith('/api/waterfall/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/waterfall/'.length))
        if (!/^[0-9a-f-]{36}$/i.test(id))
          return json(response, 400, {
            ok: false,
            code: 'invalid_execution',
            message: 'Execution ID is invalid.',
            data: null,
          })
        return json(response, 200, {
          ok: true,
          data: await store.waterfall(id, pagination(url)),
        })
      }
      if (url.pathname === '/api/health')
        return json(response, 200, { ok: true, data: { service: 'theoria' } })
      if (url.pathname === '/' || url.pathname === '/index.html') {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        })
        response.end(THEORIA_HTML)
        return
      }
      return json(response, 404, {
        ok: false,
        code: 'not_found',
        message: 'Not found.',
        data: null,
      })
    } catch (error) {
      if (error instanceof TheoriaRequestError) {
        return json(response, 400, {
          ok: false,
          code: 'invalid_query',
          message: 'Theoria query parameters are invalid.',
          data: null,
        })
      }
      return json(response, 500, {
        ok: false,
        code: 'theoria_error',
        message: 'Theoria could not complete the request.',
        data: null,
      })
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Theoria did not expose a TCP address.')
  return {
    url: new URL(`http://${host === '::1' ? '[::1]' : host}:${address.port}/`),
    shutdown: async () => {
      await closeServer(server)
      await store.close()
    },
  }
}

function json(response: import('node:http').ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  response.end(JSON.stringify(body))
}

function pagination(url: URL): { readonly limit?: number; readonly beforeSequence?: number } {
  const limitText = url.searchParams.get('limit')
  const beforeText = url.searchParams.get('before')
  const limit = limitText === null ? undefined : Number(limitText)
  const beforeSequence = beforeText === null ? undefined : Number(beforeText)
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new TheoriaRequestError('Theoria limit must be a positive integer.')
  }
  if (
    beforeSequence !== undefined &&
    (!Number.isSafeInteger(beforeSequence) || beforeSequence <= 0)
  ) {
    throw new TheoriaRequestError('Theoria before cursor must be a positive safe integer.')
  }
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(beforeSequence === undefined ? {} : { beforeSequence }),
  }
}

class TheoriaRequestError extends Error {}

function validateAccess(access: TheoriaAccess): void {
  if (access.mode === 'bearer') {
    if (access.token.length < 32)
      throw new TypeError('Theoria bearer tokens must be at least 32 characters.')
    if (!access.operatorId.trim())
      throw new TypeError('Theoria bearer access requires an operator ID.')
  }
  if (access.mode === 'trusted-proxy') {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(access.identityHeader)) {
      throw new TypeError('Theoria trusted-proxy identityHeader is invalid.')
    }
    if (
      access.allowedOperators.length === 0 ||
      access.allowedOperators.some((operator) => !operator.trim())
    ) {
      throw new TypeError('Theoria trusted-proxy allowedOperators must contain operator IDs.')
    }
    if (
      access.trustedProxyAddresses.length === 0 ||
      access.trustedProxyAddresses.some((address) => !address.trim())
    ) {
      throw new TypeError(
        'Theoria trusted-proxy trustedProxyAddresses must contain proxy addresses.',
      )
    }
  }
}

function authorizeRequest(
  request: import('node:http').IncomingMessage,
  access: TheoriaAccess,
): string | undefined {
  if (access.mode === 'loopback') return 'loopback'
  if (access.mode === 'bearer') {
    const value = request.headers.authorization
    if (!value || !/^Bearer /i.test(value)) return undefined
    const candidate = Buffer.from(value.slice('Bearer '.length))
    const expected = Buffer.from(access.token)
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
      ? access.operatorId
      : undefined
  }
  const remoteAddress = request.socket.remoteAddress
  if (!remoteAddress || !access.trustedProxyAddresses.includes(remoteAddress)) return undefined
  const value = request.headers[access.identityHeader.toLowerCase()]
  const operatorId = Array.isArray(value) ? value[0] : value
  if (!operatorId?.trim()) return undefined
  if (!access.allowedOperators.includes(operatorId)) return undefined
  return operatorId
}

function accessEvent(
  request: import('node:http').IncomingMessage,
  path: string,
  outcome: TheoriaAccessAuditEvent['outcome'],
  operatorId?: string,
): TheoriaAccessAuditEvent {
  return Object.freeze({
    occurredAt: new Date().toISOString(),
    path,
    method: request.method ?? 'UNKNOWN',
    ...(request.socket.remoteAddress ? { remoteAddress: request.socket.remoteAddress } : {}),
    ...(operatorId ? { operatorId } : {}),
    outcome,
  })
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}

const THEORIA_HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Theoria · Doxa.js</title><style>
:root{color-scheme:dark;--bg:#070d1a;--panel:#0b1220;--panel2:#111a2d;--line:#263451;--muted:#91a0b8;--text:#eff6ff;--primary:#3b82f6;--tertiary:#f97316;--danger:#ef4444;--mono:ui-monospace,SFMono-Regular,Menlo,monospace;--sans:Inter,ui-sans-serif,system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 60% -20%,#172554 0,transparent 44%),var(--bg);color:var(--text);font:13px/1.45 var(--sans);overflow:hidden}button,input,select{font:inherit;color:inherit}.shell{height:100vh;display:grid;grid-template-rows:68px 1fr 28px}.top{display:grid;grid-template-columns:390px 1fr 260px;align-items:center;border-bottom:1px solid var(--line);padding:0 20px;gap:20px}.brand{display:flex;gap:13px;align-items:center}.mark{width:34px;height:34px;border:1px solid #2563eb;background:#172554;display:grid;place-items:center;color:var(--primary);font-size:20px;border-radius:9px}.brand strong{display:block;font-size:19px;letter-spacing:-.02em}.brand small{color:var(--muted)}.search{height:40px;border:1px solid #334155;border-radius:9px;background:#070d1a;display:flex;align-items:center;padding:0 13px;gap:10px}.search input{border:0;outline:0;background:transparent;width:100%;font-family:var(--mono)}.local{justify-self:end;border:1px solid #334155;background:#0f172a;border-radius:8px;padding:8px 13px}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--primary);margin-right:8px;box-shadow:0 0 10px #3b82f688}.workspace{min-height:0;display:grid;grid-template-columns:minmax(300px,25%) minmax(500px,1fr) minmax(330px,27%)}.pane{min-width:0;min-height:0;border-right:1px solid var(--line);display:flex;flex-direction:column}.pane:last-child{border-right:0}.pane-head{height:52px;flex:none;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 18px}.pane-head h2{font-size:14px;margin:0}.filters{padding:10px 12px;border-bottom:1px solid var(--line);display:flex;gap:6px;overflow:auto}.chip{border:1px solid var(--line);background:transparent;border-radius:6px;padding:5px 9px;color:var(--muted);cursor:pointer}.chip.active{background:#172554;color:var(--text);border-color:var(--primary)}.scroll{overflow:auto;min-height:0}.execution{width:calc(100% - 20px);margin:8px 10px;padding:13px;border:1px solid transparent;background:transparent;text-align:left;display:grid;gap:8px;cursor:pointer;border-radius:7px}.execution:hover{background:#0f172a}.execution.active{background:#111c35;border-color:var(--primary)}.execution.failed{border-left:2px solid var(--danger)}.execution-top,.execution-meta{display:flex;align-items:center;gap:8px}.execution-name{font:600 13px var(--mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.execution-meta{color:var(--muted);font:11px var(--mono)}.execution-meta .duration{margin-left:auto}.status{width:8px;height:8px;border-radius:50%;background:var(--primary)}.status.failed{background:var(--danger)}.kind{font:10px var(--mono);text-transform:uppercase;color:var(--tertiary);background:#431407;padding:3px 5px;border-radius:4px}.empty{margin:auto;text-align:center;color:var(--muted);max-width:280px;padding:30px}.empty strong{display:block;color:var(--text);font-size:15px;margin-bottom:6px}.timeline{padding:22px 20px 60px}.observation{position:relative;display:grid;grid-template-columns:72px 26px minmax(0,1fr) auto;gap:10px;min-height:86px}.observation:before{content:"";position:absolute;left:84px;top:23px;bottom:-10px;width:1px;background:var(--primary)}.observation:last-child:before{display:none}.time{color:var(--muted);font:11px var(--mono);padding-top:6px;text-align:right}.node{width:12px;height:12px;margin:5px auto;border:2px solid var(--primary);background:var(--bg);border-radius:50%;z-index:1}.node.failed{border-color:var(--danger);box-shadow:0 0 0 5px #ef444419}.obs-card{padding:1px 10px 15px;cursor:pointer;min-width:0}.obs-card:hover .obs-name{color:var(--primary)}.obs-kind{font:10px var(--mono);text-transform:uppercase;color:var(--muted)}.obs-name{font:600 14px var(--mono);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.obs-role{font:11px var(--mono);color:var(--muted);margin-top:4px}.obs-duration{font:11px var(--mono);color:var(--muted);padding-top:6px}.inspector{padding:18px;display:grid;gap:20px}.failure{color:var(--danger);font-weight:650}.section h3{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 9px}.kv{display:grid;grid-template-columns:110px 1fr;gap:7px;font:11px var(--mono)}.kv dt{color:var(--muted)}.kv dd{margin:0;overflow-wrap:anywhere}.code{margin:0;background:#070d1a;border:1px solid var(--line);border-radius:7px;padding:12px;white-space:pre-wrap;overflow:auto;max-height:280px;color:#bfdbfe;font:11px/1.55 var(--mono)}.footer{border-top:1px solid var(--line);display:flex;align-items:center;padding:0 14px;color:var(--muted);font:10px var(--mono)}.footer span:last-child{margin-left:auto}.error-banner{padding:9px 14px;background:#3b1715;color:#fecaca;border-bottom:1px solid #7f1d1d;display:none}.loading{opacity:.55;pointer-events:none}@media(max-width:1050px){.workspace{grid-template-columns:320px 1fr}.inspector-pane{position:fixed;right:0;top:68px;bottom:28px;width:390px;background:var(--panel);box-shadow:-20px 0 60px #0008}.top{grid-template-columns:280px 1fr}.local{display:none}}@media(max-width:720px){body{overflow:auto}.shell{height:auto;min-height:100vh}.top{grid-template-columns:1fr;padding:12px;height:auto}.search{display:none}.workspace{display:block}.pane{height:55vh;border-bottom:1px solid var(--line)}.inspector-pane{position:static;width:auto}.footer{display:none}}
</style><style>
.filters{flex:0 0 auto;overflow-x:auto;overflow-y:hidden}.chip{flex:0 0 auto}.scroll{flex:1 1 auto}
	.kv{grid-template-columns:110px minmax(0,1fr)}
	.view-switch{display:flex;gap:5px}.view-switch button{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:5px;padding:4px 7px;cursor:pointer}.view-switch button.active{color:var(--text);border-color:var(--primary);background:#172554}.waterfall{padding:18px 14px 50px}.waterfall-row{display:grid;grid-template-columns:minmax(180px,38%) minmax(180px,1fr) 72px;align-items:center;gap:10px;min-height:48px;cursor:pointer}.waterfall-row:hover{background:#0f172a}.waterfall-label{min-width:0;padding-left:calc(var(--depth)*16px);font:11px var(--mono)}.waterfall-label strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.waterfall-label span{color:var(--muted);font-size:10px}.waterfall-track{height:18px;position:relative;background:#0f172a;border:1px solid var(--line);border-radius:4px;overflow:hidden}.waterfall-bar{position:absolute;top:2px;bottom:2px;left:var(--left);width:max(3px,var(--width));background:var(--primary);border-radius:2px}.waterfall-bar.failed{background:var(--danger)}.waterfall-duration{color:var(--muted);font:10px var(--mono);text-align:right}.execution-link{border:1px solid var(--primary);background:#172554;border-radius:5px;padding:5px 7px;cursor:pointer;color:var(--text);font:10px var(--mono)}
@media(max-width:720px){body{overflow-x:hidden;overflow-y:auto}.shell{width:100%;height:auto;min-height:100vh}.workspace{display:block;width:100%;min-width:0;max-width:100%;overflow:hidden}.pane{width:100%;min-width:0;max-width:100%;height:55vh}.timeline{padding:18px 10px 45px}.observation{grid-template-columns:44px 20px minmax(0,1fr) auto;gap:6px}.observation:before{left:55px}.inspector-pane{width:100%}.kv{grid-template-columns:88px minmax(0,1fr)}}
</style></head><body><div class="shell">
<header class="top"><div class="brand"><div class="mark">⌁</div><div><strong>Theoria</strong><small>Everything beneath the surface</small></div></div><label class="search"><span>⌕</span><input id="search" placeholder="Search executions, routes, jobs, events, roles…"></label><button class="local"><span class="dot"></span>Local</button></header>
<main class="workspace"><section class="pane"><div class="pane-head"><h2 id="rail-title">Executions</h2><span id="count">0</span></div><div class="filters" id="filters"><button class="chip active" data-kind="" data-phase="">All</button><button class="chip" data-kind="http">HTTP</button><button class="chip" data-kind="job">Queue</button><button class="chip" data-kind="event">Events</button><button class="chip" data-kind="schedule">Schedules</button><button class="chip" data-phase="failed">Failed</button></div><div class="error-banner" id="error"></div><div class="scroll" id="executions"><div class="empty"><strong>Waiting beneath the surface</strong>Run your Doxa application and executions will appear here.</div></div></section>
<section class="pane"><div class="pane-head"><h2 id="detail-title">Timeline</h2><div class="view-switch"><button class="active" data-view="timeline">Timeline</button><button data-view="waterfall">Waterfall</button></div><span id="correlation"></span></div><div class="scroll timeline" id="timeline"><div class="empty"><strong>Choose an execution</strong>Follow every action, query, transaction, model, event, listener, job and exception in causal order.</div></div></section>
<aside class="pane inspector-pane"><div class="pane-head"><h2>Inspector</h2><span id="selected-kind">—</span></div><div class="scroll inspector" id="inspector"><div class="empty"><strong>No observation selected</strong>Select a point on the timeline to inspect its safe, redacted evidence.</div></div></aside></main>
<footer class="footer"><span><span class="dot"></span>Watching PostgreSQL</span><span>Read-only · secrets redacted</span></footer></div>
<script type="module">
const state={executions:[],timeline:[],waterfall:[],execution:null,entry:null,observation:null,kind:'',phase:'',search:'',view:'timeline',loading:false,reload:false,reset:false,listRequest:0,detailRequest:0};const el=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const fmt=v=>v==null?'—':v<1?v.toFixed(2)+' ms':v<1000?Math.round(v)+' ms':(v/1000).toFixed(2)+' s';
async function api(url){const r=await fetch(url);const body=await r.json();if(!r.ok||!body.ok)throw new Error(body.message||'Theoria request failed');return body.data}
async function loadExecutions(resetSelection=false){if(state.loading){if(resetSelection){state.reload=true;state.reset=true;state.listRequest++}return}state.loading=true;const request=++state.listRequest;try{el('error').style.display='none';const p=new URLSearchParams();if(state.kind)p.set('kind',state.kind);if(state.phase)p.set('phase',state.phase);if(state.search)p.set('search',state.search);const executions=await api('/api/entries?'+p);if(request!==state.listRequest)return;state.executions=executions;if(resetSelection){state.detailRequest++;state.execution=null;state.entry=null;state.observation=null}renderExecutions(!resetSelection);if(state.execution)await chooseExecution(state.execution,state.entry||undefined,true);else if(state.executions[0])await chooseExecution(state.executions[0].executionId,state.executions[0].entryId);else{state.timeline=[];state.waterfall=[];el('correlation').textContent='';renderDetail();renderInspector()}}catch(e){if(request!==state.listRequest)return;el('error').textContent=e.message;el('error').style.display='block'}finally{state.loading=false;if(state.reload){const reset=state.reset;state.reload=false;state.reset=false;loadExecutions(reset)}}}
function renderExecutions(preserve=true){const scroll=el('executions');const scrollTop=scroll.scrollTop;const scrollLeft=scroll.scrollLeft;const titles={http:'HTTP',job:'Queue',event:'Events',schedule:'Schedules'};el('rail-title').textContent=titles[state.kind]||'Activity';el('count').textContent=state.executions.length;scroll.innerHTML=state.executions.length?state.executions.map(x=>'<button class="execution '+((x.entryId||x.executionId)===(state.entry||state.execution)?'active ':'')+(x.phase==='failed'?'failed':'')+'" data-id="'+esc(x.executionId)+'" data-entry="'+esc(x.entryId||'')+'"><div class="execution-top"><span class="status '+(x.phase==='failed'?'failed':'')+'"></span><span class="kind">'+esc(x.kind||x.transport||'run')+'</span><span class="execution-name">'+esc(x.name)+'</span></div><div class="execution-meta"><span>'+new Date(x.occurredAt).toLocaleTimeString()+'</span><span>· '+esc(x.phase)+'</span><span class="duration">'+fmt(x.durationMilliseconds)+'</span></div></button>').join(''):'<div class="empty"><strong>No '+esc((titles[state.kind]||'activity').toLowerCase())+' recorded</strong>Run your Doxa application and matching evidence will appear here.</div>';scroll.scrollTo(...(preserve?[scrollLeft,scrollTop]:[0,0]));document.querySelectorAll('.execution').forEach(b=>b.onclick=()=>{state.reset=false;chooseExecution(b.dataset.id,b.dataset.entry||undefined)})}
async function chooseExecution(id,entryId,preserve=false){if(!preserve)state.listRequest++;const request=++state.detailRequest;const sameExecution=state.execution===id;let timeline,waterfall;try{[timeline,waterfall]=await Promise.all([api('/api/timeline/'+encodeURIComponent(id)),api('/api/waterfall/'+encodeURIComponent(id))])}catch(e){if(request!==state.detailRequest)return;el('error').textContent=e.message;el('error').style.display='block';return}if(request!==state.detailRequest)return;const observationId=preserve&&sameExecution?state.observation?.id:null;const positions=preserve&&sameExecution?[el('timeline'),el('inspector'),...document.querySelectorAll('#inspector .code')].map(x=>[x.scrollLeft,x.scrollTop]):null;state.execution=id;state.entry=entryId||null;renderExecutions();state.timeline=timeline;state.waterfall=waterfall;state.observation=(observationId?state.timeline.find(x=>x.id===observationId):null)||(entryId?state.timeline.find(x=>x.id===entryId):null)||state.timeline.findLast(x=>x.phase==='failed')||state.timeline.at(-1)||null;el('correlation').textContent=state.timeline[0]?.context?.correlationId?'correlation '+state.timeline[0].context.correlationId.slice(0,8):'';renderDetail();renderInspector();if(positions)[el('timeline'),el('inspector'),...document.querySelectorAll('#inspector .code')].forEach((x,i)=>{if(positions[i])x.scrollTo(...positions[i])})}
function renderDetail(){el('detail-title').textContent=state.view==='waterfall'?'Waterfall':'Timeline';el('timeline').className='scroll '+(state.view==='waterfall'?'waterfall':'timeline');if(state.view==='waterfall')renderWaterfall();else renderTimeline()}
function renderTimeline(){if(!state.timeline.length){el('timeline').innerHTML='<div class="empty"><strong>No evidence recorded</strong>This execution has no observations.</div>';return}const base=Date.parse(state.timeline[0].occurredAt);el('timeline').innerHTML=state.timeline.map(x=>'<div class="observation"><div class="time">+'+(Date.parse(x.occurredAt)-base)+' ms</div><div class="node '+(x.phase==='failed'?'failed':'')+'"></div><div class="obs-card" data-id="'+esc(x.id)+'"><div class="obs-kind">'+esc(x.kind)+' · '+esc(x.phase)+' · execution '+esc((x.context.executionId||'unknown').slice(0,8))+'</div><div class="obs-name">'+esc(x.name)+'</div><div class="obs-role">'+esc(x.roleId||x.context.transportName||'framework boundary')+'</div></div><div class="obs-duration">'+fmt(x.durationMilliseconds)+'</div></div>').join('');document.querySelectorAll('.obs-card').forEach(b=>b.onclick=()=>{state.observation=state.timeline.find(x=>x.id===b.dataset.id);renderInspector()})}
function renderWaterfall(){if(!state.waterfall.length){el('timeline').innerHTML='<div class="empty"><strong>No timed spans recorded</strong>Instantaneous evidence remains available in the timeline.</div>';return}const byId=new Map(state.waterfall.map(x=>[x.spanId,x]));const depth=(x,seen=new Set())=>!x.parentSpanId||!byId.has(x.parentSpanId)||seen.has(x.spanId)?0:1+depth(byId.get(x.parentSpanId),new Set([...seen,x.spanId]));const base=Math.min(...state.waterfall.map(x=>Date.parse(x.startedAt)));const end=Math.max(...state.waterfall.map(x=>Date.parse(x.endedAt)));const total=Math.max(1,end-base);el('timeline').innerHTML=state.waterfall.map(x=>'<div class="waterfall-row" data-span="'+esc(x.spanId)+'" style="--depth:'+depth(x)+'"><div class="waterfall-label"><strong>'+esc(x.name)+'</strong><span>'+esc(x.kind)+' · '+esc((x.executionId||'unknown').slice(0,8))+'</span></div><div class="waterfall-track"><div class="waterfall-bar '+(x.status==='error'?'failed':'')+'" style="--left:'+((Date.parse(x.startedAt)-base)/total*100)+'%;--width:'+Math.max(.5,x.durationMilliseconds/total*100)+'%"></div></div><div class="waterfall-duration">'+fmt(x.durationMilliseconds)+'</div></div>').join('');document.querySelectorAll('.waterfall-row').forEach(b=>b.onclick=()=>{state.observation=state.timeline.findLast(x=>x.context?.spanId===b.dataset.span&&x.phase!=='started')||state.timeline.find(x=>x.context?.spanId===b.dataset.span);renderInspector()})}
function renderInspector(){const x=state.observation;if(!x){el('selected-kind').textContent='—';el('inspector').innerHTML='<div class="empty"><strong>No observation selected</strong>Select a point on the timeline to inspect its safe, redacted evidence.</div>';return}el('selected-kind').textContent=x.kind;const context=Object.entries(x.context||{}).map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(Array.isArray(v)?JSON.stringify(v):v)+'</dd>').join('');const lineage=(x.context?.sourceExecutionId?'<button class="execution-link" data-execution-link="'+esc(x.context.sourceExecutionId)+'">Open source execution '+esc(x.context.sourceExecutionId.slice(0,8))+'</button>':'')+(x.context?.executionId&&x.context.executionId!==state.execution?'<button class="execution-link" data-execution-link="'+esc(x.context.executionId)+'">Open execution '+esc(x.context.executionId.slice(0,8))+'</button>':'');el('inspector').innerHTML='<section class="section"><h3>Observation</h3><div class="'+(x.phase==='failed'?'failure':'')+'">'+esc(x.name)+' · '+esc(x.phase)+'</div></section>'+(lineage?'<section class="section"><h3>Causal navigation</h3>'+lineage+'</section>':'')+(x.error?'<section class="section"><h3>Exception</h3><div class="kv"><dt>class</dt><dd>'+esc(x.error.name)+'</dd><dt>message</dt><dd>'+esc(x.error.message)+'</dd></div></section>':'')+'<section class="section"><h3>Context</h3><dl class="kv"><dt>occurred</dt><dd>'+esc(new Date(x.occurredAt).toLocaleString())+'</dd><dt>duration</dt><dd>'+fmt(x.durationMilliseconds)+'</dd>'+context+'</dl></section><section class="section"><h3>Safe attributes</h3><pre class="code">'+esc(JSON.stringify(x.attributes,null,2))+'</pre></section>'+(x.error?.stack?'<section class="section"><h3>Stack</h3><pre class="code">'+esc(x.error.stack)+'</pre></section>':'');document.querySelectorAll('[data-execution-link]').forEach(b=>b.onclick=()=>{state.reset=false;chooseExecution(b.dataset.executionLink)})}
el('filters').onclick=e=>{const b=e.target.closest('[data-kind],[data-phase]');if(!b)return;state.kind=b.dataset.kind??'';state.phase=b.dataset.phase??'';document.querySelectorAll('.chip').forEach(x=>x.classList.toggle('active',x===b));loadExecutions(true)};document.querySelector('.view-switch').onclick=e=>{const b=e.target.closest('[data-view]');if(!b)return;state.view=b.dataset.view;document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('active',x===b));renderDetail()};let timer;el('search').oninput=e=>{clearTimeout(timer);timer=setTimeout(()=>{state.search=e.target.value;loadExecutions(true)},180)};loadExecutions();setInterval(loadExecutions,3000);
</script></body></html>`
