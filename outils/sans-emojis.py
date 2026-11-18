# Remplace les emojis du site par des icônes dessinées (SVG, couleur ITI) ou par du texte.
# Usage : python3 outils/sans-emojis.py site-en-ligne
import sys,os,re,glob,hashlib
D=sys.argv[1]
J=glob.glob(D+'/assets/index-*.js'); assert len(J)==1,J; J=J[0]
s=open(J,encoding='utf-8').read()
def rep(a,b,n=1):
    global s
    c=s.count(a); assert c==n,(a[:60],c,n); s=s.replace(a,b)
def svg(cls,path):
    return 'l.jsx("svg",{viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2.4,strokeLinecap:"round",strokeLinejoin:"round",className:"'+cls+'","aria-hidden":"true",children:'+path+'})'
CHECK='l.jsx("path",{d:"M20 6 9 17l-5-5"})'
# Listes à puces « ✓ » : coche dessinée dans un rond orange
rep('l.jsx("span",{className:"text-primary font-bold",children:"✓"})',
    'l.jsx("span",{className:"flex-shrink-0 mt-0.5 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center",children:'+svg('w-3.5 h-3.5',CHECK)+'})',4)
# Témoignages : badge résultat
rep('className:"inline-block bg-primary/10 text-primary font-bold px-4 py-2 rounded-full text-sm mb-4",children:["✅ ",c.highlight]',
    'className:"inline-flex items-center gap-2 bg-primary/10 text-primary font-bold px-4 py-2 rounded-full text-sm mb-4",children:['+svg('w-4 h-4',CHECK)+',c.highlight]')
# Badge « Nouveau »
rep('"✨ Nouveau"','"Nouveau"')
# Formations : durée et tarif
rep('l.jsxs("span",{children:["⏱ ",e.duration]})','l.jsxs("span",{children:[l.jsx("strong",{className:"text-foreground",children:"Durée : "}),e.duration]})')
rep('l.jsxs("span",{children:["💰 ",e.price]})','l.jsxs("span",{children:[l.jsx("strong",{className:"text-foreground",children:"Tarif : "}),e.price]})')
# Plan d'accès : icône de lieu
rep('children:["📍 Douala Ange Raphaël','children:[l.jsx(J1,{className:"inline w-4 h-4 mr-1 text-primary align-[-3px]","aria-hidden":"true"}),"Douala Ange Raphaël')
# Messages de l'espace admin : texte simple
for a,b in [('["📧 ",m.email]','[m.email]'),('["📱 ",m.phone]','["Tél. ",m.phone]'),('"💬 WhatsApp"','"WhatsApp"'),('"✉️ Email"','"Email"'),
            ('"🔐 Vérification…"','"Vérification…"'),('"🗑️ Vider le cache"','"Vider le cache"'),('"↻ Actualiser"','"Actualiser"'),
            ('"✓ Image uploadée"','"Image envoyée"'),('"✓ Images stockées','"Images stockées')]:
    rep(a,b)
s=s.replace('`⚠️ Espace de stockage plein !','`Attention : espace de stockage plein !')
s=s.replace('BTN:👉 ','BTN:')
for e in ['☁️ ','✅ ','❌ ','⏳ ']: s=s.replace(e,'')
left=[m.group(0) for m in re.finditer('[\U0001F300-\U0001FAFF☀-➿✅❌⏳✓↻]',s)]
print('emojis restants :',left)   # seul le ⚠ d'un message technique en console peut rester
h=hashlib.sha1(s.encode()).hexdigest()[:8]; new=f'index-iti{h}.js'
os.remove(J); open(f'{D}/assets/{new}','w',encoding='utf-8').write(s)
x=open(D+'/index.html',encoding='utf-8').read(); old=os.path.basename(J)
assert old in x; open(D+'/index.html','w',encoding='utf-8').write(x.replace(old,new)); print('OK',new)
