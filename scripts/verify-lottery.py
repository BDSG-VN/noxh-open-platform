"""Independent stdlib verifier. Validates mathematics, not legal eligibility or signatures.
Usage: python3 scripts/verify-lottery.py public-evidence.json
"""
import hashlib,hmac,json,sys,re

ALGORITHM='noxh-hkdf-hmac-fisher-yates-v1'
def verify(e):
 c=e['config'];r=e['result'];ident=e['id']
 if not c['synthetic'] or len(c['entries'])>500 or not 1<=c['seats']<=500:raise ValueError('Unsupported scope')
 if any(not re.fullmatch(r'DEMO-[A-Z0-9-]{4,32}',x) for x in c['entries']) or len(set(c['entries']))!=len(c['entries']):raise ValueError('Invalid codes')
 if c['kind'] not in ['selection','priority-overflow','allocation']:raise ValueError('Invalid mode')
 if c['kind']=='allocation':
  if len(c['units'])!=len(c['entries']) or len(set(c['units']))!=len(c['units']) or c['seats']!=len(c['entries']):raise ValueError('Invalid units')
 elif len(c['entries'])<=c['seats'] or c['units']:raise ValueError('Draw not required')
 canonical=[ALGORITHM,ident,c['projectId'],c['title'],c['synthetic'],c['kind'],c['seats'],sorted(c['entries']),sorted(c['units']),c['rules'],c['legalBasis'],c['priorityResolution'],c['eligibilityEvidenceHash'],c['scheduledAt'],c['entropySource']]
 digest=hashlib.sha256(json.dumps(canonical,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
 if any(not re.fullmatch('[a-f0-9]{64}',r[k]) for k in ['secret','entropy']):raise ValueError('Invalid entropy')
 secret=bytes.fromhex(r['secret']);entropy=bytes.fromhex(r['entropy'])
 commit=hashlib.sha256(b'noxh-commit-v1\0'+secret+bytes.fromhex(digest)).hexdigest()
 if r['algorithm']!=ALGORITHM or r['snapshotHash']!=digest or r['commitment']!=commit or e['snapshotHash']!=digest or e['commitment']!=commit:raise ValueError('Commitment mismatch')
 # RFC 5869 SHA-256 extract + one-block expand, implemented separately from Node hkdfSync.
 prk=hmac.new(entropy,secret,hashlib.sha256).digest()
 key=hmac.new(prk,('noxh-draw-v1:'+digest).encode()+b'\x01',hashlib.sha256).digest()
 def words():
  for counter in range(2**32):
   block=hmac.new(key,counter.to_bytes(4,'big'),hashlib.sha256).digest()
   for offset in range(0,32,4):yield int.from_bytes(block[offset:offset+4],'big')
 stream=words();codes=sorted(c['entries'])
 for i in range(len(codes)-1,0,-1):
  bound=i+1;limit=2**32-(2**32%bound)
  for _ in range(10000):
   n=next(stream)
   if n<limit:break
  else:raise ValueError('Random stream exhausted')
  j=n%bound;codes[i],codes[j]=codes[j],codes[i]
 units=sorted(c['units'])
 expected=[{'code':code,'rank':i+1,'selected':i<c['seats'],'unit':units[i] if c['kind']=='allocation' else None} for i,code in enumerate(codes)]
 if r['ranking']!=expected:raise ValueError('Result mismatch')
 return True
if __name__=='__main__':
 try:
  if len(sys.argv)!=2:raise ValueError('Pass one evidence JSON file')
  with open(sys.argv[1],encoding='utf-8') as f:e=json.load(f)
  verify(e)
  print('VERIFIED: commitment, snapshot and deterministic ranking match. Synthetic scope only; no legal certification.')
 except (ValueError,KeyError,TypeError,OSError) as ex:
  print('NOT VERIFIED:',str(ex),file=sys.stderr);sys.exit(1)
