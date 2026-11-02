// Construit le site publié dans _site/ à partir de :
//   site/               le site (gabarit HTML, JS, CSS)
//   content/articles/   les articles écrits depuis /admin (Markdown)
//   content/images/     les images envoyées depuis /admin
//   publications/, a/, img/   les publications ITI déjà existantes
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { marked } from "marked";

const DOMAIN = "https://incubateurtech.tech";
const SITE_NAME = "ITI - Incubateur Technologique de l'Innovation";
const DEFAULT_IMAGE = "https://d2xsxph8kpxj0f.cloudfront.net/310519663472322953/SiZDkWCMs9VVpK9Ntbw4tM/iti-logo_bd84f922.webp";
const OUT = "_site";

const PAGES = {
  "/": ["Formation, Ingénierie & Solutions Technologiques à Douala", "Centre de formation technique à Douala : maintenance électrique, robotique Arduino, conception 3D, énergies solaires. 70 % de pratique. Ingénierie et solutions technologiques."],
  "/about": ["À propos : notre histoire depuis 2022", "Créé à Douala en 2022 par l'ingénieur Ouinou Ngassala Romain, l'ITI forme par la pratique et accompagne les projets technologiques locaux."],
  "/ceo": ["Le mot du PDG", "Ouinou Ngassala Romain, fondateur et PDG de l'Incubateur Technologique de l'Innovation (ITI), présente la vision de l'incubateur."],
  "/services": ["Nos services : formation, ingénierie, solutions, conseil", "Formation professionnelle, ingénierie de projets, télécoms et sécurité électronique, conseil et orientation : les services de l'ITI à Douala."],
  "/formations": ["Formations certifiantes à Douala", "Maintenance électrique et industrielle, robotique Arduino, conception 3D SolidWorks, énergies renouvelables, outils numériques : 70 % de pratique."],
  "/blog": ["Blog : actualités et tutoriels", "Actualités de l'ITI, tutoriels Arduino et électricité, conseils pour choisir sa formation technique."],
  "/faq": ["Questions fréquentes", "Durée, tarifs, paiement, inscription, certification : les réponses aux questions fréquentes sur les formations de l'ITI."],
  "/contact": ["Contact et inscription", "Contactez l'ITI à Douala par téléphone, WhatsApp ou e-mail pour vous inscrire à une formation ou présenter un projet."],
  "/mentions-legales": ["Mentions légales et confidentialité", "Éditeur du site, hébergement et traitement des données personnelles transmises via le site de l'ITI."],
};

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const copy = (from, to) => fs.existsSync(from) && fs.cpSync(from, to, { recursive: true });
const write = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const dateStr = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || "").slice(0, 10));

// 1. Articles
const dir = "content/articles";
const articles = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
  .filter((f) => f.endsWith(".md"))
  .map((f) => {
    const raw = fs.readFileSync(path.join(dir, f), "utf8");
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    const data = m ? yaml.load(m[1]) || {} : {};
    const body = m ? m[2] : raw;
    return {
      id: f.replace(/\.md$/, ""),
      title: data.title || f,
      date: dateStr(data.date) || new Date().toISOString().slice(0, 10),
      category: data.category || "Actualités ITI",
      author: data.author || "Équipe ITI",
      image: data.image || DEFAULT_IMAGE,
      excerpt: data.excerpt || "",
      published: data.published !== false,
      html: marked.parse(body),
    };
  })
  .filter((a) => a.published)
  .sort((a, b) => b.date.localeCompare(a.date));

// 2. Copie des fichiers
fs.rmSync(OUT, { recursive: true, force: true });
copy("site", OUT);
copy("content/images", path.join(OUT, "images/uploads"));
copy("admin", path.join(OUT, "admin"));
copy("a", path.join(OUT, "a"));
copy("img", path.join(OUT, "img"));
fs.writeFileSync(path.join(OUT, "content.json"), JSON.stringify({ articles }));
fs.writeFileSync(path.join(OUT, "CNAME"), "incubateurtech.tech\n");
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

// Publications existantes : /publications, avec des liens canoniques mis à jour
if (fs.existsSync("publications/index.html")) {
  fs.writeFileSync(path.join(OUT, "publications.html"), fs.readFileSync("publications/index.html", "utf8").replaceAll("https://ouinou.github.io/Romain-/", `${DOMAIN}/publications`));
}
for (const f of fs.existsSync(path.join(OUT, "a")) ? fs.readdirSync(path.join(OUT, "a")) : []) {
  const p = path.join(OUT, "a", f, "index.html");
  if (fs.existsSync(p)) fs.writeFileSync(p, fs.readFileSync(p, "utf8").replaceAll("https://ouinou.github.io/Romain-/#", `${DOMAIN}/publications#`).replaceAll("../../#", "/publications#"));
}

// 3. Une page HTML par adresse, avec titre et description déjà remplis
const template = fs.readFileSync("site/index.html", "utf8")
  .replace(/\s*<title>[\s\S]*?<\/title>/, "")
  .replace(/\s*<meta name="(description|robots|twitter:title|twitter:description|twitter:image)"[^>]*>/g, "")
  .replace(/\s*<meta property="og:(title|description|url|image)"[^>]*>/g, "")
  .replace(/\s*<link rel="canonical"[^>]*>/g, "")
  .replace('<link rel="stylesheet" crossorigin href="/assets/', '<link rel="stylesheet" href="/assets/iti-article.css">\n    <link rel="stylesheet" crossorigin href="/assets/');

function page(route, title, description, { image = DEFAULT_IMAGE, index = true } = {}) {
  const url = DOMAIN + route;
  const head = `
    <title>${esc(title)} | ${esc(SITE_NAME)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta name="robots" content="${index ? "index, follow" : "noindex, follow"}" />
    <link rel="canonical" href="${esc(url)}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${esc(url)}" />
    <meta property="og:image" content="${esc(image)}" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(description)}" />
    <meta name="twitter:image" content="${esc(image)}" />
    <script>window.ITI_READY=fetch("/content.json",{cache:"no-cache"}).then(function(r){return r.json()}).then(function(d){window.ITI_CONTENT=d}).catch(function(){window.ITI_CONTENT={articles:[]}});</script>`;
  return template.replace(/(<meta name="viewport"[^>]*>)/, `$1${head}`);
}
const fileFor = (route) => path.join(OUT, route === "/" ? "index.html" : `${route.slice(1)}.html`);

for (const [route, [t, d]] of Object.entries(PAGES)) write(fileFor(route), page(route, t, d, route === "/ceo" ? { image: `${DOMAIN}/images/pdg-iti.jpg` } : {}));
for (const a of articles) write(fileFor(`/blog/${a.id}`), page(`/blog/${a.id}`, a.title, a.excerpt || a.title, { image: a.image }));
write(path.join(OUT, "404.html"), page("/404", "Page introuvable", "Cette page n'existe pas.", { index: false }));

// 4. Plan du site et robots.txt
const today = new Date().toISOString().slice(0, 10);
const urls = [
  ...Object.keys(PAGES).map((r) => [r, today]),
  ["/publications", today],
  ...articles.map((a) => [`/blog/${a.id}`, a.date]),
];
write(path.join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([r, d]) => `  <url><loc>${DOMAIN}${r}</loc><lastmod>${d}</lastmod></url>`).join("\n")}\n</urlset>\n`);
write(path.join(OUT, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${DOMAIN}/sitemap.xml\n`);

console.log(`Site construit : ${articles.length} article(s), ${Object.keys(PAGES).length} pages.`);
