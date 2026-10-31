'use strict';
/*
 * RTMS v2 — interface web.
 * Même structure et mêmes écrans que le prototype ; les données passent désormais par
 * l'API sécurisée. Rien ici n'est une protection : l'interface masque ce que le profil
 * ne peut pas faire, mais c'est le serveur qui décide (permissions, validation, licence).
 */
(() => {
  const titles = { dashboard: 'Tableau de bord', transport: 'Gestion du transport', transit: 'Gestion du transit', importexport: 'Importation et exportation', commerce: 'Commerce général & stocks', clients: 'Clients & fournisseurs', fleet: 'Parc automobile', staff: 'Personnel & chauffeurs', maintenance: 'Maintenance', invoices: 'Facturation', finance: 'Finance & trésorerie', documents: 'Gestion documentaire', reports: 'Rapports & statistiques', settings: 'Paramètres généraux' };

  const money = (v) => (v === undefined || v === null || v === '' ? '—' : Number(v).toLocaleString('fr-FR'));
  // Colonnes explicites : le prototype affichait parfois la mauvaise valeur (ex. la quantité
  // dans « Total TTC ») car il se rabattait sur la position du champ.
  const configs = {
    transport: { desc: 'Planifiez les missions et suivez leur exécution.', button: 'Nouvelle mission', cols: [['Référence', 'Référence mission'], ['Client', 'Client'], ['Trajet', (d) => `${d['Départ'] ?? '—'} → ${d.Destination ?? '—'}`], ['Marchandise', 'Marchandise'], ['Véhicule', 'Véhicule'], ['Date', 'Date de départ'], ['Statut', 'Statut']] },
    transit: { desc: 'Centralisez les dossiers et formalités de transit.', button: 'Nouveau dossier', cols: [['Référence', 'Référence dossier'], ['Client', 'Client'], ['Origine → destination', (d) => `${d.Origine ?? '—'} → ${d.Destination ?? '—'}`], ['Procédure', 'Type de procédure'], ['Ouverture', 'Date ouverture'], ['Frais', (d) => money(d['Frais estimés'])], ['Statut', 'Statut']] },
    importexport: { desc: 'Suivez les opérations commerciales internationales.', button: 'Nouvelle opération', cols: [['Référence', 'Référence'], ['Type', 'Type (Import/Export)'], ['Partenaire', 'Client / fournisseur'], ['Pays', (d) => `${d['Pays d’origine'] ?? '—'} → ${d['Pays de destination'] ?? '—'}`], ['Marchandise', 'Marchandise'], ['Valeur', (d) => money(d['Valeur déclarée'])], ['Statut', 'Statut']] },
    commerce: { desc: 'Gérez les articles, achats, ventes et mouvements de stock.', button: 'Ajouter un article', cols: [['Code', 'Code article'], ['Désignation', 'Désignation'], ['Catégorie', 'Catégorie'], ['Stock', (d) => `${d['Quantité en stock'] ?? '—'} ${d['Unité'] ?? ''}`.trim()], ['Prix achat', (d) => money(d['Prix d’achat'])], ['Prix vente', (d) => money(d['Prix de vente'])]] },
    clients: { desc: 'Répertoire central des clients et fournisseurs.', button: 'Ajouter un contact', cols: [['Type', 'Type (Client/Fournisseur)'], ['Nom / raison sociale', 'Nom / raison sociale'], ['Téléphone', 'Téléphone'], ['E-mail', 'E-mail'], ['Adresse', 'Adresse']] },
    fleet: { desc: 'Suivez les véhicules, leurs documents et leur disponibilité.', button: 'Ajouter un véhicule', cols: [['Immatriculation', 'Immatriculation'], ['Véhicule', 'Marque / modèle'], ['Type', 'Type'], ['Kilométrage', (d) => money(d['Kilométrage'])], ['Assurance', 'Assurance valide jusqu’au'], ['Statut', 'Statut']] },
    staff: { desc: 'Gérez les chauffeurs et les collaborateurs.', button: 'Ajouter un employé', cols: [['Matricule', 'Matricule'], ['Nom', 'Nom complet'], ['Fonction', 'Fonction'], ['Téléphone', 'Téléphone'], ['Qualification', 'Permis / qualification'], ['Statut', 'Statut']] },
    maintenance: { desc: 'Planifiez les entretiens et conservez l’historique des réparations.', button: 'Nouvelle intervention', cols: [['Véhicule', 'Véhicule'], ['Intervention', 'Type d’intervention'], ['Description', 'Description'], ['Prestataire', 'Prestataire'], ['Date', 'Date'], ['Coût', (d) => money(d['Coût (FCFA)'])]] },
    invoices: { desc: 'Créez, imprimez et archivez les factures de RAHA TRANSPORT.', button: 'Créer une facture', cols: [['N° facture', 'Numéro de facture'], ['Client', 'Client'], ['Date', 'Date'], ['Désignation', 'Désignation'], ['Total TTC', (d, r) => money(r.computed && r.computed.totalTTC)], ['Échéance', 'Échéance'], ['Statut', 'Statut']] },
    finance: { desc: 'Enregistrez les mouvements et suivez la trésorerie.', button: 'Nouveau mouvement', cols: [['Type', 'Type (Recette/Dépense)'], ['Libellé', 'Libellé'], ['Catégorie', 'Catégorie'], ['Montant', (d) => money(d['Montant (FCFA)'])], ['Paiement', 'Mode de paiement'], ['Date', 'Date']] },
    documents: { desc: 'Référencez et classez les pièces administratives et opérationnelles.', button: 'Ajouter un document', cols: [['Référence', 'Référence'], ['Intitulé', 'Intitulé'], ['Catégorie', 'Catégorie'], ['Dossier lié', 'Dossier lié'], ['Date', 'Date du document'], ['Expiration', 'Date d’expiration']] },
  };
  const PAGE = 50;

  const $ = (id) => document.getElementById(id);
  const view = () => $('view');
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  const state = { me: null, perms: new Set(), defs: {}, page: 'dashboard', list: { q: '', offset: 0 }, rows: [] };
  const can = (res, action = 'read') => state.perms.has(`${res}:${action}`);

  // ---------------- API ----------------
  class ApiError extends Error { constructor(status, body) { super((body && body.message) || `Erreur ${status}`); this.status = status; this.body = body || {}; } }
  async function api(method, url, body) {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET' && state.me) headers['x-csrf-token'] = state.me.csrfToken;
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401 && state.me && state.me.state === 'active' && !url.startsWith('/api/auth/')) { showLogin('Votre session a expiré. Reconnectez-vous.'); }
      throw new ApiError(res.status, data);
    }
    return data;
  }
  function errorBox(e) {
    const details = e.body && Array.isArray(e.body.details) ? `<ul>${e.body.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '';
    return `<div class="err">${esc(e.message)}${details}</div>`;
  }

  // ---------------- Connexion / MFA ----------------
  function showLogin(msg) {
    state.me = null;
    $('app').classList.add('hidden');
    $('modalbg').style.display = 'none';
    $('loginbg').classList.remove('hidden');
    ['mfaform', 'enroll', 'recovery'].forEach((id) => $(id).classList.add('hidden'));
    $('loginform').classList.remove('hidden');
    $('loginform').reset();
    $('loginerr').innerHTML = msg ? `<div class="err">${esc(msg)}</div>` : '';
  }
  async function afterAuth(me) {
    state.me = me;
    $('loginerr').innerHTML = '';
    $('loginform').classList.add('hidden');
    if (me.state === 'mfa_pending') { $('mfaform').classList.remove('hidden'); $('mfaform').code.focus(); return; }
    if (me.state === 'mfa_enroll') {
      const s = await api('POST', '/api/auth/mfa/setup');
      $('qrimg').src = 'data:image/svg+xml;base64,' + btoa(s.qrSvg);
      $('mfasecret').textContent = s.secret;
      $('enroll').classList.remove('hidden');
      return;
    }
    await enterApp();
  }
  async function enterApp() {
    $('loginbg').classList.add('hidden');
    $('app').classList.remove('hidden');
    state.perms = new Set(state.me.permissions);
    $('whoami').textContent = `${state.me.user.fullName} · ${state.me.user.roleLabel}`;
    // Navigation : on masque ce que le profil ne peut pas consulter (le serveur refuse de toute façon)
    document.querySelectorAll('.nav button[data-page]').forEach((b) => {
      const p = b.dataset.page;
      b.classList.toggle('hidden', !(p === 'dashboard' ? can('dashboard') : p === 'settings' ? can('settings') || can('users') || can('license') || can('audit') : can(p)));
    });
    try { const defs = await api('GET', '/api/modules'); state.defs = Object.fromEntries(defs.map((d) => [d.key, d])); } catch { state.defs = {}; }
    go('dashboard');
  }

  $('loginform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try { await afterAuth(await api('POST', '/api/auth/login', { email: f.email.value.trim(), password: f.password.value })); }
    catch (err) { $('loginerr').innerHTML = errorBox(err); f.password.value = ''; }
  });
  $('mfaform').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { state.me = await api('POST', '/api/auth/mfa/verify', { code: e.target.code.value.trim() }); await enterApp(); }
    catch (err) { $('loginerr').innerHTML = errorBox(err); e.target.code.value = ''; if (err.status === 401 && err.body.code !== 'mfa_invalide') showLogin(err.message); }
  });
  $('enrollform').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', '/api/auth/mfa/enable', { code: e.target.code.value.trim() });
      state.me = r;
      $('enroll').classList.add('hidden');
      $('codes').innerHTML = r.recoveryCodes.map((c) => `<span>${esc(c)}</span>`).join('');
      $('recovery').classList.remove('hidden');
    } catch (err) { $('loginerr').innerHTML = errorBox(err); }
  });

  // ---------------- Navigation ----------------
  function go(page) {
    state.page = page;
    state.list = { q: '', offset: 0 };
    document.querySelectorAll('.nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
    $('crumb').textContent = titles[page];
    const r = page === 'dashboard' ? dashboard() : page === 'reports' ? reports() : page === 'settings' ? settings() : renderModule(page);
    Promise.resolve(r).catch((e) => { view().innerHTML = errorBox(e); });
  }
  $('nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-page]'); if (b) go(b.dataset.page); });

  // ---------------- Tableau de bord ----------------
  async function dashboard() {
    view().innerHTML = '<div class="empty">Chargement…</div>';
    const d = await api('GET', '/api/dashboard');
    const count = (k) => d.counts[k] || 0;
    const lic = state.me.license || {};
    const licNotice = lic.state && !['valid', 'unconfigured'].includes(lic.state) ? `<div class="notice">Licence : ${esc(lic.state)}${lic.reason ? ` (${esc(lic.reason)})` : ''}. ${lic.enforcement === 'enforce' && !['valid', 'grace'].includes(lic.state) ? 'Le logiciel est en consultation seule.' : ''}</div>` : '';
    view().innerHTML = `${licNotice}<div class="heading"><div><h1>Tableau de bord</h1><p>Vue synthétique des activités de RAHA TRANSPORT.</p></div>${can('transport', 'create') ? '<button class="btn" data-go="transport" data-open="1">+ Nouvelle mission</button>' : ''}</div><div class="cards"><div class="card"><small>Missions enregistrées</small><div class="metric">${count('transport')}</div><div class="delta">Transport</div></div><div class="card"><small>Dossiers de transit</small><div class="metric">${count('transit')}</div><div class="delta">Transit & douane</div></div><div class="card"><small>Factures créées</small><div class="metric">${count('invoices')}</div><div class="delta">Facturation</div></div><div class="card"><small>Contacts enregistrés</small><div class="metric">${count('clients')}</div><div class="delta">Clients & fournisseurs</div></div></div><div class="grid2"><div class="panel"><h3>Activité opérationnelle</h3><div class="bars">${[['Transport', count('transport')], ['Transit', count('transit')], ['Import/Export', count('importexport')], ['Factures', count('invoices')], ['Véhicules', count('fleet')]].map(([n, v]) => `<div class="barcol"><div class="bar" style="height:${Math.max(5, Math.min(120, v * 18))}px"></div>${n}<br>${v}</div>`).join('')}</div><p style="color:var(--muted);font-size:11px">Les indicateurs se mettent à jour à partir des données saisies dans les modules.</p></div><div class="panel"><h3>Accès rapide</h3><div class="quick">${[['invoices', 'Créer une facture'], ['transit', 'Ouvrir un dossier transit'], ['fleet', 'Ajouter un véhicule'], ['clients', 'Enregistrer un client']].filter(([k]) => can(k, 'create')).map(([k, l]) => `<button data-go="${k}" data-open="1">${l}</button>`).join('')}</div><div class="notice" style="margin-top:18px">Les données sont enregistrées sur le serveur central RTMS (PostgreSQL), partagées entre les postes et soumises aux droits de chaque profil.</div></div></div><div class="foot">RAHA TRANSPORT MANAGEMENT SYSTEM · Version 2.0</div>`;
  }

  // ---------------- Modules ----------------
  async function renderModule(key) {
    const c = configs[key];
    view().innerHTML = `<div class="heading"><div><h1>${titles[key]}</h1><p>${c.desc}</p></div>${can(key, 'create') ? `<button class="btn" data-action="new">+ ${c.button}</button>` : ''}</div>${key === 'invoices' ? '<div class="notice">Le modèle graphique exact de la facture RAHA devra être calqué sur la facture originale fournie et validé avant impression officielle.</div>' : ''}<div id="listerr"></div><div class="toolbar"><input id="search" placeholder="Rechercher dans les enregistrements…" maxlength="100">${can(key, 'export') ? '<button class="btn secondary" data-action="export">Exporter CSV</button>' : ''}</div><div class="tablewrap"><table><thead><tr>${c.cols.map(([h]) => `<th>${esc(h)}</th>`).join('')}<th>Action</th></tr></thead><tbody id="tbody"><tr><td colspan="${c.cols.length + 1}" class="empty">Chargement…</td></tr></tbody></table></div><div class="foot" id="listfoot"></div>`;
    let t;
    $('search').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.list = { q: e.target.value, offset: 0 }; loadRows(key); }, 250); });
    await loadRows(key);
  }

  async function loadRows(key) {
    const { q, offset } = state.list;
    const r = await api('GET', `/api/records/${key}?limit=${PAGE}&offset=${offset}&q=${encodeURIComponent(q)}`);
    state.rows = r.items;
    $('tbody').innerHTML = tableRows(key, r.items);
    const from = r.total ? offset + 1 : 0, to = Math.min(offset + PAGE, r.total);
    $('listfoot').innerHTML = `<div class="pager"><span>${r.total} enregistrement(s)${r.total > PAGE ? ` · ${from}–${to}` : ''}</span>${offset > 0 ? '<button class="btn secondary" data-action="prev">‹ Précédent</button>' : ''}${to < r.total ? '<button class="btn secondary" data-action="next">Suivant ›</button>' : ''}</div>`;
    $('listfoot').dataset.total = r.total;
  }

  function tableRows(key, rows) {
    const c = configs[key];
    if (!rows.length) return `<tr><td colspan="${c.cols.length + 1}" class="empty">${state.list.q ? 'Aucun résultat pour cette recherche.' : `Aucun enregistrement. ${can(key, 'create') ? `Cliquez sur « ${esc(c.button)} » pour commencer.` : ''}`}</td></tr>`;
    return rows.map((r) => {
      const cells = c.cols.map(([h, acc]) => {
        const v = typeof acc === 'function' ? acc(r.data, r) : r.data[acc];
        const shown = v === undefined || v === null || v === '' ? '—' : v;
        return /statut/i.test(h) ? `<td><span class="pill">${esc(shown)}</span></td>` : `<td>${esc(shown)}</td>`;
      }).join('');
      const action = can(key, 'cancel') ? `<button class="btn secondary" style="padding:5px 9px" data-action="remove" data-id="${esc(r.id)}">Supprimer</button>` : '';
      return `<tr>${cells}<td>${action}</td></tr>`;
    }).join('');
  }

  // Formulaire construit à partir des définitions du serveur (types, listes, champs obligatoires)
  function openModal(key) {
    const c = configs[key];
    const def = state.defs[key];
    if (!def) { alert('Définitions indisponibles. Rechargez la page.'); return; }
    $('modtitle').textContent = c.button;
    $('moderr').innerHTML = '';
    $('formfields').innerHTML = def.fields.map((f, i) => {
      const reqd = f.required ? 'required' : '';
      const label = `${esc(f.name)}${f.required ? '' : '<span class="opt">(facultatif)</span>'}`;
      let input;
      if (f.type === 'enum') input = `<select name="${esc(f.name)}" ${reqd}>${f.required ? '' : '<option value=""></option>'}${f.options.map((o) => `<option>${esc(o)}</option>`).join('')}</select>`;
      else if (f.type === 'date') input = `<input name="${esc(f.name)}" type="date" ${reqd}>`;
      else if (f.type === 'number') input = `<input name="${esc(f.name)}" type="number" step="any" ${f.min !== undefined && f.min !== null ? `min="${f.min}"` : ''} ${f.max !== undefined && f.max !== null ? `max="${f.max}"` : ''} ${reqd}>`;
      else input = `<input name="${esc(f.name)}" maxlength="${f.type === 'longtext' ? 4000 : 500}" ${reqd}>`;
      return `<label class="${i === 0 || f.type === 'longtext' ? 'wide' : ''}">${label}${input}</label>`;
    }).join('');
    $('recordform').dataset.key = key;
    $('modalbg').style.display = 'flex';
    const first = $('formfields').querySelector('input,select');
    if (first) first.focus();
  }
  function closeModal() { $('modalbg').style.display = 'none'; }

  $('recordform').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    if (!form.reportValidity()) return;
    const key = form.dataset.key;
    const data = {};
    for (const [k, v] of new FormData(form).entries()) if (String(v).trim() !== '') data[k] = String(v).trim();
    $('savebtn').disabled = true;
    try {
      await api('POST', `/api/records/${key}`, { data });
      closeModal();
      state.list.offset = 0;
      await loadRows(key);
    } catch (err) { $('moderr').innerHTML = errorBox(err); }
    finally { $('savebtn').disabled = false; }
  });

  async function removeRow(key, id) {
    const row = state.rows.find((r) => r.id === id);
    if (!row) return;
    const label = row.reference || Object.values(row.data)[1] || '';
    if (!confirm(`Supprimer cet enregistrement${label ? ` (${label})` : ''} ?\n\nIl sera retiré des listes ; l’opération est tracée dans le journal d’audit.`)) return;
    try { await api('POST', `/api/records/${key}/${encodeURIComponent(id)}/cancel`, { reason: 'Supprimé depuis la liste' }); await loadRows(key); }
    catch (err) { $('listerr').innerHTML = errorBox(err); }
  }

  async function exportCSV(key) {
    try {
      const res = await fetch(`/api/records/${key}/export.csv`, { credentials: 'same-origin' });
      if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
      const blob = await res.blob();
      if (Number($('listfoot').dataset.total || 0) === 0) { alert('Aucune donnée à exporter.'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `raha_${key}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) { $('listerr').innerHTML = errorBox(err); }
  }

  // ---------------- Rapports ----------------
  async function reports() {
    const s = await api('GET', '/api/reports/summary');
    const n = (k) => s.counts[k] || 0;
    view().innerHTML = `<div class="heading"><div><h1>Rapports & statistiques</h1><p>Indicateurs calculés par le serveur à partir des données enregistrées.</p></div><button class="btn secondary" data-action="print">Imprimer le rapport</button></div><div class="cards"><div class="card"><small>Recettes enregistrées</small><div class="metric">${money(s.finance.recettes)} F</div></div><div class="card"><small>Dépenses enregistrées</small><div class="metric">${money(s.finance.depenses)} F</div></div><div class="card"><small>Solde net enregistré</small><div class="metric">${money(s.finance.solde)} F</div></div><div class="card"><small>Opérations transport</small><div class="metric">${n('transport')}</div></div></div><div class="panel"><h3>Volumes par activité</h3>${Object.entries({ Transport: 'transport', Transit: 'transit', 'Import / Export': 'importexport', Commerce: 'commerce', Facturation: 'invoices', Véhicules: 'fleet' }).map(([l, k]) => `<p style="display:flex;justify-content:space-between;border-bottom:1px solid var(--line);padding:9px 0"><span>${l}</span><strong>${n(k)}</strong></p>`).join('')}</div><div class="foot">Calculé le ${esc(new Date(s.generatedAt).toLocaleString('fr-FR'))}</div>`;
  }

  // ---------------- Paramètres & administration ----------------
  async function settings() {
    const blocks = [];
    if (can('settings')) {
      const s = await api('GET', '/api/admin/settings');
      const sel = (name, opts, v) => `<select name="${name}">${opts.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
      blocks.push(`<div class="panel"><h3>Informations de l'entreprise</h3><div id="seterr"></div><form id="setform" class="form"><label class="wide">Raison sociale<input name="name" value="${esc(s.name)}" required maxlength="200"></label><label>Téléphone<input name="phone" value="${esc(s.phone || '')}" placeholder="Téléphone de l'entreprise" maxlength="60"></label><label>E-mail<input name="email" type="email" value="${esc(s.email || '')}" placeholder="Adresse e-mail" maxlength="200"></label><label class="wide">Adresse<input name="address" value="${esc(s.address || '')}" placeholder="Adresse du siège" maxlength="300"></label><label>Devise principale${sel('currency', ['FCFA', 'EUR', 'USD'], s.currency)}</label><label>Langue${sel('language', ['Français', 'English'], s.language)}</label></form><div class="actions">${can('settings', 'admin') ? '<button class="btn" data-action="save-settings">Enregistrer les paramètres</button>' : ''}</div></div>`);
    }
    if (can('license')) {
      const l = await api('GET', '/api/admin/license');
      blocks.push(`<div class="panel"><h3>Licence</h3><div id="licmsg"></div><p>État : <span class="pill ${['valid'].includes(l.state) ? '' : 'orange'}">${esc(l.state)}</span> ${l.reason ? `<span style="color:var(--muted)">${esc(l.reason)}</span>` : ''}</p>${l.customer ? `<p>Titulaire : ${esc(l.customer)} · Offre : ${esc(l.plan)} · Jusqu’au ${esc(new Date(l.expiresAt).toLocaleDateString('fr-FR'))} · ${esc(l.maxUsers)} utilisateurs</p>` : ''}<p style="color:var(--muted);font-size:12px">Identifiant d’installation : <code>${esc(l.installationId || '—')}</code></p>${can('license', 'admin') ? '<form id="licform" class="form"><label class="wide">Clé de licence<input name="licenseKey" placeholder="RTMS-XXXXX-XXXXX-XXXXX-XXXXX" maxlength="64"></label></form><div class="actions"><button class="btn" data-action="activate-license">Activer</button></div>' : ''}</div>`);
    }
    if (can('users')) {
      const users = await api('GET', '/api/admin/users');
      const roles = (await api('GET', '/api/admin/permissions')).roles;
      blocks.push(`<div class="panel"><h3>Utilisateurs</h3><div id="usermsg"></div><div class="tablewrap"><table><thead><tr><th>Nom</th><th>E-mail</th><th>Profil</th><th>MFA</th><th>État</th><th>Dernière connexion</th></tr></thead><tbody>${users.map((u) => `<tr><td>${esc(u.fullName)}</td><td>${esc(u.email)}</td><td>${esc(roles[u.roleKey] || u.roleKey)}</td><td>${u.mfaEnabled ? 'Activée' : '—'}</td><td><span class="pill ${u.status === 'active' ? '' : 'gray'}">${u.status === 'active' ? 'Actif' : 'Désactivé'}</span></td><td>${u.lastLoginAt ? esc(new Date(u.lastLoginAt).toLocaleString('fr-FR')) : '—'}</td></tr>`).join('')}</tbody></table></div>${can('users', 'admin') ? `<form id="userform" class="form" style="margin-top:14px"><label>Nom complet<input name="fullName" required maxlength="120"></label><label>E-mail<input name="email" type="email" required maxlength="200"></label><label>Profil<select name="roleKey">${Object.entries(roles).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('')}</select></label></form><div class="actions"><button class="btn" data-action="add-user">Ajouter l’utilisateur</button></div>` : ''}</div>`);
    }
    if (can('audit')) {
      blocks.push(`<div class="panel"><h3>Journal d’audit</h3><div id="auditmsg"></div><div class="actions" style="justify-content:flex-start;margin:0 0 12px"><button class="btn secondary" data-action="verify-audit">Vérifier l’intégrité du journal</button><button class="btn secondary" data-action="load-audit">Afficher les 50 dernières opérations</button></div><div id="auditlist"></div></div>`);
    }
    const legacy = readLegacy();
    if (can('settings', 'admin') && legacy) {
      const n = Object.values(legacy).reduce((s, rows) => s + (Array.isArray(rows) ? rows.length : 0), 0);
      blocks.push(`<div class="panel"><h3>Données du prototype sur ce poste</h3><div id="importmsg"></div><p>${n} enregistrement(s) saisis dans l’ancienne version sont encore stockés dans ce navigateur. Vous pouvez les transférer sur le serveur ; un aperçu est fait d’abord, rien n’est effacé localement.</p><div class="actions" style="justify-content:flex-start"><button class="btn secondary" data-action="import-preview">Aperçu</button><button class="btn" data-action="import-run">Transférer sur le serveur</button></div></div>`);
    }
    blocks.push(`<div class="panel"><h3>Mon compte</h3><div id="pwdmsg"></div><form id="pwdform" class="form"><label>Mot de passe actuel<input name="current" type="password" autocomplete="current-password" required></label><label>Nouveau mot de passe (12 caractères min.)<input name="next" type="password" autocomplete="new-password" minlength="12" required></label></form><div class="actions"><button class="btn" data-action="change-password">Changer le mot de passe</button></div></div>`);
    view().innerHTML = `<div class="heading"><div><h1>Paramètres généraux</h1><p>Configuration de l'environnement RAHA TRANSPORT.</p></div></div><div class="stack">${blocks.join('')}</div>`;
  }

  function readLegacy() {
    try { const d = JSON.parse(localStorage.getItem('rtms_data') || 'null'); return d && typeof d === 'object' && Object.keys(d).length ? d : null; } catch { return null; }
  }
  const formObj = (id) => Object.fromEntries(new FormData($(id)).entries());
  const okBox = (m) => `<div class="ok">${esc(m)}</div>`;

  const actions = {
    'close-modal': closeModal,
    logout: async () => { try { await api('POST', '/api/auth/logout', {}); } catch { /* déjà déconnecté */ } showLogin(); },
    'enter-app': enterApp,
    new: () => openModal(state.page),
    export: () => exportCSV(state.page),
    remove: (b) => removeRow(state.page, b.dataset.id),
    prev: () => { state.list.offset = Math.max(0, state.list.offset - PAGE); loadRows(state.page); },
    next: () => { state.list.offset += PAGE; loadRows(state.page); },
    print: () => window.print(),
    'save-settings': async () => {
      try { await api('PUT', '/api/admin/settings', formObj('setform')); $('seterr').innerHTML = okBox('Paramètres enregistrés.'); } catch (e) { $('seterr').innerHTML = errorBox(e); }
    },
    'activate-license': async () => {
      try { const l = await api('POST', '/api/admin/license/activate', formObj('licform')); state.me.license = l; $('licmsg').innerHTML = okBox(`Licence activée (${l.state}).`); setTimeout(() => go('settings'), 800); } catch (e) { $('licmsg').innerHTML = errorBox(e); }
    },
    'add-user': async () => {
      if (!$('userform').reportValidity()) return;
      try { const r = await api('POST', '/api/admin/users', formObj('userform')); $('usermsg').innerHTML = `<div class="ok">Utilisateur créé. Mot de passe provisoire à transmettre en main propre : <code>${esc(r.temporaryPassword)}</code></div>`; } catch (e) { $('usermsg').innerHTML = errorBox(e); }
    },
    'verify-audit': async () => {
      try { const r = await api('GET', '/api/admin/audit/verify'); $('auditmsg').innerHTML = r.intact ? okBox('Journal intègre : aucune modification détectée.') : `<div class="err">Altération détectée à partir de l’entrée n° ${esc(r.firstBrokenId)}. Prévenez immédiatement l’administrateur.</div>`; } catch (e) { $('auditmsg').innerHTML = errorBox(e); }
    },
    'load-audit': async () => {
      try { const rows = await api('GET', '/api/admin/audit?limit=50'); $('auditlist').innerHTML = `<div class="tablewrap"><table><thead><tr><th>Date</th><th>Action</th><th>Objet</th><th>IP</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(new Date(r.at).toLocaleString('fr-FR'))}</td><td>${esc(r.action)}</td><td>${esc(r.entity)} ${esc(r.entityId || '')}</td><td>${esc(r.ip || '')}</td></tr>`).join('')}</tbody></table></div>`; } catch (e) { $('auditmsg').innerHTML = errorBox(e); }
    },
    'import-preview': () => runImport(true),
    'import-run': () => { if (confirm('Transférer les données de ce navigateur sur le serveur ?')) runImport(false); },
    'change-password': async () => {
      if (!$('pwdform').reportValidity()) return;
      try { await api('POST', '/api/auth/password', formObj('pwdform')); $('pwdform').reset(); $('pwdmsg').innerHTML = okBox('Mot de passe changé. Vos autres sessions ont été fermées.'); } catch (e) { $('pwdmsg').innerHTML = errorBox(e); }
    },
  };

  async function runImport(dryRun) {
    try {
      const r = await api('POST', '/api/admin/import-legacy', { data: readLegacy(), dryRun });
      const lines = r.report.map((m) => `<li>${esc(titles[m.module] || m.module)} : ${m.imported} ${dryRun ? 'à importer' : 'importé(s)'}, ${m.skipped} ignoré(s)${m.warnings.length ? `<ul>${m.warnings.slice(0, 20).map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}</li>`).join('');
      $('importmsg').innerHTML = `<div class="${dryRun ? 'notice' : 'ok'}">${dryRun ? 'Aperçu (rien n’a été enregistré)' : 'Transfert terminé'} :<ul>${lines}</ul></div>`;
    } catch (e) { $('importmsg').innerHTML = errorBox(e); }
  }

  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-go]');
    if (g) { go(g.dataset.go); if (g.dataset.open && can(g.dataset.go, 'create')) setTimeout(() => openModal(g.dataset.go), 50); return; }
    const b = e.target.closest('[data-action]');
    if (b && actions[b.dataset.action]) { e.preventDefault(); actions[b.dataset.action](b); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('modalbg').style.display === 'flex') closeModal(); });

  // ---------------- Démarrage ----------------
  api('GET', '/api/auth/me').then(afterAuth).catch(() => showLogin());
})();
