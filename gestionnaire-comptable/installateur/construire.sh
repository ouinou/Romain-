#!/usr/bin/env bash
# Construit le setup Windows « tout inclus » de FINEXA ERP (depuis Linux, avec NSIS).
#   installateur/construire.sh [dossier-cache-des-téléchargements]
# Prérequis : Node.js 22, npm, unzip, makensis (paquet nsis), curl.
set -euo pipefail
ICI="$(cd "$(dirname "$0")" && pwd)"; RACINE="$(dirname "$ICI")"
CACHE="${1:-$HOME/.cache/gestionnaire-comptable-installateur}"
ETAPE="$ICI/construction"; SORTIE="$ICI/sortie"
VERSION="$(node -p "require('$RACINE/serveur/package.json').version")"
mkdir -p "$CACHE" "$SORTIE"; rm -rf "$ETAPE"; mkdir -p "$ETAPE"/{runtime,outils,interface,docs}

echo "» Téléchargements (vérifiés par SHA-256)"
grep -v '^#' "$ICI/versions.txt" | while read -r nom url empreinte; do
  [ -f "$CACHE/$nom" ] || curl -sSfL -o "$CACHE/$nom" "$url"
  echo "$empreinte  $CACHE/$nom" | sha256sum -c --quiet || { echo "Empreinte incorrecte pour $nom : fichier altéré ou version changée." >&2; exit 1; }
done

echo "» Compilation du serveur et de l'interface"
(cd "$RACINE/serveur" && npm ci --silent && npm run -s build)
(cd "$RACINE/interface" && npm ci --silent && npm run -s build)
mkdir -p "$ETAPE/serveur"
cp -r "$RACINE/serveur/dist" "$RACINE/serveur/migrations" "$RACINE/serveur/sql" "$RACINE/serveur/package.json" "$RACINE/serveur/package-lock.json" "$ETAPE/serveur/"
# Dépendances de production seulement ; --ignore-scripts : argon2 utilise ses binaires précompilés (dont win32-x64).
(cd "$ETAPE/serveur" && npm ci --omit=dev --ignore-scripts --silent)
test -f "$ETAPE/serveur/node_modules/argon2/prebuilds/win32-x64/argon2.glibc.node" -o -d "$ETAPE/serveur/node_modules/argon2/prebuilds/win32-x64" || { echo "argon2 : binaire Windows absent." >&2; exit 1; }
cp -r "$RACINE/interface/dist" "$ETAPE/interface/"
cp "$ICI/configurer.mjs" "$ICI/certificats.mjs" "$ETAPE/outils/"
(cd "$ICI" && npm ci --silent) && cp -r "$ICI/node_modules" "$ETAPE/outils/"

echo "» Node.js, PostgreSQL, WinSW, Visual C++"
mkdir -p "$ETAPE/runtime/node"
unzip -q -j "$CACHE/node-v22.23.4-win-x64.zip" "node-v22.23.4-win-x64/node.exe" "node-v22.23.4-win-x64/LICENSE" -d "$ETAPE/runtime/node"
unzip -q "$CACHE/postgresql-16.15-1-windows-x64-binaries.zip" "pgsql/bin/*" "pgsql/lib/*" "pgsql/share/*" "pgsql/server_license.txt" -d "$ETAPE/runtime"
# Outils graphiques et de développement inutiles au serveur.
rm -f "$ETAPE"/runtime/pgsql/bin/{stackbuilder.exe,wx*.dll,*regress*.exe,isolationtester.exe,libpq_*.exe,test_cloexec.exe,testplug.dll,ecpg.exe,*.lib} "$ETAPE"/runtime/pgsql/lib/*.lib
rm -rf "$ETAPE/runtime/pgsql/lib/pgxs"
cp "$CACHE/WinSW-x64.exe" "$CACHE/vc_redist.x64.exe" "$ETAPE/runtime/"

cp "$ICI/marque/finexa.ico" "$ETAPE/finexa.ico"

echo "» Documentation et licences"
cp "$RACINE/docs/GUIDE-UTILISATION.md" "$ETAPE/docs/GUIDE-UTILISATION.txt"; cp "$RACINE/docs/SECURITE.md" "$ETAPE/docs/SECURITE.txt"; cp "$ICI/INSTALLATION-SETUP.md" "$ETAPE/docs/INSTALLATION-SETUP.txt"
{ echo "FINEXA ERP ${VERSION} (éditeur : Incubateur Technologique de l'Innovation, ITI) : composants tiers et leurs licences"; echo
  echo "== PostgreSQL (licence PostgreSQL) =="; cat "$ETAPE/runtime/pgsql/server_license.txt"; echo
  echo "== Node.js (licence MIT et autres, voir runtime/node/LICENSE) =="; head -25 "$ETAPE/runtime/node/LICENSE"; echo
  echo "== WinSW (licence MIT) : https://github.com/winsw/winsw =="; echo
  echo "== Police Lato (SIL Open Font License 1.1) =="; cat "$RACINE/interface/src/polices/LICENCE-OFL.txt"
  echo "== Microsoft Visual C++ Redistributable : licence Microsoft, installé tel quel =="; } > "$ETAPE/LICENCES.txt"

echo "» Setup NSIS"
makensis -V2 -DVERSION="$VERSION" -DETAPE="$ETAPE" -DSORTIE="$SORTIE" "$ICI/gestionnaire-comptable.nsi"
ls -la "$SORTIE"
sha256sum "$SORTIE"/*.exe | tee "$SORTIE/SHA256SUMS.txt"
