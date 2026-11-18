# Construit les pages publiques du site ITI dans site-en-ligne/.
# L'ancienne application (espace admin) est conservée sur /admin.
# Usage : python3 outils/site-public/construire.py
import os, shutil, re, hashlib, datetime

ICI = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(ICI, "..", "..", "site-en-ligne")
DOMAINE = "https://incubateurtech.tech"
WA = "https://wa.me/237687064161"

def ecrire(chemin, texte):
    p = os.path.join(SITE, chemin)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(texte)

# 1. Espace admin : l'ancienne application, servie sur /admin (non indexée)
spa = os.path.join(SITE, "admin", "index.html")
if not os.path.exists(spa):
    html = open(os.path.join(SITE, "index.html"), encoding="utf-8").read()
    assert "/assets/index-iti" in html, "index.html n'est pas l'application d'origine"
    html = html.replace("<head>", '<head>\n    <meta name="robots" content="noindex, nofollow" />', 1)
    ecrire("admin/index.html", html)

# 2. Feuilles de style et script, avec empreinte pour le cache
def fichier_versionne(nom, ext):
    src = open(os.path.join(ICI, nom), "rb").read()
    h = hashlib.sha1(src).hexdigest()[:8]
    for f in os.listdir(os.path.join(SITE, "assets")):
        if re.fullmatch(r"site-[0-9a-f]{8}\." + ext, f):
            os.remove(os.path.join(SITE, "assets", f))
    out = f"site-{h}.{ext}"
    open(os.path.join(SITE, "assets", out), "wb").write(src)
    return "/assets/" + out
CSS = fichier_versionne("site.css", "css")
JS = fichier_versionne("site.js", "js")

NAV = [("/", "Accueil"), ("/domaines/", "Domaines"), ("/formations/", "Formations"),
       ("/actualites/", "Actualités"), ("/a-propos/", "À propos"), ("/contact/", "Contact")]

def page(chemin, titre, description, contenu, actif):
    nav = "".join(f'<a href="{u}"{" aria-current=\"page\"" if u == actif else ""}>{t}</a>' for u, t in NAV)
    url = DOMAINE + chemin
    return f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{titre}</title>
<meta name="description" content="{description}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ITI – Incubateur Technologique de l'Innovation">
<meta property="og:title" content="{titre}">
<meta property="og:description" content="{description}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{DOMAINE}/photos/formation-ia-salle.jpg">
<meta property="og:locale" content="fr_FR">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
<link rel="stylesheet" href="{CSS}">
<script src="{JS}" defer></script>
</head>
<body>
<a class="skip" href="#contenu">Aller au contenu</a>
<header class="top">
  <div class="wrap">
    <a class="brand" href="/"><img src="/iti-logo.webp" alt="" width="66" height="40"><span>ITI<small>Incubateur Technologique de l'Innovation</small></span></a>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="menu">Menu</button>
    <nav class="nav" id="menu" aria-label="Navigation principale">{nav}<a class="btn btn-primary" href="{WA}" target="_blank" rel="noopener noreferrer">WhatsApp</a></nav>
  </div>
</header>
<main id="contenu">
{contenu}
</main>
<footer class="foot">
  <div class="wrap">
    <div class="cols">
      <div>
        <h4>ITI – Incubateur Technologique de l'Innovation</h4>
        <p>Formation professionnelle, électrotechnique, énergie solaire, vidéosurveillance, informatique et intelligence artificielle. Basés à Douala, présents au Cameroun, au Tchad, en Centrafrique et au Congo.</p>
      </div>
      <div>
        <h4>Le site</h4>
        <ul>{"".join(f'<li><a href="{u}">{t}</a></li>' for u, t in NAV[1:])}<li><a href="/portfolio/">Portfolio du fondateur</a></li></ul>
      </div>
      <div>
        <h4>Nous joindre</h4>
        <ul>
          <li>Fin goudron Mont ESSEC, Douala</li>
          <li><a href="tel:+237687064161">+237 6 87 06 41 61</a> (WhatsApp)</li>
          <li><a href="tel:+237687699417">+237 6 87 69 94 17</a></li>
          <li><a href="mailto:incubateur.th@gmail.com">incubateur.th@gmail.com</a></li>
        </ul>
      </div>
    </div>
    <div class="legal"><span>© <span id="annee">2026</span> ITI. Tous droits réservés.</span><span><a href="/politique">Politique de confidentialité</a></span></div>
  </div>
</footer>
</body>
</html>
"""

DOMAINES = [
    ("Formation professionnelle",
     "Des formations courtes ou longues, avec 70 % de pratique sur du matériel réel, encadrées par des professionnels. Chaque participant reçoit une attestation de formation.",
     ["Électricité, solaire et vidéosurveillance", "Bureautique et assistanat de direction", "Robotique, conception 3D, numérique et intelligence artificielle"]),
    ("Électrotechnique et maintenance",
     "Installations électriques de bâtiments et d'ateliers, dépannage, maintenance préventive et curative.",
     ["Lecture et réalisation de schémas", "Câblage et mise en conformité", "Diagnostic de pannes"]),
    ("Énergie solaire et systèmes hybrides",
     "Étude, dimensionnement, installation et maintenance de systèmes solaires et hybrides pour les foyers, les entreprises et les sites isolés.",
     ["Dimensionnement des besoins", "Installation des panneaux, batteries et onduleurs", "Suivi et maintenance"]),
    ("Vidéosurveillance et sécurité électronique",
     "Installation de caméras de surveillance et de systèmes de contrôle d'accès pour les domiciles, les commerces, les entreprises et les établissements.",
     ["Étude du site et choix du matériel", "Installation et paramétrage des caméras", "Contrôle d'accès, maintenance et suivi"]),
    ("Informatique, réseaux et bureautique",
     "Installation et maintenance de réseaux, configuration de postes et de systèmes, et formation des équipes aux outils de bureau.",
     ["Réseaux filaires et Wi-Fi", "Configuration et maintenance des postes", "Word, Excel, PowerPoint, Outlook"]),
    ("Intelligence artificielle",
     "Accompagnement des entreprises dans l'usage concret de l'IA, et formations pour les étudiants et les professionnels qui veulent s'en servir correctement.",
     ["Rédaction, analyse et synthèse de documents", "Automatisation des tâches administratives", "Bonnes pratiques et sécurité des données"]),
    ("Ingénierie et accompagnement de projets",
     "Du projet à la réalisation : montage, études de faisabilité, dimensionnement technique, dossiers de financement et suivi d'exécution. Nous orientons aussi les jeunes porteurs de projets.",
     ["Études de faisabilité", "Dossiers techniques et de financement", "Suivi de réalisation"]),
    ("Qualité, hygiène, sécurité et environnement (QHSE)",
     "La qualité du travail, la sécurité des personnes et le respect de l'environnement font partie de chacune de nos interventions et de nos formations.",
     ["Sécurité électrique sur les chantiers et dans les ateliers", "Travail contrôlé et documenté", "Gestion responsable des équipements et des déchets"]),
]

def bloc_domaines(n=None, sombre=False):
    items = DOMAINES if n is None else DOMAINES[:n]
    out = []
    for i, (t, d, pts) in enumerate(items, 1):
        lst = "".join(f"<li>{p}</li>" for p in pts)
        out.append(f'<div class="domain"><span class="num">{i:02d}</span><div><h3>{t}</h3><p>{d}</p><ul>{lst}</ul></div></div>')
    return f'<div class="domains">{"".join(out)}</div>'

# Accueil
ecrire("index.html", page("/", "ITI – Formation, électrotechnique, solaire, vidéosurveillance et IA à Douala",
  "L'Incubateur Technologique de l'Innovation forme et accompagne à Douala : électricité, énergie solaire, vidéosurveillance, bureautique, informatique, intelligence artificielle et QHSE.",
f"""<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <p class="eyebrow">Incubateur Technologique de l'Innovation · Douala</p>
      <h1>Des compétences techniques qui servent dès le lendemain.</h1>
      <p class="lead">Nous formons des techniciens et accompagnons entreprises et porteurs de projets en électrotechnique, énergie solaire, vidéosurveillance, informatique, bureautique et intelligence artificielle.</p>
      <div class="actions"><a class="btn btn-primary" href="/formations/">Voir les formations</a><a class="btn btn-ghost" href="/contact/">Demander un devis</a></div>
    </div>
    <div class="hero-photo"><img src="/photos/formation-ia-salle.jpg" alt="Séance de formation au numérique et à l'IA dans une salle d'ITI" width="1400" height="788"></div>
  </div>
  <div class="wrap">
    <div class="facts">
      <div class="fact"><strong>2022</strong><span>Création d'ITI à Douala</span></div>
      <div class="fact"><strong>4 pays</strong><span>Cameroun, Tchad, Centrafrique, Congo</span></div>
      <div class="fact"><strong>70 %</strong><span>de pratique dans chaque formation</span></div>
      <div class="fact"><strong>20+</strong><span>jeunes filles formées au numérique</span></div>
    </div>
  </div>
</section>
<section class="soft">
  <div class="wrap">
    <div class="section-head"><p class="eyebrow">Nos domaines d'intervention</p><h2>Ce que nous faisons</h2><p class="lead">De la formation à l'installation sur le terrain, avec le même souci de qualité et de sécurité.</p></div>
    {bloc_domaines()}
  </div>
</section>
<section>
  <div class="wrap split">
    <div class="photo"><img src="/photos/installation-videosurveillance.jpg" alt="Deux techniciens d'ITI installent une caméra de surveillance" loading="lazy" width="787" height="1400" style="object-position:center 20%"></div>
    <div>
      <p class="eyebrow">Sur le terrain</p>
      <h2>Installer, sécuriser, entretenir</h2>
      <p>Systèmes solaires, réseaux électriques, caméras de surveillance : nous concevons et posons des installations fiables, puis nous assurons leur suivi. Chaque chantier respecte les règles de sécurité électrique et se termine par un contrôle.</p>
      <div class="actions"><a class="btn btn-ghost" href="/domaines/">Tous nos domaines</a></div>
    </div>
  </div>
</section>
<section class="soft">
  <div class="wrap">
    <div class="section-head"><p class="eyebrow">Actualités</p><h2>Nos dernières nouvelles</h2></div>
    <div class="grid" id="dernieres-actualites"><p class="loading">Chargement des actualités…</p></div>
    <div class="actions"><a class="btn btn-ghost" href="/actualites/">Toutes les actualités</a></div>
  </div>
</section>
<section>
  <div class="wrap split">
    <div>
      <p class="eyebrow">Programme « Une fille, une compétence »</p>
      <h2>Former les jeunes filles à des métiers qui recrutent</h2>
      <p>À Douala, plus de vingt jeunes filles ont été formées au numérique, à la gestion et à la prise de parole. Une nouvelle édition se prépare au Tchad.</p>
      <div class="actions"><a class="btn btn-ghost" href="/article/?id=12">Lire le bilan</a></div>
    </div>
    <div class="photo"><img src="/portfolio/images/une-fille-une-competence.jpg" alt="Participantes du programme Une fille, une compétence" loading="lazy" width="1000" height="728"></div>
  </div>
</section>
<section class="dark">
  <div class="wrap">
    <h2>Un projet, une formation, une installation ?</h2>
    <p class="lead" style="color:#c4cfdb">Écrivez-nous : nous répondons sous 24 h ouvrées.</p>
    <div class="actions"><a class="btn btn-primary" href="{WA}" target="_blank" rel="noopener noreferrer">Écrire sur WhatsApp</a><a class="btn btn-light" href="/contact/">Formulaire de contact</a></div>
  </div>
</section>""", "/"))

# Domaines
ecrire("domaines/index.html", page("/domaines/", "Nos domaines d'intervention | ITI",
  "Formation, électrotechnique, énergie solaire, vidéosurveillance, informatique et bureautique, intelligence artificielle, ingénierie de projets et QHSE.",
f"""<section>
  <div class="wrap">
    <div class="section-head"><p class="eyebrow">Domaines d'intervention</p><h1>Former, installer, accompagner</h1><p class="lead">Nous intervenons auprès des particuliers, des entreprises, des écoles et des institutions, au Cameroun, au Tchad, en Centrafrique et au Congo.</p></div>
    {bloc_domaines()}
  </div>
</section>
<section style="padding-top:0">
  <div class="wrap gallery">
    <figure><img src="/portfolio/images/site-solaire.jpg" alt="Installation solaire réalisée par ITI" loading="lazy"><figcaption>Énergie solaire</figcaption></figure>
    <figure><img src="/photos/installation-videosurveillance.jpg" alt="Pose d'une caméra de surveillance" loading="lazy" style="object-position:center 20%"><figcaption>Vidéosurveillance</figcaption></figure>
    <figure><img src="/photos/formateur-en-salle.jpg" alt="Formateur d'ITI devant un groupe" loading="lazy"><figcaption>Formation</figcaption></figure>
  </div>
</section>
<section class="soft">
  <div class="wrap split">
    <div>
      <p class="eyebrow">Notre engagement QHSE</p>
      <h2>Qualité, hygiène, sécurité, environnement</h2>
      <p>Un travail technique bien fait est un travail sûr. Sur nos chantiers comme dans nos ateliers de formation, nous appliquons les règles de sécurité électrique, nous contrôlons et documentons ce que nous livrons, et nous gérons de façon responsable le matériel en fin de vie.</p>
      <p>Notre fondateur se forme en management QHSE à l'ESSEC de l'Université de Douala : cette démarche est intégrée progressivement à nos formations et à nos interventions.</p>
    </div>
    <div class="photo"><img src="/photos/equipe-terrain.jpg" alt="Deux membres de l'équipe ITI en gilets de sécurité, sur le terrain" loading="lazy" style="object-position:center 30%"></div>
  </div>
</section>
<section class="dark"><div class="wrap"><h2>Parlons de votre besoin</h2><div class="actions"><a class="btn btn-primary" href="/contact/">Demander un devis</a><a class="btn btn-light" href="{WA}" target="_blank" rel="noopener noreferrer">WhatsApp</a></div></div></section>""", "/domaines/"))

# Formations
ecrire("formations/index.html", page("/formations/", "Formations pratiques à Douala | ITI",
  "Formations pratiques avec attestation : électricité, énergie solaire, installation de vidéosurveillance, bureautique, assistant de direction, informatique, robotique, conception 3D et IA.",
f"""<section>
  <div class="wrap">
    <div class="section-head"><p class="eyebrow">Formations</p><h1>Apprendre en pratiquant</h1><p class="lead">70 % de pratique, des groupes réduits, des formateurs du terrain et une attestation de formation à la fin de chaque parcours. Les sessions ont lieu à Douala, Fin goudron Mont ESSEC.</p></div>
    <div class="banner"><img src="/photos/formateur-en-salle.jpg" alt="Un formateur d'ITI présente un cours devant les participants" width="1400" height="788"></div>
    <h2 style="font-size:1.3rem">Nos domaines de formation</h2>
    <div class="tags">
      <span class="tag">Électricité bâtiment et industrielle</span><span class="tag">Énergie solaire</span><span class="tag">Installation de vidéosurveillance</span>
      <span class="tag">Bureautique : Word, Excel, PowerPoint, Outlook</span><span class="tag">Assistant de direction</span><span class="tag">Informatique et réseaux</span>
      <span class="tag">Robotique et Arduino</span><span class="tag">Conception 3D</span><span class="tag">Intelligence artificielle</span><span class="tag">Outils numériques</span>
    </div>
  </div>
</section>
<section class="soft">
  <div class="wrap">
    <div class="section-head"><h2>Sessions et programmes</h2><p class="muted">Tarifs en francs CFA. Pour une session en entreprise ou un groupe, contactez-nous.</p></div>
    <div id="liste-formations"><p class="loading">Chargement des formations…</p></div>
  </div>
</section>""", "/formations/"))

# Actualités + article
ecrire("actualites/index.html", page("/actualites/", "Actualités | ITI",
  "Les actualités de l'Incubateur Technologique de l'Innovation : nouvelles formations, programmes et interventions.",
"""<section>
  <div class="wrap">
    <div class="section-head"><p class="eyebrow">Actualités</p><h1>Nouvelles et annonces</h1></div>
    <div class="grid" id="liste-actualites"><p class="loading">Chargement des actualités…</p></div>
  </div>
</section>""", "/actualites/"))
ecrire("article/index.html", page("/article/", "Actualité | ITI", "Actualité de l'Incubateur Technologique de l'Innovation.",
"""<section><div class="wrap"><article class="article" id="article"><p class="loading">Chargement de l'article…</p></article></div></section>""", "/actualites/"))

# À propos
ecrire("a-propos/index.html", page("/a-propos/", "À propos d'ITI et de son fondateur | ITI",
  "Créé à Douala en 2022 par l'ingénieur en électrotechnique Ouinou Ngassala Romain, ITI forme par la pratique et intervient au Cameroun, au Tchad, en Centrafrique et au Congo.",
f"""<section>
  <div class="wrap">
    <div class="section-head"><p class="eyebrow">À propos</p><h1>Transformer des diplômes en compétences</h1></div>
    <div class="split" style="align-items:start">
      <div>
        <p>En 2022, à Douala, un constat s'imposait : chaque année, des milliers de jeunes sortent des universités avec un diplôme, mais sans compétences directement utilisables. Dans le même temps, les entreprises peinent à trouver des techniciens qualifiés.</p>
        <p>L'ingénieur Ouinou Ngassala Romain a créé l'Incubateur Technologique de l'Innovation (ITI) pour répondre à ce décalage : former par la pratique, encadrer par des professionnels et mettre les apprenants face aux réalités du terrain.</p>
        <p>Depuis, ITI forme, installe et accompagne au Cameroun, au Tchad, en Centrafrique et au Congo.</p>
      </div>
      <div>
        <h3>Ils nous ont fait confiance</h3>
        <ul class="muted">
          <li>L'ASEESDT</li>
          <li>La FJSP de l'Université de Douala (2025)</li>
          <li>La FLHS de l'Université de Douala (2024-2025)</li>
          <li>Keylang Centre (2026)</li>
          <li>L'entreprise Café Gourmet</li>
          <li>L'IFPRONA, pour le programme « Une fille, une compétence »</li>
        </ul>
      </div>
    </div>
  </div>
</section>
<section style="padding-top:0">
  <div class="wrap split">
    <div>
      <p class="eyebrow">Proches des jeunes</p>
      <h2>Aux côtés des étudiants et des jeunes diplômés</h2>
      <p>Orientation, choix d'un métier, premiers projets : nous allons à la rencontre des étudiants et des jeunes diplômés, à Douala et dans les communautés de la sous-région.</p>
    </div>
    <div class="photo"><img src="/photos/ceremonie-graduation.jpg" alt="Le fondateur d'ITI échange avec de jeunes diplômés lors d'une cérémonie de graduation à Douala" loading="lazy" width="1280" height="853"></div>
  </div>
</section>
<section class="soft">
  <div class="wrap split">
    <div class="photo" style="aspect-ratio:1/1"><img src="/portfolio/images/portrait.jpg" alt="Ouinou Ngassala Romain, fondateur et PDG d'ITI" loading="lazy" width="900" height="891"></div>
    <div>
      <p class="eyebrow">Le fondateur</p>
      <h2>Ouinou Ngassala Romain</h2>
      <p class="muted">Fondateur et Président Directeur Général</p>
      <p>Ingénieur en électrotechnique, il cumule plus de 8 ans d'expérience sur le terrain (depuis 2018) et forme des techniciens depuis 2021. Ses formations couvrent l'électrotechnique, l'électronique, la robotique, l'informatique et les réseaux, avec une place croissante pour l'intelligence artificielle.</p>
      <p>Il accompagne les entreprises dans l'adoption de l'IA et oriente les jeunes porteurs de projets. Il se forme actuellement en management QHSE (qualité, hygiène, sécurité et environnement) à l'ESSEC de l'Université de Douala.</p>
      <div class="actions"><a class="btn btn-ghost" href="/portfolio/">Voir son portfolio</a></div>
    </div>
  </div>
</section>
<section>
  <div class="wrap">
    <div class="section-head"><p class="eyebrow">Nos principes</p><h2>Ce qui guide notre travail</h2></div>
    <div class="domains">
      <div class="domain"><span class="num">01</span><div><h3>La pratique d'abord</h3><p>70 % du temps de formation se passe sur du matériel réel.</p></div></div>
      <div class="domain"><span class="num">02</span><div><h3>La qualité et la sécurité</h3><p>Des installations contrôlées, des règles de sécurité appliquées sur chaque chantier.</p></div></div>
      <div class="domain"><span class="num">03</span><div><h3>Des solutions adaptées au terrain</h3><p>Conçues pour les réalités de l'Afrique centrale : coupures, budgets, climat.</p></div></div>
      <div class="domain"><span class="num">04</span><div><h3>L'accès pour tous</h3><p>Des programmes dédiés aux jeunes filles et des tarifs étudiants.</p></div></div>
    </div>
  </div>
</section>""", "/a-propos/"))

# Contact
ecrire("contact/index.html", page("/contact/", "Contact et devis | ITI",
  "Contactez l'ITI à Douala par WhatsApp, téléphone ou e-mail pour une formation, une installation solaire, de la vidéosurveillance ou un projet.",
f"""<section>
  <div class="wrap">
    <div class="section-head"><p class="eyebrow">Contact</p><h1>Parlons de votre besoin</h1><p class="lead">Formation, installation, devis ou partenariat : nous répondons sous 24 h ouvrées. Le plus rapide reste WhatsApp.</p></div>
    <div class="contact-grid">
      <dl class="info" id="coordonnees">
        <dt>Adresse</dt><dd id="adresse">Fin goudron Mont ESSEC, Douala, Cameroun</dd>
        <dt>Téléphone et WhatsApp</dt><dd><a id="tel1" href="tel:+237687064161">+237 6 87 06 41 61</a></dd>
        <dt>Téléphone</dt><dd><a id="tel2" href="tel:+237687699417">+237 6 87 69 94 17</a></dd>
        <dt>E-mail</dt><dd><a id="mail" href="mailto:incubateur.th@gmail.com">incubateur.th@gmail.com</a></dd>
        <dt>Horaires</dt><dd>Lundi au vendredi, 8 h – 18 h · samedi, 9 h – 13 h</dd>
        <dt>Plan</dt><dd><a href="https://www.openstreetmap.org/?mlat=4.0511&amp;mlon=9.7679#map=17/4.0511/9.7679" target="_blank" rel="noopener noreferrer">Voir sur la carte</a></dd>
        <dd style="margin-top:24px"><a class="btn btn-primary" href="{WA}" target="_blank" rel="noopener noreferrer">Écrire sur WhatsApp</a></dd>
      </dl>
      <form id="form-contact" novalidate>
        <label for="name">Nom complet</label><input id="name" name="name" autocomplete="name" required maxlength="120">
        <label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="200">
        <label for="phone">Téléphone (facultatif)</label><input id="phone" name="phone" type="tel" autocomplete="tel" maxlength="30">
        <label for="subject">Objet</label>
        <select id="subject" name="subject"><option>Formation</option><option>Installation solaire</option><option>Vidéosurveillance</option><option>Informatique et réseaux</option><option>Intelligence artificielle</option><option>Projet ou partenariat</option><option>Autre</option></select>
        <label for="message">Message</label><textarea id="message" name="message" required maxlength="5000"></textarea>
        <button class="btn btn-primary" type="submit">Envoyer le message</button>
        <p class="notice" id="form-note" role="status"></p>
      </form>
    </div>
  </div>
</section>""", "/contact/"))

# Redirections, plan du site, robots
ecrire("_redirects", """# Anciennes adresses vers les nouvelles pages
/blog          /actualites/        301
/blog/:id      /article/?id=:id    301
/about         /a-propos/          301
/ceo           /a-propos/          301
/services      /domaines/          301
/projects      /domaines/          301
/testimonials  /a-propos/          301
/stats         /a-propos/          301
/faq           /contact/           301
# Espace d'administration et politique de confidentialité (ancienne application)
/admin         /admin/index.html   200
/admin/*       /admin/index.html   200
/politique     /admin/index.html   200
""")
jour = datetime.date.today().isoformat()
urls = ["/", "/domaines/", "/formations/", "/actualites/", "/a-propos/", "/contact/", "/portfolio/"]
ecrire("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
       + "".join(f"  <url><loc>{DOMAINE}{u}</loc><lastmod>{jour}</lastmod></url>\n" for u in urls) + "</urlset>\n")
ecrire("robots.txt", f"User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: {DOMAINE}/sitemap.xml\n")

# Images inutilisées de l'ancien site (exposées sans raison)
vieux = os.path.join(SITE, "images")
if os.path.isdir(vieux):
    shutil.rmtree(vieux)
print("Pages construites :", CSS, JS)
