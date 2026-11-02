# Corrige la version en ligne du 3 septembre (export Manus) sans changer son contenu ni sa présentation.
import sys,os,shutil,hashlib,re
SRC,OUT=sys.argv[1],sys.argv[2]
if os.path.exists(OUT): shutil.rmtree(OUT)
shutil.copytree(SRC,OUT,ignore=shutil.ignore_patterns('__manus__'))
js=OUT+'/assets/index-zsoo9p94.js'; css=OUT+'/assets/index-dpenin4j.css'
s=open(js,encoding='utf-8').read()
def rep(a,b,n=1):
    global s
    c=s.count(a); assert c==n,(a[:70],c); s=s.replace(a,b)
PWD='(sessionStorage.getItem("iti_admin_pwd")||"")'
# 1. Écritures : uniquement via une fonction protégée par le mot de passe admin (vérifié côté serveur)
rep('async function Qu(t,e){try{const{error:s}=await Ei.from("site_content").upsert({key:t,value:e,updated_at:new Date().toISOString()},{onConflict:"key"});return!s}catch{return!1}}',
    'async function Qu(t,e){try{const{data:s,error:r}=await Ei.rpc("iti_save_content",{p_key:t,p_value:e,p_password:'+PWD+'});return!r&&s===!0}catch{return!1}}')
# 2. Connexion admin : mot de passe vérifié par la base, plus dans le navigateur
rep('k=await O("admin_hash");if(A===(k&&typeof k=="string"?k:uS))v6(),',
    'k=(await Ei.rpc("iti_check_admin",{p_password:s})).data;if(k===!0)sessionStorage.setItem("iti_admin_pwd",s),v6(),')
rep('v=()=>{sessionStorage.removeItem("iti_admin"),','v=()=>{sessionStorage.removeItem("iti_admin"),sessionStorage.removeItem("iti_admin_pwd"),')
rep('sessionStorage.getItem("iti_admin")==="1"&&j6()','sessionStorage.getItem("iti_admin")==="1"&&!!sessionStorage.getItem("iti_admin_pwd")&&j6()')
# 3. Changement de mot de passe : fait par la base
a=s.find('f("saving"),m("");const{supabaseLoad:b}');b=s.find('?(f("ok"),m("✅ Mot de passe changé',a);assert a>0 and b>a
s=s[:a]+'f("saving"),m("");const{data:okc}=await Ei.rpc("iti_change_password",{p_old:t,p_new:s});okc===!0&&sessionStorage.setItem("iti_admin_pwd",s);okc===!0'+s[b:]
# 4. Formulaire de contact : message ajouté par la base, jamais lisible par le public
rep('const f=await zp("contact_messages")||[],h={id:Date.now(),name:t.name,email:t.email,phone:t.phone,subject:t.subject,message:t.message,date:new Date().toISOString()};await Qu("contact_messages",[...f,h])',
    'const h={id:Date.now(),name:t.name,email:t.email,phone:t.phone,subject:t.subject,message:t.message,date:new Date().toISOString()};await Ei.rpc("iti_add_contact_message",{p_message:h})')
# 5. Lecture des messages dans l'admin : protégée par le mot de passe
rep('const x=await zp("contact_messages")||[];','const x=(await Ei.rpc("iti_get_contact_messages",{p_password:'+PWD+'})).data||[];')
# 6. Textes incohérents écrits dans le code
rep('"Plus de 15 ans d\'expérience dans les domaines','"Plus de 8 ans d\'expérience (depuis 2018) dans les domaines')
rep('avec plus de 10 ans d\'expérience, Romain a fondé ITI','avec plus de 8 ans d\'expérience (depuis 2018), l\'ingénieur OUINOU NGASSALA ROMAIN a fondé ITI en 2022')
rep('desc:"500+ projets, 5+ ans d\'expertise"','desc:"Nos chiffres clés"')
rep('"Découvrez 10 projets d\'excellence réalisés par ITI pour nos clients."','"Nos interventions au Cameroun, au Tchad, en Centrafrique et au Congo."')
# Fichiers : nouveaux noms (le téléchargement Netlify avait cassé les majuscules)
h=hashlib.sha1(s.encode()).hexdigest()[:8]
os.remove(js); newjs=f'index-iti{h}.js'; open(f'{OUT}/assets/{newjs}','w',encoding='utf-8').write(s)
ch=hashlib.sha1(open(css,'rb').read()).hexdigest()[:8]; newcss=f'index-iti{ch}.css'; os.rename(css,f'{OUT}/assets/{newcss}')
x=open(OUT+'/index.html',encoding='utf-8').read()
x=x.replace('/assets/index-ZSoO9P94.js','/assets/'+newjs).replace('/assets/index-DpeNin4J.css','/assets/'+newcss)
assert newjs in x and newcss in x
open(OUT+'/index.html','w',encoding='utf-8').write(x)
print('OK',newjs,newcss)
