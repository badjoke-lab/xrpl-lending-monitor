#!/usr/bin/env bash
set -euo pipefail
python - <<'PY'
import base64
import gzip
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

START_MS=1784968200000
END_MS=1784971500000
SLOT_MS=300000
EXPECTED=[START_MS+i*SLOT_MS for i in range(12)]
PRODUCTION='https://xrpl-lending-monitor.badjoke-lab.workers.dev'
HASH_RE=re.compile(r'^[A-Fa-f0-9]{64}$')
SEMANTIC_KEYS=('protocolEvents','objectChanges','loanLifecycle','archivedObjects','balanceHistory')
FIXED_OBJECT={
    'transactionHash':'70A489701D68B89E04923A7845F81F2C615760992C55119A8FC0ED8C759DE684',
    'objectType':'Vault',
    'objectId':'AD0980A254BC7262C57001315A9B6C7C65A020F29FAB2D0A0915933C55FF3BB1',
    'action':'created',
    'transactionType':'VaultCreate',
}

def load(path):
    return json.loads(Path(path).read_text())
def results(path):
    return load(path).get('result',[{}])[0].get('results',[])
def one(path):
    rows=results(path)
    return rows[0] if rows else {}
def request_json(url, payload=None, attempts=4):
    last=None
    for attempt in range(attempts):
        try:
            data=None if payload is None else json.dumps(payload).encode()
            headers={'Content-Type':'application/json'} if payload is not None else {}
            with urlopen(Request(url,data=data,headers=headers),timeout=45) as response:
                return json.loads(response.read())
        except (HTTPError,URLError,TimeoutError,json.JSONDecodeError) as exc:
            last=exc
            time.sleep(1+attempt)
    raise RuntimeError(str(last))
def rpc(method, params):
    errors=[]
    for endpoint in ('https://devnet.honeycluster.io/','https://s.devnet.rippletest.net:51234/','https://s.altnet.rippletest.net:51234/'):
        try:
            payload=request_json(endpoint,{'method':method,'params':[params]})
            result=payload.get('result') or {}
            if 'error' not in result:
                return result,endpoint
            errors.append(f"{endpoint}:{result.get('error')}")
        except Exception as exc:
            errors.append(f'{endpoint}:{exc}')
    raise RuntimeError('; '.join(errors))
def contains_hash(value,target):
    if isinstance(value,str): return value.upper()==target
    if isinstance(value,list): return any(contains_hash(item,target) for item in value)
    if isinstance(value,dict): return any(contains_hash(item,target) for item in value.values())
    return False
def internal_hash(kind,record):
    key={'protocolEvents':'eventHash','objectChanges':'transactionHash','loanLifecycle':'transactionHash','archivedObjects':'deletionTransactionHash','balanceHistory':'transactionHash'}[kind]
    value=record.get(key)
    return value.upper() if isinstance(value,str) and HASH_RE.fullmatch(value) else None
def retained_candidate(kind):
    if kind=='protocolEvents':
        value=request_json(PRODUCTION+'/api/activity?limit=1')['data'][0]
        return {'eventHash':value['transaction_hash'],'eventType':value['transaction_type']}
    if kind=='objectChanges':
        return dict(FIXED_OBJECT)
    if kind=='loanLifecycle':
        value=request_json(PRODUCTION+'/api/audit/lifecycle?limit=1')['data'][0]
        return {'transactionHash':value['transaction_hash'],'loanId':value['loan_id'],'transactionType':value['transaction_type']}
    if kind=='archivedObjects':
        value=request_json(PRODUCTION+'/api/audit/archived?limit=1')['data'][0]
        return {'deletionTransactionHash':value['deletion_transaction_hash'],'objectType':value['object_type'],'objectId':value['object_id']}
    value=request_json(PRODUCTION+'/api/audit/cover-loss?limit=1')['data'][0]
    return {'transactionHash':value['transaction_hash'],'metricType':value['metric_type'],'subjectType':value['subject_type'],'subjectId':value['subject_id'],'assetKey':value.get('asset_key')}

slots=results('slots.json')
slot_times=[int(row.get('scheduled_time',-1)) for row in slots]
slots_exact=slot_times==EXPECTED and len(slots)==12
slots_completed=slots_exact and all(row.get('status')=='completed' and row.get('started_at') and row.get('completed_at') and row.get('error_message') in (None,'') for row in slots)

metric_rows=results('slot-metrics.json')
grouped={slot:[] for slot in EXPECTED}
for row in metric_rows:
    slot=int(row.get('scheduled_time',-1))
    if slot in grouped and row.get('run_at'):
        grouped[slot].append(row)
metric_errors=[]
slot_resource=[]
accepted_start=None
accepted_end=None
for slot in EXPECTED:
    group=sorted(grouped[slot],key=lambda row:row['run_at'])
    if not group:
        metric_errors.append({'slot':slot,'reason':'missing_metrics'})
        continue
    if any(row.get('metric_status')!='committed' or row.get('metric_error') not in (None,'') for row in group):
        metric_errors.append({'slot':slot,'reason':'non_committed_or_error'})
    terminal=group[-1]
    if int(terminal.get('lag_ledgers',-1))!=0:
        metric_errors.append({'slot':slot,'reason':'terminal_lag_nonzero','lag':terminal.get('lag_ledgers')})
    starts=[int(row['start_ledger_index']) for row in group if row.get('start_ledger_index') is not None]
    ends=[int(row['end_ledger_index']) for row in group if row.get('end_ledger_index') is not None]
    if starts: accepted_start=min(starts) if accepted_start is None else min(accepted_start,min(starts))
    if ends: accepted_end=max(ends) if accepted_end is None else max(accepted_end,max(ends))
    slot_resource.append({'slot':slot,'metricCount':len(group),'rowsRead':sum(int(row.get('persistence_rows_read') or 0) for row in group),'rowsWritten':sum(int(row.get('persistence_rows_written') or 0) for row in group),'terminalLag':int(terminal.get('lag_ledgers',-1))})
metrics_ok=not metric_errors

windows=results('slot-windows.json')
decoded=[]
bundles=[]
decode_errors=[]
totals={key:0 for key in SEMANTIC_KEYS}
max_encoded=0
for row in windows:
    start=int(row['start_ledger_index']); end=int(row['end_ledger_index'])
    max_encoded=max(max_encoded,int(row.get('encoded_bytes') or 0))
    try:
        raw=row['bundle_json']
        if not isinstance(raw,str) or not raw.startswith('gzip-base64-v1:'): raise ValueError('unexpected_encoding')
        bundle=json.loads(gzip.decompress(base64.b64decode(raw.split(':',1)[1])))
        if bundle.get('schemaVersion')!=1: raise ValueError('invalid_schema_version')
        counts={}
        for key in SEMANTIC_KEYS:
            records=bundle.get(key)
            if not isinstance(records,list): raise ValueError(f'missing_array:{key}')
            counts[key]=len(records); totals[key]+=len(records)
        if int(bundle.get('startLedgerIndex',-1))!=start or int(bundle.get('endLedgerIndex',-1))!=end: raise ValueError('bundle_window_identity_mismatch')
        if str(bundle.get('endLedgerHash','')).upper()!=str(row.get('end_ledger_hash','')).upper(): raise ValueError('bundle_end_hash_mismatch')
        bundles.append(bundle)
        decoded.append({'slot':int(row['scheduled_time']),'startLedgerIndex':start,'endLedgerIndex':end,'endLedgerHash':str(row['end_ledger_hash']).upper(),'encodedBytes':int(row.get('encoded_bytes') or 0),'counts':counts})
    except Exception as exc:
        decode_errors.append({'startLedgerIndex':start,'endLedgerIndex':end,'error':str(exc)})
decoded.sort(key=lambda row:(row['startLedgerIndex'],row['endLedgerIndex']))
bundles.sort(key=lambda row:(int(row['startLedgerIndex']),int(row['endLedgerIndex'])))
coverage_ok=bool(decoded) and not decode_errors and len(decoded)==len(windows)
for previous,current in zip(decoded,decoded[1:]):
    if current['startLedgerIndex']!=previous['endLedgerIndex']+1: coverage_ok=False
if accepted_start is None or accepted_end is None: coverage_ok=False
elif decoded: coverage_ok=coverage_ok and decoded[0]['startLedgerIndex']==accepted_start and decoded[-1]['endLedgerIndex']==accepted_end

ledger_cache={}
ledger_checks=[]
def ledger(index):
    if index not in ledger_cache:
        result,endpoint=rpc('ledger',{'ledger_index':index,'transactions':False,'expand':False})
        obj=result.get('ledger') or {}
        ledger_cache[index]={'index':index,'hash':str(result.get('ledger_hash') or obj.get('hash') or '').upper(),'parentHash':str(obj.get('parent_hash') or '').upper(),'validated':bool(result.get('validated')),'endpoint':endpoint}
    return ledger_cache[index]
hash_continuity_ok=coverage_ok
if coverage_ok:
    try:
        for index,row in enumerate(decoded):
            end_ledger=ledger(row['endLedgerIndex'])
            end_match=end_ledger['validated'] and end_ledger['hash']==row['endLedgerHash']
            parent_match=True
            if index:
                start_ledger=ledger(row['startLedgerIndex'])
                parent_match=start_ledger['validated'] and start_ledger['parentHash']==decoded[index-1]['endLedgerHash']
            ledger_checks.append({'startLedgerIndex':row['startLedgerIndex'],'endLedgerIndex':row['endLedgerIndex'],'endHashMatch':end_match,'parentHashMatch':parent_match,'rpcEnd':end_ledger})
            if not end_match or not parent_match: hash_continuity_ok=False
    except Exception as exc:
        hash_continuity_ok=False; ledger_checks.append({'error':str(exc)})

class_records={key:[] for key in SEMANTIC_KEYS}
for bundle in bundles:
    for key in SEMANTIC_KEYS: class_records[key].extend(bundle[key])
tx_cache={}
def validated_tx(hash_value):
    if hash_value not in tx_cache:
        result,endpoint=rpc('tx',{'transaction':hash_value,'binary':False})
        returned=str(result.get('hash') or (result.get('tx_json') or {}).get('hash') or '').upper()
        tx_cache[hash_value]={'validated':bool(result.get('validated')),'hash':returned,'endpoint':endpoint,'result':result}
    return tx_cache[hash_value]

witnesses={}
witnesses_ok=True
for kind in SEMANTIC_KEYS:
    source='window'
    record=None
    for candidate in class_records[kind]:
        if internal_hash(kind,candidate):
            if kind!='objectChanges' or (candidate.get('objectType') in ('Vault','LoanBroker','Loan') and candidate.get('objectId')):
                record=candidate; break
    if record is None:
        source='retained'
        try: record=retained_candidate(kind)
        except Exception as exc:
            witnesses[kind]={'observedWindowCount':totals[kind],'occurrenceState':'zero' if totals[kind]==0 else 'present','source':source,'passed':False,'error':str(exc)}
            witnesses_ok=False
            continue
    hash_value=internal_hash(kind,record)
    witness={'observedWindowCount':totals[kind],'occurrenceState':'zero' if totals[kind]==0 else 'present','source':source,'hash':hash_value,'record':record}
    if not hash_value:
        witness.update({'passed':False,'reason':'invalid_hash'}); witnesses[kind]=witness; witnesses_ok=False; continue
    try:
        if kind=='protocolEvents': path=f'/api/transactions/{hash_value}'
        elif kind=='objectChanges': path=f"/api/objects/{quote(str(record['objectType']))}/{quote(str(record['objectId']))}/history?limit=100"
        elif kind=='loanLifecycle': path=f"/api/loans/{quote(str(record['loanId']))}/lifecycle?limit=100"
        elif kind=='archivedObjects': path=f"/api/audit/archived/{quote(str(record['objectType']))}/{quote(str(record['objectId']))}"
        else:
            params={'metric_type':record.get('metricType'),'subject_type':record.get('subjectType'),'subject_id':record.get('subjectId'),'asset_key':record.get('assetKey'),'limit':'100'}
            path='/api/audit/cover-loss?'+urlencode({key:value for key,value in params.items() if value not in (None,'')})
        public=request_json(PRODUCTION+path)
        public_match=contains_hash(public,hash_value)
        tx=validated_tx(hash_value)
        source_match=tx['validated'] and tx['hash']==hash_value
        transaction_type_match=True
        affected_match=True
        if kind=='protocolEvents':
            tx_json=tx['result'].get('tx_json') or tx['result']
            transaction_type_match=tx_json.get('TransactionType')==record.get('eventType')
        if kind=='objectChanges':
            nodes=(tx['result'].get('meta') or tx['result'].get('metaData') or {}).get('AffectedNodes') or []
            expected={'created':'CreatedNode','modified':'ModifiedNode','deleted':'DeletedNode'}.get(record.get('action'))
            affected_match=False
            for wrapper in nodes:
                inner=wrapper.get(expected) if isinstance(wrapper,dict) and expected else None
                if isinstance(inner,dict) and str(inner.get('LedgerIndex','')).upper()==str(record.get('objectId','')).upper() and inner.get('LedgerEntryType')==record.get('objectType'):
                    affected_match=True; break
        witness.update({'path':path,'publicMatch':public_match,'sourceValidated':source_match,'transactionTypeMatch':transaction_type_match,'affectedNodeMatch':affected_match,'passed':public_match and source_match and transaction_type_match and affected_match})
    except Exception as exc:
        witness.update({'passed':False,'error':str(exc)})
    if not witness.get('passed'): witnesses_ok=False
    witnesses[kind]=witness

pre=load('pre-identity.json')
dep=load('post-deployments.json')['result']['deployments'][0]
versions=dep.get('versions') or []
settings=load('post-settings.json'); schedules=load('post-schedules.json')
bindings=settings.get('result',{}).get('bindings',[])
def binding(name):
    values=[item.get('text',item.get('value')) for item in bindings if item.get('name')==name]
    return values[0] if values else None
post={'deploymentId':dep.get('id'),'versionId':(versions[0].get('version_id') or versions[0].get('id')) if len(versions)==1 else None,'appNetwork':binding('APP_NETWORK'),'mainnetEnabled':binding('MAINNET_ENABLED'),'maxLedgersPerRun':binding('FAST_LANE_MAX_LEDGERS_PER_RUN'),'queueBindings':[item for item in bindings if item.get('type')=='queue'],'schedules':schedules.get('result',{}).get('schedules',[]),'baseBinding':one('post-base-binding.json'),'overlayBase':one('final-overlay.json'),'fastEpoch':one('final-fast.json').get('epoch_id'),'historySource':load('history-source.json')}
stable_overlay_keys=('epoch_id','base_snapshot_id','base_ledger_index','base_ledger_hash')
identity_checks={'deploymentId':pre.get('deploymentId')==post.get('deploymentId'),'versionId':pre.get('versionId')==post.get('versionId'),'baseBinding':pre.get('baseBinding')==post.get('baseBinding'),'overlayBase':all((pre.get('overlayBase') or {}).get(key)==(post.get('overlayBase') or {}).get(key) for key in stable_overlay_keys),'fastEpoch':pre.get('fastEpoch')==post.get('fastEpoch'),'historySource':pre.get('historySource')==post.get('historySource'),'appNetwork':post.get('appNetwork')=='devnet','mainnetDisabled':post.get('mainnetEnabled')=='false','maxLedgers':post.get('maxLedgersPerRun')=='96','oneQueueBinding':len(post.get('queueBindings') or [])==1,'oneCron':len(post.get('schedules') or [])==1 and post['schedules'][0].get('cron')=='*/5 * * * *'}
identity_ok=all(identity_checks.values())

fast=one('final-fast.json'); overlay=one('final-overlay.json')
final_alignment=int(fast.get('last_processed_ledger',-1))==int(overlay.get('overlay_ledger_index',-2)) and str(fast.get('last_processed_hash','')).upper()==str(overlay.get('overlay_ledger_hash','')).upper() and int(fast.get('lag_ledgers',-1))==0 and fast.get('status')=='healthy'
compact=int(one('compact.json').get('compact_rows',-1)); foldable=int(one('foldable.json').get('foldable_rows',-1)); stale=int(one('stale.json').get('stale_rows',-1))
max_writes=max((row['rowsWritten'] for row in slot_resource),default=-1)
total_writes=sum(row['rowsWritten'] for row in slot_resource); total_reads=sum(row['rowsRead'] for row in slot_resource)
resource={'perSlot':slot_resource,'maxWritesPerSlot':max_writes,'projectedDailyRowsWritten':total_writes*24,'projectedDailyRowsRead':total_reads*24,'maxEncodedBytes':max_encoded}
resource['passed']=max_writes<=300 and resource['projectedDailyRowsWritten']<100000 and resource['projectedDailyRowsRead']<4000000 and max_encoded<=131072
retention={'queue':one('queue-retention.json'),'metrics':one('metric-retention.json'),'historyWindows':one('window-retention.json')}
retention_ok=int(retention['queue'].get('retained_queue_slots',0))>=288 and int(retention['metrics'].get('retained_metrics',0))>=288 and isinstance(post.get('historySource'),dict) and post['historySource'].get('status')=='ok'
http={name:Path(f'{name}.code').read_text().strip() for name in ('overview','history-source','fast-lane-diff','replacement-base','pre-soak-readiness')}
http_ok=all(code=='200' for code in http.values())
protected=[]
start_dt=datetime.fromisoformat('2026-07-25T08:30:00+00:00'); end_dt=datetime.fromisoformat('2026-07-25T09:25:00+00:00')
for hour in (0,4,8,12,16,20):
    boundary=datetime(2026,7,25,hour,0,tzinfo=timezone.utc)
    if start_dt<=boundary<=end_dt: protected.append(boundary.isoformat())

checks={'exact12CompletedQueueSlots':slots_completed,'metricsExactlyAttributedCommittedTerminalLagZero':metrics_ok,'ledgerWindowCoverageExact':coverage_ok,'ledgerHashAndParentContinuity':hash_continuity_ok,'allBundlesDecodedWithFiveSemanticArrays':bool(decoded) and not decode_errors,'semanticOccurrenceOrZeroAndRetainedWitnessesVerified':witnesses_ok,'fastLaneCanonicalFinalAlignment':final_alignment,'compactZero':compact==0,'foldableCompactZero':foldable==0,'staleZero':stale==0,'deploymentBaseEpochPublicationIdentityStable':identity_ok,'resourceEnvelope':resource['passed'],'retentionFor24HourAudit':retention_ok,'publicStatusApis':http_ok,'protectedCollectorBoundaryRule':len(protected)==0}
passed=all(checks.values())
summary={'checkedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'status':'passed' if passed else 'failed','passed':passed,'fixedWindow':{'startUtc':'2026-07-25T04:10:00Z','endUtc':'2026-07-25T05:05:00Z','evaluateUtc':'2026-07-25T05:10:30Z','startJst':'2026-07-25T17:30:00+09:00','endJst':'2026-07-25T18:25:00+09:00','expectedSlots':12,'spacingMs':300000},'runtimeSha':'5b56de459e97495a9358f0e203c056d2a99afc6b','checks':checks,'failures':[key for key,value in checks.items() if not value],'slots':slots,'metricErrors':metric_errors,'metricsBySlot':slot_resource,'history':{'windowCount':len(windows),'decodedWindowCount':len(decoded),'acceptedStartLedger':accepted_start,'acceptedEndLedger':accepted_end,'coverageFirstLedger':decoded[0]['startLedgerIndex'] if decoded else None,'coverageLastLedger':decoded[-1]['endLedgerIndex'] if decoded else None,'semanticTotals':totals,'maxEncodedBytes':max_encoded,'decodeErrors':decode_errors,'ledgerContinuity':ledger_checks},'semanticWitnesses':witnesses,'preIdentity':pre,'postIdentity':post,'identityChecks':identity_checks,'finalFastLane':fast,'finalCanonicalOverlay':overlay,'compactRows':compact,'foldableCompactRows':foldable,'staleRows':stale,'resource':resource,'retention':retention,'http':http,'protectedCollectorBoundariesInWindow':protected,'qualificationScope':{'zeroOccurrenceRule':'A class may have zero fixed-window records only when the decoded bundles prove exact zero and a retained representative public/XRPL witness passes.','releaseCertification':False,'note':'A pass qualifies only this 12-slot pre-soak window; it does not certify the later 24-hour soak or Mainnet.'}}
Path('complete-history-12-slot-qualification-995-v4.json').write_text(json.dumps(summary,indent=2)+'\n')
Path('qualification-status.txt').write_text(summary['status']+'\n')
PY
