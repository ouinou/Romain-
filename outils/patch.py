import sys,re,os,shutil,json,hashlib
SRC,OUT,DOMAIN=sys.argv[1],sys.argv[2],sys.argv[3].rstrip('/')
OLD="https://iti-incub8r-sizdkwcm.manus.space"
if os.path.exists(OUT): shutil.rmtree(OUT)
os.makedirs(OUT+'/assets')
s=open(SRC+'/assets/index-BVXf10bd.js',encoding='utf-8').read()

def rep(old,new,count=1):
    global s
    n=s.count(old)
    assert n==count,(old[:80],n,count)
    s=s.replace(old,new)

# 1. Formulaire de contact : envoi réel (FormSubmit -> e-mail), repli WhatsApp
i=s.find('c(!0);try{await new Promise(v=>setTimeout(v,1e3))');assert i>0
j=s.find('}catch{au.error("Une erreur est survenue',i);assert j>i
new_try=('c(!0);try{const v=await fetch("https://formsubmit.co/ajax/incubateur.th@gmail.com",{method:"POST",'
 'headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({Nom:i.name,Email:i.email,'
 '"Téléphone":i.phone||"-",Objet:i.subject,Message:i.message,_subject:"Site ITI : "+i.subject+" - "+i.name,_replyto:i.email,'
 '_template:"table",_captcha:"false"})}).then(b=>b.ok?b.json():null).catch(()=>null);'
 'if(v&&String(v.success)==="true"){au.success("Message envoyé. Nous vous répondons sous 24 h ouvrées.");'
 'r({name:"",email:"",phone:"",subject:"Formation",message:""})}'
 'else{const b="Bonjour ITI, je suis "+i.name+" ("+i.email+(i.phone?", "+i.phone:"")+").\\nObjet : "+i.subject+"\\n\\n"+i.message;'
 'au.success("Nous ouvrons WhatsApp pour transmettre votre message.");'
 'setTimeout(()=>{window.location.href="https://wa.me/237687064161?text="+encodeURIComponent(b)},900)}')
s=s[:i]+new_try+s[j:]

# 2. Admin : route supprimée, mot de passe retiré du code
m=re.search(r'O2="[^"]*"',s);assert m;s=s[:m.start()]+'O2=null'+s[m.end():]
rep('path:"/admin",component:L2','path:"/admin",component:vx')

# 3. Pages aux chiffres/témoignages non vérifiables : retirées du menu et des routes
for p,c in [('projects','E2'),('testimonials','M2'),('stats','z2')]:
    rep(f'path:"/{p}",component:{c}',f'path:"/{p}",component:vx')
rep('{href:"/projects",label:"Projets"},','');rep('{href:"/testimonials",label:"Témoignages"},','');rep('{href:"/stats",label:"Impact"},','')

# 4. Articles de blog fictifs retirés (3,6,8,10) dans les 3 copies des données
def obj_end(t,k):
    depth=0;q=None;e=False
    while True:
        ch=t[k]
        if q:
            if e:e=False
            elif ch=='\\':e=True
            elif ch==q:q=None
        elif ch in '"\'`':q=ch
        elif ch=='{':depth+=1
        elif ch=='}':
            depth-=1
            if depth==0:return k+1
        k+=1
for aid,tt in ((3,"Success Story : De Ch"),(6,"Success Story : Entrepreneur"),(8,"ITI Partenaire Officiel"),(10,"Success Story : Du Projet")):
    starts=[m.start() for m in re.finditer(r'\{id:%d,title:"%s'%(aid,re.escape(tt)),s)]
    assert len(starts)==3,(aid,len(starts))
    for st in sorted(starts,reverse=True):
        en=obj_end(s,st)
        if s[en]==',':en+=1
        elif s[st-1]==',':st-=1
        s=s[:st]+s[en:]

# 5. Textes : apostrophes, chiffres, cohérence
rep("l\\\\'une de nos","l'une de nos");rep("n\\\\'existe pas","n'existe pas");rep("Vous n\\\\'avez pas","Vous n'avez pas")
rep("Rejoignez des centaines d'apprenants et d'entrepreneurs qui ont transformé leur carrière avec ITI.","Rejoignez les apprenants et porteurs de projets qui se forment avec ITI à Douala.")
rep(" Le taux de placement est supérieur à 75%.","")
rep('email:"contact@iti-incubateur.com",address:"Yaoundé, Cameroun"','email:"incubateur.th@gmail.com",address:"BP 2351, Douala, Cameroun"')

# 6. Photo du PDG absente -> médaillon aux initiales (en attendant la vraie photo)
svg=("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 480'%3E%3Crect width='400' height='480' fill='%2316324F'/%3E"
     "%3Ctext x='200' y='265' font-family='Poppins,Arial,sans-serif' font-size='120' font-weight='700' fill='%23F04A1D' text-anchor='middle'%3EONR%3C/text%3E%3C/svg%3E")
rep('src:"/manus-storage/pdg-iti_fb02d7f8.jpg"','src:"/images/pdg-iti.jpg"')

# 7. Pied de page : liens morts
for lab in ["Formation Professionnelle","Ingénierie & Projets","Solutions Technologiques","Conseil & Orientation"]:
    rep('href:"#",className:"text-gray-300 hover:text-primary transition-colors",children:"%s"'%lab,'href:"/services",className:"text-gray-300 hover:text-primary transition-colors",children:"%s"'%lab)
rep('href:"#",className:"hover:text-primary transition-colors",children:"Politique de confidentialité"','href:"/mentions-legales#confidentialite",className:"hover:text-primary transition-colors",children:"Politique de confidentialité"')
rep('href:"#",className:"hover:text-primary transition-colors",children:"Conditions d\'utilisation"','href:"/mentions-legales",className:"hover:text-primary transition-colors",children:"Mentions légales"')

# 8. Page Mentions légales & confidentialité
legal=open(os.path.join(os.path.dirname(__file__),'legal.html'),encoding='utf-8').read().replace('\n','')
legal_js=json.dumps(legal,ensure_ascii=False)
comp=('function ITI_LEGAL(){return n.jsxs("div",{className:"min-h-screen flex flex-col bg-white",children:[n.jsx(qt,{}),'
      'n.jsx("main",{className:"flex-1",children:n.jsx("div",{className:"container py-16",dangerouslySetInnerHTML:{__html:'+legal_js+'}})}),n.jsx(zt,{})]})}')
rep('function vx(){',comp+'function vx(){')
rep('n.jsx(vt,{"data-loc":"client\\\\src\\\\App.tsx:38",path:"/404"','n.jsx(vt,{path:"/mentions-legales",component:ITI_LEGAL}),n.jsx(vt,{"data-loc":"client\\\\src\\\\App.tsx:38",path:"/404"')

# 9. SEO par page : titre, description, canonical, noindex des pages inconnues
seo={"/":["Formation, Ingénierie & Solutions Technologiques à Douala","Centre de formation technique à Douala : maintenance électrique, robotique Arduino, conception 3D, énergies solaires. 70 % de pratique. Ingénierie et solutions technologiques."],
"/about":["À propos : notre histoire depuis 2022","Créé à Douala en 2022 par l'ingénieur Ouinou Ngassala Romain, l'ITI forme par la pratique et accompagne les projets technologiques locaux."],
"/ceo":["Le mot du PDG","Ouinou Ngassala Romain, fondateur et PDG de l'Incubateur Technologique de l'Innovation (ITI), présente la vision de l'incubateur."],
"/services":["Nos services : formation, ingénierie, solutions, conseil","Formation professionnelle, ingénierie de projets, télécoms et sécurité électronique, conseil et orientation : les services de l'ITI à Douala."],
"/formations":["Formations certifiantes à Douala","Maintenance électrique et industrielle, robotique Arduino, conception 3D SolidWorks, énergies renouvelables, outils numériques : 70 % de pratique."],
"/blog":["Blog : actualités et tutoriels","Actualités de l'ITI, tutoriels Arduino et électricité, conseils pour choisir sa formation technique."],
"/faq":["Questions fréquentes","Durée, tarifs, paiement, inscription, certification : les réponses aux questions fréquentes sur les formations de l'ITI."],
"/contact":["Contact et inscription","Contactez l'ITI à Douala par téléphone, WhatsApp ou e-mail pour vous inscrire à une formation ou présenter un projet."],
"/mentions-legales":["Mentions légales et confidentialité","Éditeur du site, hébergement et traitement des données personnelles transmises via le site de l'ITI."]}
seo_fn=('function ITI_SEO(){if(typeof window>"u")return;const p=location.pathname.replace(/\\/+$/,"")||"/",o=location.origin,M='+json.dumps(seo,ensure_ascii=False)+';'
 'let m=M[p],k=!0;if(m)m={title:m[0],description:m[1]};else{const b=p.match(/^\\/blog\\/(\\d+)$/);let a=null;if(b)try{a=(la.getArticles()||[]).find(x=>String(x.id)===b[1])}catch{}'
 'if(a)m={title:a.title,description:a.excerpt||a.title};else{m={title:"Page introuvable",description:"Cette page n\'existe pas."};k=!1}}'
 'y2({...m,canonicalUrl:o+p,ogUrl:o+p});let r=document.querySelector(\'meta[name="robots"]\');r&&r.setAttribute("content",k?"index, follow":"noindex, follow")}')
rep('function qt(){','ITI_SEO();'.join(['',''])+seo_fn+'function qt(){ITI_SEO();')
rep("Découvrez nos formations, nos projets et nos solutions innovantes.","Découvrez nos formations et nos solutions technologiques.")
rep('className:"btn-secondary inline-flex items-center gap-2 border-2 border-white text-white hover:bg-white/10",children:"Nous Contacter"','className:"btn-secondary inline-flex items-center gap-2 border-2 border-white text-white hover:bg-white/10",style:{backgroundColor:"transparent",color:"#fff",borderColor:"#fff"},children:"Nous Contacter"')
# domaine
s=s.replace(OLD,DOMAIN)
# 10. Nettoyage des chemins internes Manus
s=re.sub(r'"data-loc":"[^"]*",','',s);s=re.sub(r',?"data-loc":"[^"]*"','',s)
assert '"data-loc"' not in s and 'manus.space' not in s

# ---------- Mode CMS : les articles viennent de /content.json ----------
def arr_end(k):
    depth=0;q=None;e=False
    while True:
        ch=s[k]
        if q:
            if e:e=False
            elif ch=='\\':e=True
            elif ch==q:q=None
        elif ch in '"\'`':q=ch
        elif ch in '[{':depth+=1
        elif ch in ']}':
            depth-=1
            if depth==0:return k+1
        k+=1
ARTS='((window.ITI_CONTENT&&window.ITI_CONTENT.articles)||[])'
# sauvegarde des articles d'origine (version longue de BlogArticle) pour la migration
i=s.find('function T2(');a=s.find('u=[',i)+2;b=arr_end(a)
open(os.path.join(OUT,'..','articles-origine.js'),'w',encoding='utf-8').write('module.exports='+s[a:b]+';')
s=s[:a]+ARTS+s[b:]
i=s.find('function C2(');a=s.find('d=[',i)+2;b=arr_end(a);s=s[:a]+ARTS+s[b:]
rep('f=["all","Actualités ITI","Tutoriels","Success Stories","Conseils Technologiques"],x=T.useMemo','f=["all",...new Set(d.map(b=>b.category).filter(Boolean))],x=T.useMemo')
rep('c=u.find(f=>f.id===parseInt(r?.id||"0"))','c=u.find(f=>String(f.id)===String(r?.id||""))')
i=s.find('n.jsx("div",{className:"prose prose-lg max-w-none",children:c.content.split(');assert i>0
j=s.find('n.jsxs(Me,{href:"/blog",className:"inline-flex items-center gap-2 text-primary font-semibold',i);assert j>i
s=s[:i]+'n.jsx("div",{className:"iti-article",dangerouslySetInnerHTML:{__html:c.html||""}}),'+s[j:]
rep('const b=p.match(/^\\/blog\\/(\\d+)$/);let a=null;if(b)try{a=(la.getArticles()||[]).find(x=>String(x.id)===b[1])}catch{}',
    'const b=p.match(/^\\/blog\\/([^/]+)$/);let a=null;if(b)a='+ARTS+'.find(x=>String(x.id)===b[1]);')
rep('$0.createRoot(document.getElementById("root")).render(n.jsx(I2,{}));','(window.ITI_READY||Promise.resolve()).then(()=>$0.createRoot(document.getElementById("root")).render(n.jsx(I2,{})));')

h=hashlib.sha1(s.encode()).hexdigest()[:8];jsname=f'index-{h}.js'
open(f'{OUT}/assets/{jsname}','w',encoding='utf-8').write(s)
shutil.copy(SRC+'/assets/index-CgDCcZQG.css',OUT+'/assets/index-CgDCcZQG.css')

# ---------- index.html ----------
x=open(SRC+'/index.html',encoding='utf-8').read()
a=x.find('<script id="manus-runtime">');b=x.find('</script>',a)+len('</script>');x=x[:a]+x[b:]
x=re.sub(r'\s*<script\s+defer\s+src="%VITE_ANALYTICS_ENDPOINT%/umami"[^>]*></script>','',x)
x=x.replace('index-BVXf10bd.js',jsname)
x=x.replace(', maximum-scale=1','')
x=x.replace('<link rel="icon" type="image/x-icon" href="/favicon.ico" />\n    <link rel="apple-touch-icon" href="/favicon.ico" />','<link rel="icon" type="image/svg+xml" href="/favicon.svg" />')
x=x.replace(' Cameroun." />',' Douala, Cameroun." />',1)
x=x.replace('<meta name="language" content="French" />\n    <meta name="revisit-after" content="7 days" />\n','')
x=x.replace('<meta property="og:type" content="website" />','<meta property="og:type" content="website" />\n    <meta property="og:locale" content="fr_FR" />')
x=re.sub(r'"sameAs": \[[^\]]*\],\s*','',x)
x=x.replace('''"address": {
        "@type": "PostalAddress",
        "addressCountry": "CM"
      }''','''"email": "incubateur.th@gmail.com",
      "address": {
        "@type": "PostalAddress",
        "postOfficeBoxNumber": "BP 2351",
        "addressLocality": "Douala",
        "addressCountry": "CM"
      }''')
x=x.replace('''"priceRange": "FCFA",''','''"email": "incubateur.th@gmail.com",
      "address": {"@type": "PostalAddress", "postOfficeBoxNumber": "BP 2351", "addressLocality": "Douala", "addressCountry": "CM"},''')
x=x.replace(OLD,DOMAIN)
x=x.replace('<div id="root"></div>','''<div id="root"></div>
    <noscript>
      <p style="font-family:sans-serif;padding:24px">ITI – Incubateur Technologique de l'Innovation, BP 2351, Douala, Cameroun.
      Tél. / WhatsApp : +237 6 87 06 41 61 – E-mail : incubateur.th@gmail.com.
      Activez JavaScript pour afficher le site complet.</p>
    </noscript>''')
assert 'manus' not in x.lower() and '%VITE' not in x, [m.start() for m in re.finditer('manus',x.lower())][:3]
open(OUT+'/index.html','w',encoding='utf-8').write(x)
open(OUT+'/404.html','w',encoding='utf-8').write(x)

# ---------- fichiers annexes ----------
open(OUT+'/favicon.svg','w').write("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='#16324F'/><text x='32' y='42' font-family='Arial,sans-serif' font-size='26' font-weight='700' fill='#F04A1D' text-anchor='middle'>ITI</text></svg>")
pages=[("/","1.0","weekly"),("/about","0.8","monthly"),("/ceo","0.6","monthly"),("/services","0.9","monthly"),("/formations","0.9","monthly"),("/blog","0.7","weekly")]+[(f"/blog/{k}","0.5","yearly") for k in (1,2,4,5,7,9)]+[("/faq","0.7","monthly"),("/contact","0.8","monthly"),("/mentions-legales","0.2","yearly")]
sm='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+''.join(f'  <url><loc>{DOMAIN}{p if p!="/" else "/"}</loc><lastmod>2026-11-02</lastmod><changefreq>{c}</changefreq><priority>{pr}</priority></url>\n' for p,pr,c in pages)+'</urlset>\n'
open(OUT+'/sitemap.xml','w').write(sm)
open(OUT+'/robots.txt','w').write(f"User-agent: *\nAllow: /\n\nSitemap: {DOMAIN}/sitemap.xml\n")
routes=[p for p,_,_ in pages if not p.startswith('/blog/')]+['/blog/:id']
CSP=("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; "
     "img-src 'self' data: https://d2xsxph8kpxj0f.cloudfront.net; connect-src 'self' https://formsubmit.co; frame-ancestors 'self'; base-uri 'self'; form-action 'self' https://formsubmit.co")
sec=[("Strict-Transport-Security","max-age=31536000"),("X-Frame-Options","SAMEORIGIN"),("X-Content-Type-Options","nosniff"),("Referrer-Policy","strict-origin-when-cross-origin"),("Permissions-Policy","camera=(), microphone=(), geolocation=(), payment=()"),("Content-Security-Policy",CSP)]
vercel={"cleanUrls":False,"trailingSlash":False,
 "rewrites":[{"source":r,"destination":"/index.html"} for r in routes if r!="/"],
 "headers":[{"source":"/(.*)","headers":[{"key":k,"value":v} for k,v in sec]},
            {"source":"/assets/(.*)","headers":[{"key":"Cache-Control","value":"public, max-age=31536000, immutable"}]},
            {"source":"/(index.html|404.html)?","headers":[{"key":"Cache-Control","value":"no-cache"}]}]}
open(OUT+'/vercel.json','w').write(json.dumps(vercel,indent=2,ensure_ascii=False))
nt='[build]\n  publish = "."\n\n'+''.join(f'[[redirects]]\n  from = "{r.replace(":id",":id")}"\n  to = "/index.html"\n  status = 200\n\n' for r in routes if r!="/")
nt+='[[redirects]]\n  from = "/*"\n  to = "/index.html"\n  status = 404\n\n[[headers]]\n  for = "/*"\n  [headers.values]\n'+''.join(f'    {k} = "{v}"\n' for k,v in sec)
nt+='\n[[headers]]\n  for = "/assets/*"\n  [headers.values]\n    Cache-Control = "public, max-age=31536000, immutable"\n\n[[headers]]\n  for = "/index.html"\n  [headers.values]\n    Cache-Control = "no-cache"\n'
open(OUT+'/netlify.toml','w').write(nt)
print('OK',jsname,len(s),len(x))
