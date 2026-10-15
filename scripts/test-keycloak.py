"""CI only: synthetic credentials, real PKCE/password/TOTP, no live Zalo calls."""
import base64, hashlib, hmac, html.parser, http.cookiejar, json, os, secrets, struct, sys, time, urllib.parse, urllib.request
from pathlib import Path
statefile=Path('/tmp/noxh-keycloak-ci.json')
if '--prepare' in sys.argv:
    realmfile=Path('deploy/keycloak/noxh-realm.json');realm=json.loads(realmfile.read_text())
    state={'password':secrets.token_urlsafe(32),'otp':base64.b32encode(secrets.token_bytes(20)).decode()}
    statefile.write_text(json.dumps(state));os.chmod(statefile,0o600)
    realm['users']=[{'username':'ci-synthetic-admin','enabled':True,'emailVerified':True,'firstName':'Synthetic','lastName':'CI','email':'ci@example.test','realmRoles':['org_admin'],'credentials':[{'type':'password','value':state['password'],'temporary':False},{'type':'otp','secretData':json.dumps({'value':state['otp']}),'credentialData':json.dumps({'subType':'totp','digits':6,'counter':0,'period':30,'algorithm':'HmacSHA1'})}]}]
    realmfile.write_text(json.dumps(realm))
    print('Prepared isolated CI identity; no default human users in source realm.')
    sys.exit()
state=json.loads(statefile.read_text())
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, hdrs, newurl):
        if newurl.startswith('http://localhost:3001/auth/callback'):
            self.callback=newurl
            return None
        return super().redirect_request(req,fp,code,msg,hdrs,newurl)
class Form(html.parser.HTMLParser):
    action=None
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs)
        if tag=='form':self.action=attrs.get('action')
redirect=NoRedirect();browser=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),redirect)
verifier=secrets.token_urlsafe(32)
challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
issuer='http://localhost:8080/realms/noxh'
query=urllib.parse.urlencode({'client_id':'noxh-investor','response_type':'code','scope':'openid','redirect_uri':'http://localhost:3001/auth/callback','state':'ci','code_challenge':challenge,'code_challenge_method':'S256'})
def form_action(page):
    p=Form();p.feed(page);assert p.action,'Expected identity form';return p.action
def post(url,data):
    return browser.open(urllib.request.Request(url,urllib.parse.urlencode(data).encode()),timeout=20)
page=browser.open(issuer+'/protocol/openid-connect/auth?'+query,timeout=20).read().decode()
page=post(form_action(page),{'username':'ci-synthetic-admin','password':state['password']}).read().decode()
assert 'otp' in page.lower(),'Password alone must not finish login'
secret=base64.b32decode(state['otp']);digest=hmac.new(secret,struct.pack('>Q',int(time.time())//30),hashlib.sha1).digest();offset=digest[-1]&15
code=str((int.from_bytes(digest[offset:offset+4],'big')&0x7fffffff)%1000000).zfill(6)
try:post(form_action(page),{'otp':code,'login':'Sign In'})
except urllib.error.HTTPError as e:
    if e.code!=302 or not getattr(redirect,'callback',None):raise RuntimeError('Identity did not complete TOTP') from None
params=urllib.parse.parse_qs(urllib.parse.urlsplit(redirect.callback).query);assert params.get('state')==['ci'] and 'code' in params
response=post(issuer+'/protocol/openid-connect/token',{'grant_type':'authorization_code','client_id':'noxh-investor','redirect_uri':'http://localhost:3001/auth/callback','code':params['code'][0],'code_verifier':verifier})
token=json.load(response)['access_token']
def api(path,method='GET',body=None):
    request=urllib.request.Request('http://localhost:4000/api/v1/admin/'+path, data=json.dumps(body).encode() if body is not None else None,method=method,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=20) as response:return json.load(response)
assert api('me')['role']=='org_admin'
assert api('dashboard')['projects']>=2
assert len(api('projects')['items'])>=2
assert api('settings/zalo')['version']==0
assert api('logout','POST',{})['loggedOut']
try:api('me');raise AssertionError('Logged-out JWT accepted')
except urllib.error.HTTPError as e:assert e.code==401
statefile.unlink()
print('PASS: real Keycloak PKCE + password + TOTP; API signature/audience/MFA/role, DB dashboard and logout revocation.')
