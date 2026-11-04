#!/usr/bin/env python3
"""Read-only HTTPS smoke. Credentials remain server-side and are never logged."""
import base64,decimal,html,json,pathlib,re,urllib.request,urllib.error,urllib.parse,sys
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(NoRedirect())
secrets=pathlib.Path('/home/shopadmin/elektrikamarket-storefront-secrets');credentials=[]
for name in ['owner-access.txt','developer-access.txt']:
 text=(secrets/name).read_text()
 user=re.search(r'(?im)^\s*(?:username|user|login|логин)\s*[:=]\s*(.+)$',text)
 password=re.search(r'(?im)^\s*(?:password|pass|пароль)\s*[:=]\s*(.+)$',text)
 if user and password:credentials.append((user.group(1).strip().strip('`'),password.group(1).strip().strip('`')))
assert credentials
phase=sys.argv[1] if len(sys.argv)==2 else 'after';base=pathlib.Path('/home/shopadmin/elektrikamarket-prodat')
samples=[{'supplierCode':'82229','slug':'svetilnik-amber-51-3-04-komtekh-ch917005','retailPrice':'61.00','stocks':[{'warehouse':'stock2','quantity':'308.00000000'}]}]
if phase=='after':
 post=json.loads((base/'first-live-postflight.json').read_text());assert post['status']=='LIVE_POSTFLIGHT_VERIFIED'
 samples=list({p['supplierCode']:p for p in post['samples']}.values())
def request(site,route):
 for user,password in credentials:
  token=base64.b64encode((user+':'+password).encode()).decode()
  req=urllib.request.Request('https://'+site+'.elektro-24.ru'+route,headers={'Authorization':'Basic '+token,'User-Agent':'elektrikamarket-prodat-owner-verification'})
  try:
   with opener.open(req,timeout=90) as response:status=response.status;body=response.read().decode('utf-8','replace')
  except urllib.error.HTTPError as error:status=error.code;body=error.read().decode('utf-8','replace')
  if status!=401:return status,body
 return status,body
report={'phase':phase,'transport':'HTTPS with verified certificates','sites':{}}
for site in ['test','preview']:
 status,body=request(site,'/api/health');checks=[{'route':'/api/health','status':status}]
 for p in samples:
  route='/catalog?'+urllib.parse.urlencode({'q':p['supplierCode']});status,body=request(site,route)
  checks.append({'route':route,'status':status,'newProductLinkFound':p['slug'] in body})
  route='/product/'+urllib.parse.quote(p['slug'],safe='');status,body=request(site,route)
  plain=html.unescape(re.sub('<[^>]+>',' ',re.sub(r'<script\b[^>]*>.*?</script>','',body,flags=re.S|re.I)))
  visible_prices=[]
  for value in re.findall(r'(\d(?:[\d\s\u00a0]*\d)?(?:[,.]\d{2})?)\s*(?:₽|руб)',plain):
   try:visible_prices.append(decimal.Decimal(re.sub(r'\s','',value).replace(',','.')))
   except decimal.InvalidOperation:pass
  quantities=[format(decimal.Decimal(s['quantity']).normalize(),'f') for s in p['stocks'] if decimal.Decimal(s['quantity'])>0]
  quantity_found=any(re.search(r'(?<!\d)'+r'\s*'.join(re.escape(c) for c in q.split('.')[0])+(r'[,.]'+re.escape(q.split('.')[1]) if '.' in q else r'(?:[,.]0+)?')+r'(?!\d)',plain) for q in quantities)
  checks.append({'route':route,'status':status,'supplierCodeFound':p['supplierCode'] in plain,'expectedRetailPrice':p['retailPrice'],'expectedPriceFound':decimal.Decimal(p['retailPrice']) in visible_prices,'expectedPositiveQuantityFound':quantity_found,'availableTextFound':bool(re.search(r'Доступен к продаже|В наличии|В корзину|Купить',plain,re.I))})
 report['sites'][site]=checks
print(json.dumps(report,ensure_ascii=False,indent=2))
if phase=='after' and any(c['status']!=200 or c.get('newProductLinkFound') is False or c.get('supplierCodeFound') is False or c.get('expectedPriceFound') is False or c.get('expectedPositiveQuantityFound') is False for checks in report['sites'].values() for c in checks):sys.exit(1)
