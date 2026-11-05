#!/usr/bin/env python3
"""Read-only HTTPS checks. Secrets stay on VPS, reports never enter Git."""
import base64,datetime,hashlib,json,pathlib,re,subprocess,urllib.request,urllib.error
from html.parser import HTMLParser
BASE=pathlib.Path('/home/shopadmin/elektrikamarket-catalog-demos')
text=pathlib.Path('/home/shopadmin/elektrikamarket-storefront-secrets/owner-access.txt').read_text()
def field(pattern):
 m=re.search(r'(?im)^\s*(?:'+pattern+r')\s*[:=]\s*(.+)$',text);assert m
 return m.group(1).strip().strip(chr(96))
auth=base64.b64encode((field('username|user|login|логин')+':'+field('password|pass|пароль')).encode()).decode()
ORIGIN='https://test.elektro-24.ru:8443'
checks=[]
def fetch(path,authorized=True,method='GET',expected=200,origin=ORIGIN):
 req=urllib.request.Request(origin+path,headers={'Authorization':'Basic '+auth} if authorized else {},method=method)
 try:
  with urllib.request.urlopen(req,timeout=45) as r:status=r.status;body=r.read().decode();headers=r.headers
 except urllib.error.HTTPError as e:status=e.code;body=e.read().decode();headers=e.headers
 assert status==expected,(path,status,expected)
 if origin==ORIGIN:
  assert 'noindex' in headers.get('X-Robots-Tag','')
 if status==200 and path.startswith('/demo/'):
  assert all(s not in body for s in ['purchasePrice','postgresql://','postgres://','DATABASE_URL='])
 checks.append({'path':path,'method':method,'authenticated':authorized,'status':status,'origin':origin})
 return body
class Page(HTMLParser):
 def __init__(self,html):
  super().__init__();self.products=[];self.links=[];self.css=[];self.current=None;self.feed(html)
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='article' and a.get('data-product-code'):self.current=[a['data-product-code'],[]]
  if tag=='a' and 'href' in a:self.links.append(a['href'])
  if tag=='link' and a.get('rel')=='stylesheet':self.css.append(a['href'])
 def handle_data(self,data):
  if self.current is not None:self.current[1].append(data)
 def handle_endtag(self,tag):
  if tag=='article' and self.current is not None:
   self.products.append((self.current[0],' '.join(' '.join(self.current[1]).split())));self.current=None
for path in ['/demo/catalogs','/demo/catalog-v1','/demo/catalog-v2','/demo/catalog-v3','/api/health']:
 fetch(path,False,expected=401)
chooser=Page(fetch('/demo/catalogs'));assert len(chooser.css)>0
fetch(chooser.css[0],False,expected=401);fetch(chooser.css[0]);fetch('/demo/catalog-v1',method='POST',expected=405)
for v in [1,2,3]:
 root=fetch('/demo/catalog-v'+str(v));assert 'Каталог электротоваров' in root
 for cat in ['osveshchenie','lampy-istochniki-sveta','kabeli-i-provoda']:
  fetch('/demo/catalog-v'+str(v)+'?category='+cat)
comparisons=[]
for cat in ['lampy-svetodiodnye','vyklyuchatel-avtomaticheskiy-modulnyy','kabeli-i-provoda-silovye-dlya-statsionarnoy-prokladki']:
 sets=[]
 for v in [1,2,3]:
  p=Page(fetch('/demo/catalog-v'+str(v)+'?category='+cat));assert len(p.products)==24
  assert any('/product/' in a for a in p.links)
  sets.append(p.products)
 assert sets[0]==sets[1]==sets[2],cat
 comparisons.append({'category':cat,'itemsPerPage':len(sets[0]),'codesPricesStocksIdentical':True,'pageDigest':hashlib.sha256(json.dumps(sets[0],ensure_ascii=False).encode()).hexdigest()})
page1=Page(fetch('/demo/catalog-v2?category=lampy-svetodiodnye'))
page2=Page(fetch('/demo/catalog-v2?category=lampy-svetodiodnye&page=2'))
assert len(page2.products)==24 and not set(c for c,t in page1.products)&set(c for c,t in page2.products)
for v in [1,2,3]:
 result=Page(fetch('/demo/catalog-v'+str(v)+'?q=82229'));assert result.products and any(c=='82229' for c,t in result.products) # existing search also permits code fragments
 link=next(a for a in result.links if '/product/' in a);detail=fetch(link);assert 'Самара' in detail or 'Склад 2' in detail or 'Склад 3' in detail
for site in ['test','preview']:fetch('/api/health',origin='https://'+site+'.elektro-24.ru')
initial=json.loads((BASE/'baseline.json').read_text())
assert subprocess.check_output(['crontab','-l'],text=True)==initial['crontab']
for name,wanted in initial['containers'].items():
 r=json.loads(subprocess.check_output(['docker','inspect',name],text=True))[0]
 assert {'id':r['Id'],'image':r['Image'],'startedAt':r['State']['StartedAt']}==wanted
result={'status':'DEMO_HTTPS_AND_DATA_VERIFIED','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'checks':checks,'comparisons':comparisons,'paginationDisjoint':True,'existingContainersUnchanged':True,'crontabUnchanged':True,'readonlyProof':json.loads((BASE/'readonly-proof.json').read_text())}
(BASE/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'status':result['status'],'httpChecks':len(checks),'categoryComparisons':comparisons,'paginationDisjoint':True,'existingContainersUnchanged':True,'crontabUnchanged':True}))
