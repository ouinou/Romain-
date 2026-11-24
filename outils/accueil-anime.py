# Ajoute à l'accueil d'ORIGINE (structure inchangée) : photos qui défilent, bandeau des métiers,
# scènes animées, cartes « Nos solutions » avec vraies photos, et retire les icônes génériques.
# Usage : python3 outils/accueil-anime.py <dossier du site> <fragment.html>
import sys, os, glob, json, hashlib
D, FRAG = sys.argv[1], sys.argv[2]
J = glob.glob(D + '/assets/index-iti*.js'); assert len(J) == 1, J; J = J[0]
s = open(J, encoding='utf-8').read()
def rep(a, b, n=1):
    global s
    c = s.count(a); assert c == n, (a[:70], c); s = s.replace(a, b)

frag = open(FRAG, encoding='utf-8').read()
frag = frag.replace('<section class="atelier">', '<section class="atelier iti-atelier">')

# 1. Diaporama dans le fond de l'accueil (la photo de la base reste la première)
diapo = ('function ItiDiapo({a}){const L=[a,"/photos/formation-ia-salle.jpg","/photos/solaire-toiture.jpg",'
         '"/photos/videosurveillance-exterieur.jpg","/photos/locaux-remise-attestations.jpg","/photos/formateur-en-salle.jpg"].filter(Boolean);'
         'const[i,si]=_.useState(0);_.useEffect(()=>{if(window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches)return;'
         'const t=setInterval(()=>si(x=>(x+1)%L.length),5500);return()=>clearInterval(t)},[L.length]);'
         'return L.map((u,k)=>l.jsx("div",{className:"iti-diapo"+(k===i?" on":""),style:{backgroundImage:`url(${u})`}},k))}'
         'function ItiAccueil(){return l.jsx("div",{className:"iti-accueil",dangerouslySetInnerHTML:{__html:' + json.dumps(frag, ensure_ascii=False) + '}})}')
rep('function i6(){', diapo + 'function i6(){')
rep('children:l.jsx("div",{className:"absolute inset-0 bg-gradient-to-br from-[#16324F]/90 via-[#16324F]/75 to-black/60"})',
    'children:[l.jsx(ItiDiapo,{a:t.backgroundImage},"d"),l.jsx("div",{className:"iti-voile"},"o")]')

# 2. Bandeau + scènes animées, juste après le premier écran
rep('r.length>0&&l.jsx("section",{className:"py-20 bg-gray-50",children:l.jsxs("div",{className:"container",children:[l.jsxs(en,{className:"flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 mb-12"',
    'l.jsx(ItiAccueil,{}),r.length>0&&l.jsx("section",{className:"py-20 bg-gray-50",children:l.jsxs("div",{className:"container",children:[l.jsxs(en,{className:"flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4 mb-12"')

# 3. « Nos solutions » : 6 domaines réels, chacun avec une vraie photo
i = s.find('n6=['); j = s.find('],s6=[', i); assert i > 0 and j > i
dom = [("Énergies renouvelables", "Systèmes solaires, petit éolien et systèmes hybrides : étude, installation et maintenance.", "/photos/solaire-toiture.jpg"),
       ("Vidéosurveillance et sécurité", "Caméras de surveillance, contrôle d'accès et plaques signalétiques lumineuses, du choix du matériel au suivi.", "/photos/videosurveillance-exterieur.jpg"),
       ("Électrotechnique et maintenance", "Installations électriques, dépannage, maintenance préventive et curative des équipements.", "/photos/equipe-terrain.jpg"),
       ("Informatique, maintenance et vente", "Réseaux locaux, réparation d'ordinateurs et d'imprimantes, logiciels de gestion, vente de matériel.", "/photos/locaux-remise-attestations.jpg"),
       ("Formation, bureautique et IA", "Formations pratiques avec attestation : électricité, bureautique, assistant de direction, intelligence artificielle.", "/photos/formation-ia-salle.jpg"),
       ("Qualité, hygiène, sécurité, environnement", "La sécurité des personnes et la qualité du travail sur chacun de nos chantiers et dans nos ateliers.", "/photos/soudure-epi.jpg")]
s = s[:i] + 'n6=' + json.dumps([{"title": a, "desc": b, "img": c, "link": "/services"} for a, b, c in dom], ensure_ascii=False) + s[j+1:]
rep('className:"grid md:grid-cols-2 lg:grid-cols-4 gap-6",children:n6.map', 'className:"grid md:grid-cols-2 lg:grid-cols-3 gap-6",children:n6.map')
rep('l.jsx("div",{className:`w-12 h-12 ${d.color} rounded-xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform`,children:l.jsx(d.icon,{className:"w-6 h-6"})})',
    'l.jsx("div",{className:"iti-carte-photo",children:l.jsx("img",{src:d.img,alt:d.title,loading:"lazy"})})')
rep('className:"group block bg-white border border-gray-100 hover:border-primary/30 rounded-2xl p-6 shadow-sm hover:shadow-lg transition-all duration-300 h-full"',
    'className:"group block bg-white border border-gray-100 hover:border-primary/30 rounded-2xl p-6 shadow-sm hover:shadow-lg transition-all duration-300 h-full overflow-hidden"')

h = hashlib.sha1(s.encode()).hexdigest()[:8]; new = f'index-iti{h}.js'; old = os.path.basename(J)
os.remove(J); open(f'{D}/assets/{new}', 'w', encoding='utf-8').write(s)
for f in [D + '/index.html', D + '/admin/index.html'] + ([D + '/404.html'] if os.path.exists(D + '/404.html') else []):
    x = open(f, encoding='utf-8').read(); assert old in x, f
    x = x.replace(old, new)
    if 'iti-anime.css' not in x:
        x = x.replace('</head>', '  <link rel="stylesheet" href="/assets/iti-anime.css">\n  </head>', 1)
    open(f, 'w', encoding='utf-8').write(x)
print('OK', new)
