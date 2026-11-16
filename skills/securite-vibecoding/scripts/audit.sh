#!/usr/bin/env bash
# Audit de sécurité en lecture seule pour un projet web.
# Ne modifie aucun fichier, n'envoie rien sur Internet (sauf npm audit / pip-audit,
# qui interrogent leur base de vulnérabilités).
#
# Usage : bash audit.sh [dossier-du-projet]
#
# Les détections par motifs donnent des faux positifs : chaque alerte se confirme
# en ouvrant le fichier. Les secrets trouvés sont masqués dans la sortie.

set -u
ROOT="${1:-.}"
cd "$ROOT" || { echo "Dossier introuvable : $ROOT"; exit 1; }

if [ -t 1 ]; then R=$'\e[31m'; J=$'\e[33m'; V=$'\e[32m'; G=$'\e[1m'; N=$'\e[0m'; else R=; J=; V=; G=; N=; fi
NB_CRIT=0; NB_ATT=0
titre() { printf '\n%s== %s ==%s\n' "$G" "$1" "$N"; }
crit()  { printf '%s[CRITIQUE]%s %s\n' "$R" "$N" "$1"; NB_CRIT=$((NB_CRIT+1)); }
att()   { printf '%s[À VÉRIFIER]%s %s\n' "$J" "$N" "$1"; NB_ATT=$((NB_ATT+1)); }
ok()    { printf '%s[OK]%s %s\n' "$V" "$N" "$1"; }
info()  { printf '     %s\n' "$1"; }
existe(){ command -v "$1" >/dev/null 2>&1; }

EST_GIT=0; git rev-parse --is-inside-work-tree >/dev/null 2>&1 && EST_GIT=1

# Dossiers à ignorer dans les recherches
EXCL='node_modules|\.git/|vendor/|\.venv/|venv/|__pycache__|\.next/|\.nuxt/|dist/|build/|coverage/|\.svelte-kit/|\.turbo/|\.vercel/|\.netlify/'
EXCL_DIRS=(--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=vendor --exclude-dir=.venv --exclude-dir=venv
           --exclude-dir=__pycache__ --exclude-dir=.next --exclude-dir=.nuxt --exclude-dir=dist --exclude-dir=build
           --exclude-dir=coverage --exclude-dir=.svelte-kit --exclude-dir=.turbo --exclude-dir=.vercel --exclude-dir=.netlify)
CODE_INC=(--include=*.js --include=*.jsx --include=*.ts --include=*.tsx --include=*.mjs --include=*.cjs --include=*.vue
          --include=*.svelte --include=*.astro --include=*.py --include=*.php --include=*.rb --include=*.go --include=*.html
          --include=*.blade.php --include=*.erb --include=*.jinja --include=*.j2 --include=*.sql)

# cherche "motif" dans le code source ; affiche fichier:ligne (max N lignes)
chercher() { # $1 = regex étendue, $2 = max lignes
  grep -rInE "${EXCL_DIRS[@]}" "${CODE_INC[@]}" -- "$1" . 2>/dev/null \
    | grep -vE '\.min\.js:|\.map:|(^|/)(test|tests|__tests__|spec)/|\.test\.|\.spec\.' \
    | awk 'length($0) < 600' \
    | cut -c1-200 | head -n "${2:-15}"
}

# Motifs de secrets (nom|regex)
SECRETS=(
  "Clé AWS|AKIA[0-9A-Z]{16}"
  "Clé secrète Stripe|(sk|rk)_live_[0-9A-Za-z]{20,}"
  "Clé test Stripe|sk_test_[0-9A-Za-z]{20,}"
  "Secret webhook Stripe|whsec_[0-9A-Za-z]{20,}"
  "Clé OpenAI|sk-(proj-)?[A-Za-z0-9_-]{32,}"
  "Clé Anthropic|sk-ant-[A-Za-z0-9_-]{30,}"
  "Jeton GitHub|(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,}"
  "Clé Google|AIza[0-9A-Za-z_-]{35}"
  "Jeton Slack|xox[baprs]-[0-9A-Za-z-]{10,}"
  "Clé SendGrid|SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}"
  "Clé Resend|re_[A-Za-z0-9]{8}_[A-Za-z0-9]{20,}"
  "Clé privée|-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----"
  "Chaîne de connexion avec mot de passe|(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp)://[^:@/[:space:]\"']+:[^@/[:space:]\"']+@"
  "JWT (peut être une clé service_role)|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
)
# Masque les valeurs qui ressemblent à des secrets (garde les 8 premiers caractères
# pour qu'on reconnaisse la clé), sans toucher au reste de la ligne.
masquer() {
  local l s re m
  while IFS= read -r l; do
    for s in "${SECRETS[@]}"; do
      re="${s#*|}"
      while IFS= read -r m; do
        [ -n "$m" ] && l="${l//"$m"/"${m:0:8}••••••"}"
      done < <(printf '%s\n' "$l" | grep -oE -- "$re" 2>/dev/null)
    done
    printf '%s\n' "$l"
  done
}

printf '%sAudit de sécurité — %s%s\n' "$G" "$(pwd)" "$N"
printf 'Lecture seule. Chaque alerte doit être confirmée en lisant le fichier.\n'

# ---------------------------------------------------------------------------
titre "Projet détecté"
[ -f package.json ]      && info "Node.js : $(grep -oE '"(next|react|vue|nuxt|svelte|@sveltejs/kit|express|fastify|hono|astro|@remix-run/[a-z]+|@supabase/supabase-js|firebase|stripe|prisma|@prisma/client|mongoose|sequelize|drizzle-orm)"' package.json | tr -d '"' | sort -u | tr '\n' ' ')"
[ -f requirements.txt ] || [ -f pyproject.toml ] && info "Python : $(cat requirements.txt pyproject.toml 2>/dev/null | grep -ioE '\b(django|flask|fastapi|sqlalchemy|supabase|stripe|psycopg2?|pymongo)\b' | tr 'A-Z' 'a-z' | sort -u | tr '\n' ' ')"
[ -f composer.json ]     && info "PHP (composer.json)"
[ -f Gemfile ]           && info "Ruby (Gemfile)"
[ -f go.mod ]            && info "Go (go.mod)"
for f in vercel.json netlify.toml firebase.json supabase/config.toml Dockerfile docker-compose.yml render.yaml fly.toml; do
  [ -e "$f" ] && info "Déploiement / service : $f"
done
[ "$EST_GIT" = 1 ] || att "Ce dossier n'est pas un dépôt Git : l'analyse de l'historique sera sautée."

# ---------------------------------------------------------------------------
titre "Points 11 / 24 — Fichiers .env et Git"
if [ "$EST_GIT" = 1 ]; then
  suivis=$(git ls-files | grep -E '(^|/)\.env(\..*)?$' | grep -vE '\.(example|sample|template)$')
  if [ -n "$suivis" ]; then
    crit "Fichier(s) .env suivi(s) par Git :"; echo "$suivis" | sed 's/^/     /'
    info "→ git rm --cached <fichier>, l'ajouter au .gitignore, et considérer ses clés comme compromises (point 25)."
  else ok "Aucun .env suivi par Git."; fi
  hist=$(git log --all --diff-filter=A --name-only --format= 2>/dev/null | grep -E '(^|/)\.env(\..*)?$' | grep -vE '\.(example|sample|template)$' | sort -u)
  [ -n "$hist" ] && { crit "Des .env ont été commités dans le passé (encore dans l'historique) :"; echo "$hist" | sed 's/^/     /'; }
  if [ -f .gitignore ] && grep -qE '^\s*/?\.env' .gitignore; then ok ".env est dans le .gitignore."
  else att ".env n'apparaît pas dans le .gitignore."; fi
fi
ls .env* >/dev/null 2>&1 && [ ! -e .env.example ] && att "Pas de .env.example pour documenter les variables attendues."

defauts=$(chercher "(process\.env\.[A-Z_]*(SECRET|KEY|TOKEN|PASSWORD)[A-Z_]*\s*(\|\||\?\?)\s*['\"])|(getenv\(['\"][A-Z_]*(SECRET|KEY|PASSWORD)[A-Z_]*['\"],\s*['\"])|(SECRET_KEY\s*=\s*['\"][^'\"]{1,60}['\"])" 10)
[ -n "$defauts" ] && { att "Secrets avec une valeur par défaut en dur (l'app tournera avec en prod si la variable manque) :"; echo "$defauts" | masquer | sed 's/^/     /'; }

# ---------------------------------------------------------------------------
titre "Points 2 / 24 — Secrets dans les fichiers actuels"
if existe gitleaks; then
  info "gitleaks trouvé : analyse des fichiers (sans historique)…"
  if gitleaks detect --no-git --source . --redact --no-banner -v 2>/dev/null | grep -E '^(Finding|File|Line|RuleID)' | head -60; then :; fi
  gitleaks detect --no-git --source . --redact --no-banner >/dev/null 2>&1 && ok "gitleaks : rien trouvé dans les fichiers." || crit "gitleaks a trouvé des secrets (détail ci-dessus)."
else
  info "gitleaks absent : recherche par motifs (moins fiable). Installer : https://github.com/gitleaks/gitleaks"
  trouve=0
  for s in "${SECRETS[@]}"; do
    nom="${s%%|*}"; re="${s#*|}"
    res=$(grep -rIEn "${EXCL_DIRS[@]}" --exclude=*.lock --exclude=package-lock.json --exclude=*.min.js --exclude=*.map -- "$re" . 2>/dev/null | head -8)
    if [ -n "$res" ]; then
      trouve=1
      if [[ "$nom" == JWT* ]]; then att "$nom :"; else crit "$nom :"; fi
      echo "$res" | masquer | cut -c1-180 | sed 's/^/     /'
    fi
  done
  [ "$trouve" = 0 ] && ok "Aucun motif de secret connu dans les fichiers."
fi

pub=$(grep -rInE "${EXCL_DIRS[@]}" -- '(NEXT_PUBLIC|VITE|REACT_APP|NUXT_PUBLIC|EXPO_PUBLIC|PUBLIC)_[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|OPENAI|ANTHROPIC|STRIPE_SECRET|SK_)[A-Z0-9_]*' . 2>/dev/null | head -10)
[ -n "$pub" ] && { crit "Variable secrète exposée au navigateur (préfixe public) :"; echo "$pub" | masquer | cut -c1-180 | sed 's/^/     /'; }
sr=$(chercher "service_role|SUPABASE_SERVICE" 20 | grep -E '(src|app|pages|components|public|lib|client)/' | grep -vE '(api|server|functions|supabase/functions)/' | head -8)
[ -n "$sr" ] && { att "Mention de la clé service_role Supabase dans du code qui peut être côté client :"; echo "$sr" | masquer | sed 's/^/     /'; }

# ---------------------------------------------------------------------------
titre "Point 24 — Secrets dans l'historique Git"
if [ "$EST_GIT" = 1 ]; then
  if existe gitleaks; then
    if gitleaks detect --source . --log-opts="--all" --redact --no-banner >/dev/null 2>&1; then ok "gitleaks : historique propre."
    else
      crit "gitleaks a trouvé des secrets dans l'historique :"
      gitleaks detect --source . --log-opts="--all" --redact --no-banner -v 2>/dev/null | grep -E '^(RuleID|File|Commit|Date)' | head -40 | sed 's/^/     /'
    fi
  else
    info "Recherche par motifs dans tous les commits (peut prendre un moment sur un gros dépôt)…"
    trouve=0
    for s in "${SECRETS[@]}"; do
      nom="${s%%|*}"; re="${s#*|}"
      [[ "$nom" == JWT* ]] && continue
      commits=$(git log --all -G"$re" --format='%h %ad %s' --date=short 2>/dev/null | head -5)
      if [ -n "$commits" ]; then
        trouve=1; crit "Motif « $nom » trouvé dans l'historique, commits :"
        echo "$commits" | cut -c1-120 | sed 's/^/     /'
      fi
    done
    [ "$trouve" = 0 ] && ok "Aucun motif de secret connu dans l'historique."
  fi
  info "Si un secret est trouvé : le révoquer d'abord (point 25), nettoyer l'historique ensuite."
fi

# ---------------------------------------------------------------------------
titre "Point 23 — Fichiers sensibles présents dans le projet"
sens=$(find . \( -path ./node_modules -o -path ./.git -o -path ./vendor -o -path ./.venv -o -path ./venv \) -prune -o -type f \( \
  -name '*.sql' -o -name '*.sqlite' -o -name '*.sqlite3' -o -name '*.db' -o -name '*.bak' -o -name '*.old' -o -name '*.orig' \
  -o -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.pfx' -o -name 'id_rsa*' -o -name 'id_ed25519*' \
  -o -name 'serviceAccountKey*.json' -o -name 'credentials*.json' -o -name '*-firebase-adminsdk-*.json' \
  -o -name '*.log' -o -name 'phpinfo.php' -o -name '.DS_Store' -o -name '*.dump' -o -name 'backup*.zip' -o -name '*.tar.gz' \
  \) -print 2>/dev/null | head -30)
if [ -n "$sens" ]; then
  att "Fichiers à vérifier (ne doivent être ni commités avec des données réelles, ni publiés) :"; echo "$sens" | sed 's/^/     /'
else ok "Aucun fichier sensible évident."; fi
for d in public static dist build out site-en-ligne _site www htdocs; do
  [ -d "$d" ] || continue
  pubsens=$(find "$d" -type f \( -name '.env*' -o -name '*.sql' -o -name '*.db' -o -name '*.sqlite*' -o -name '*.bak' -o -name '*.pem' -o -name '*.key' -o -name '*.log' -o -name '*.zip' \) 2>/dev/null | head -10)
  [ -n "$pubsens" ] && { crit "Fichiers sensibles dans le dossier publié « $d » :"; echo "$pubsens" | sed 's/^/     /'; }
  maps=$(find "$d" -name '*.map' 2>/dev/null | head -3)
  [ -n "$maps" ] && att "Source maps publiées dans « $d » (le code source lisible par tous) : $(echo "$maps" | tr '\n' ' ')"
done

# ---------------------------------------------------------------------------
titre "Point 20 — Mode debug"
dbg=$(chercher "DEBUG\s*=\s*True|debug\s*=\s*True|app\.run\([^)]*debug\s*=\s*True|FLASK_DEBUG\s*=\s*1|APP_DEBUG\s*=\s*true|display_errors\s*=\s*(On|1)|productionBrowserSourceMaps\s*:\s*true" 10)
dbg_env=$(grep -HnE '^(DEBUG|APP_DEBUG|FLASK_DEBUG|DJANGO_DEBUG)\s*=\s*(1|true|True)' .env.production .env.prod 2>/dev/null)
[ -n "$dbg$dbg_env" ] && { att "Mode debug activé quelque part (vérifier que ce n'est pas la config de prod) :"; printf '%s\n%s\n' "$dbg" "$dbg_env" | sed '/^$/d;s/^/     /'; } || ok "Pas de mode debug évident."
routes=$(chercher "['\"]/(api/)?(test|debug|seed|reset-db|dev|phpinfo)['\"/]" 8)
[ -n "$routes" ] && { att "Routes de test / debug à retirer avant la prod :"; echo "$routes" | sed 's/^/     /'; }

# ---------------------------------------------------------------------------
titre "Point 10 — Requêtes SQL construites par concaténation"
sql=$(chercher "(query|execute|exec|raw|queryRawUnsafe|executeRawUnsafe|prepare)\s*\(\s*(f['\"]|\`[^\`]*\\$\{|['\"][^'\"]*(SELECT|INSERT|UPDATE|DELETE)[^'\"]*['\"]\s*(\+|%|\.format))" 15)
sql2=$(chercher '\$queryRawUnsafe|\$executeRawUnsafe|DB::raw\(.*\$|whereRaw\(.*\$' 10)
if [ -n "$sql$sql2" ]; then att "Requêtes potentiellement injectables :"; printf '%s\n%s\n' "$sql" "$sql2" | sed '/^$/d' | awk '!vu[$0]++' | sed 's/^/     /'
else ok "Pas de concaténation SQL évidente."; fi
mongo=$(chercher "\.(find|findOne|updateOne|deleteOne|findOneAndUpdate)\(\s*req\.(body|query)" 5)
[ -n "$mongo" ] && { att "Requête Mongo construite directement depuis la requête (injection d'opérateurs) :"; echo "$mongo" | sed 's/^/     /'; }

# ---------------------------------------------------------------------------
titre "Point 7 — Points d'injection HTML (XSS)"
xss=$(chercher "dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write\(|v-html=|\{@html|\|\s*safe\b|mark_safe\(|\{!!" 20)
if [ -n "$xss" ]; then att "Contenu inséré comme HTML (sans risque seulement si la donnée n'est pas fournie par un utilisateur, ou si elle est assainie) :"; echo "$xss" | sed 's/^/     /'
else ok "Aucun point d'injection HTML évident."; fi
grep -rqE "${EXCL_DIRS[@]}" --include=package.json 'dompurify|sanitize-html' . 2>/dev/null && info "Bibliothèque d'assainissement présente (DOMPurify / sanitize-html)."

# ---------------------------------------------------------------------------
titre "Points 13 / 14 / 15 / 16 — CORS, en-têtes, cookies, CSRF"
cors=$(chercher "Access-Control-Allow-Origin['\"]?\s*[:,]\s*['\"]\*|origin\s*:\s*(['\"]\*['\"]|true)|CORS_ALLOW_ALL_ORIGINS\s*=\s*True|allow_origins\s*=\s*\[\s*['\"]\*" 10)
[ -n "$cors" ] && { att "CORS ouvert à toutes les origines :"; echo "$cors" | sed 's/^/     /'; }

if [ -f package.json ]; then
  grep -q '"helmet"' package.json && ok "Helmet installé." || { grep -qE '"(express|fastify|koa|hono)"' package.json && att "Serveur Node sans Helmet : vérifier les en-têtes de sécurité."; }
  grep -qE '"next"' package.json && ! grep -qsE 'headers\s*\(' next.config.* 2>/dev/null && att "Next.js : aucun headers() dans next.config — en-têtes de sécurité à ajouter (ou via vercel.json / middleware)."
fi
for f in netlify.toml _headers public/_headers vercel.json; do
  [ -f "$f" ] || continue
  for h in Strict-Transport-Security Content-Security-Policy X-Content-Type-Options Referrer-Policy; do
    grep -qi "$h" "$f" || att "$f : en-tête $h absent."
  done
done

ls_tok=$(chercher "localStorage\.setItem\(\s*['\"][^'\"]*(token|jwt|session|auth)" 8)
[ -n "$ls_tok" ] && { att "Jeton d'authentification stocké dans localStorage (lisible en cas de XSS) :"; echo "$ls_tok" | sed 's/^/     /'; }
cook=$(chercher "(res\.cookie|cookies\(\)\.set|setcookie|set_cookie)\(" 15)
if [ -n "$cook" ]; then
  sans=$(echo "$cook" | grep -viE 'httpOnly|httponly' | head -8)
  [ -n "$sans" ] && { att "Cookies posés sans httpOnly visible sur la même ligne (vérifier les options) :"; echo "$sans" | sed 's/^/     /'; }
fi
faible=$(chercher "secret\s*:\s*['\"](keyboard cat|secret|changeme|change-me|mysecret|your[_-]?secret[^'\"]*)['\"]" 5)
[ -n "$faible" ] && { crit "Secret de session par défaut :"; echo "$faible" | sed 's/^/     /'; }
if [ -f package.json ] && grep -qE '"(express|fastify)"' package.json && grep -qE '"(express-session|cookie-session|cookie-parser)"' package.json; then
  grep -qE '"(csrf-csrf|csrf-sync|@fastify/csrf-protection|lusca)"' package.json && ok "Protection CSRF installée." || att "Sessions par cookie sans bibliothèque CSRF détectée (point 16)."
fi

# ---------------------------------------------------------------------------
titre "Points 1 / 5 / 9 / 12 — Auth, mots de passe, admin, limites"
hash=$(chercher "(md5|sha1|sha256|createHash\(['\"](md5|sha1|sha256)['\"]\)|hashlib\.(md5|sha1|sha256)|digest\().{0,80}(pass|pwd|mdp|mot_de_passe)|(pass|pwd|mdp|mot_de_passe).{0,80}(md5|sha1|sha256|hashlib|createHash|digest\()" 10)
[ -n "$hash" ] && { crit "Mot de passe haché avec une fonction rapide (MD5 / SHA) au lieu d'Argon2 / bcrypt :"; echo "$hash" | sed 's/^/     /'; }
clair=$(chercher "(password|motDePasse|mdp|pwd)\s*(===?|==)\s*['\"][^'\"]{3,}['\"]" 5)
[ -n "$clair" ] && { crit "Mot de passe comparé en dur dans le code :"; echo "$clair" | masquer | sed 's/^/     /'; }
jwtd=$(chercher "jwt\.decode\(|jwtDecode\(|jwt_decode\(" 5)
[ -n "$jwtd" ] && { att "JWT décodé : vérifier qu'il est aussi vérifié (signature) côté serveur :"; echo "$jwtd" | sed 's/^/     /'; }
role=$(chercher "localStorage\.getItem\(['\"][^'\"]*(admin|role|isAdmin)" 5)
[ -n "$role" ] && { crit "Rôle admin lu depuis localStorage (modifiable par l'utilisateur) :"; echo "$role" | sed 's/^/     /'; }
adm=$(find . \( -path ./node_modules -o -path ./.git \) -prune -o -type d -iname '*admin*' -print 2>/dev/null | head -5)
[ -n "$adm" ] && info "Dossiers admin à contrôler à la main (point 9) : $(echo "$adm" | tr '\n' ' ')"
if [ -f package.json ]; then
  grep -qE '"(express-rate-limit|@upstash/ratelimit|rate-limiter-flexible|@fastify/rate-limit|hono-rate-limiter)"' package.json \
    && ok "Bibliothèque de limite de requêtes présente." || att "Aucune bibliothèque de limite de requêtes dans package.json (point 12)."
fi
if ls requirements.txt pyproject.toml >/dev/null 2>&1; then
  cat requirements.txt pyproject.toml 2>/dev/null | grep -qiE 'slowapi|django-ratelimit|flask-limiter' \
    && ok "Limite de requêtes Python présente." || att "Aucune bibliothèque de limite de requêtes Python (slowapi, flask-limiter, django-ratelimit)."
fi

# ---------------------------------------------------------------------------
titre "Points 18 / 19 — Envoi de fichiers et paiements"
up=$(chercher "multer|formidable|busboy|UploadFile|request\.files|FileField|storage\.from\(.*\)\.upload" 6)
if [ -n "$up" ]; then
  att "Envoi de fichiers détecté — vérifier taille max, type réel, nom aléatoire :"; echo "$up" | sed 's/^/     /'
  chercher "fileSize|max_size|MAX_CONTENT_LENGTH|DATA_UPLOAD_MAX|maxFileSize" 3 | grep -q . || att "Aucune limite de taille repérée."
fi
pay=$(chercher "stripe|paypal|paystack|flutterwave|cinetpay|lemonsqueezy|mollie" 1)
if [ -n "$pay" ]; then
  prix=$(chercher "(amount|price|prix|total|unit_amount)\s*:\s*(req\.body|body\.|data\.|params\.|request\.(json|form))" 8)
  [ -n "$prix" ] && { crit "Montant venant de la requête du client :"; echo "$prix" | sed 's/^/     /'; }
  chercher "constructEvent|verify_signature|verifyWebhook|Webhook\.construct_event|x-paystack-signature|verif-hash" 1 | grep -q . \
    && ok "Vérification de signature de webhook repérée." || crit "Paiement présent mais aucune vérification de signature de webhook repérée."
fi

# ---------------------------------------------------------------------------
titre "Point 3 — Base de données"
if [ -d supabase/migrations ] || grep -qs '@supabase/supabase-js' package.json; then
  tables=$(grep -rhoiE 'create table (if not exists )?[a-z_."]+' supabase/ 2>/dev/null | wc -l | tr -d ' ')
  rls=$(grep -rhoiE 'enable row level security' supabase/ 2>/dev/null | wc -l | tr -d ' ')
  info "Supabase : $tables création(s) de table et $rls activation(s) RLS dans supabase/."
  [ "${tables:-0}" -gt "${rls:-0}" ] && att "Moins d'activations RLS que de tables : vérifier chaque table (et lancer les Security Advisors du tableau de bord)."
  info "Vérifier aussi en ligne : select tablename from pg_tables where schemaname='public' and rowsecurity=false;"
fi
[ -f firestore.rules ] && grep -qE 'allow (read|write|read, write)\s*:\s*if\s+true' firestore.rules && crit "firestore.rules : accès ouvert à tous (if true)."
[ -f database.rules.json ] && grep -qE '"\.(read|write)"\s*:\s*true' database.rules.json && crit "database.rules.json : accès ouvert à tous."
[ -f storage.rules ] && grep -qE 'if\s+true' storage.rules && crit "storage.rules : stockage ouvert à tous."

# ---------------------------------------------------------------------------
titre "Points 21 / 22 — Dépendances"
if [ -f package.json ]; then
  if [ -f package-lock.json ] && existe npm; then
    out=$(npm audit --omit=dev --audit-level=low 2>/dev/null | tail -n 15)
    if echo "$out" | grep -qiE 'critical|high'; then crit "npm audit (dépendances de prod) :"; else att "npm audit (dépendances de prod) :"; fi
    echo "$out" | sed 's/^/     /'
  elif [ -f pnpm-lock.yaml ] && existe pnpm; then pnpm audit --prod 2>/dev/null | tail -n 15 | sed 's/^/     /'
  elif [ -f yarn.lock ]; then info "yarn : lancer « yarn npm audit » (Berry) ou « yarn audit » (v1)."
  else att "Pas de lockfile : versions non figées, audit impossible. Lancer npm install et commiter package-lock.json."; fi
  if existe depcheck; then
    info "Paquets peut-être inutilisés (depcheck — à confirmer à la main) :"; depcheck 2>/dev/null | head -20 | sed 's/^/     /'
  else info "Paquets inutilisés : lancer « npx depcheck » puis vérifier chaque paquet avant de le retirer."; fi
fi
if ls requirements.txt pyproject.toml >/dev/null 2>&1; then
  if existe pip-audit; then
    info "pip-audit :"; pip-audit $( [ -f requirements.txt ] && echo "-r requirements.txt" ) 2>/dev/null | tail -n 15 | sed 's/^/     /'
  else info "Python : installer pip-audit (pip install pip-audit) puis lancer « pip-audit -r requirements.txt ». Inutilisés : deptry."; fi
fi
[ -f composer.lock ] && existe composer && { info "composer audit :"; composer audit 2>/dev/null | tail -n 15 | sed 's/^/     /'; }

# ---------------------------------------------------------------------------
titre "Résumé"
printf '%s%d critique(s)%s, %s%d point(s) à vérifier%s.\n' "$R" "$NB_CRIT" "$N" "$J" "$NB_ATT" "$N"
cat <<'FIN'
Cet audit repère des signaux, il ne prouve rien dans un sens ni dans l'autre.
Restent à vérifier à la main, avec references/checklist.md :
  - l'authentification et le contrôle des rôles sur CHAQUE route (points 1, 9) ;
  - la validation serveur de chaque formulaire (point 6) ;
  - le flux de mot de passe oublié (point 17) ;
  - la journalisation des événements de sécurité (point 8) ;
  - le site en ligne : HTTPS, en-têtes, fichiers exposés (points 4, 14, 23 — voir E19).
FIN
