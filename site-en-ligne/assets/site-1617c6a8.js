// ITI – contenu dynamique du site public (articles, formations, coordonnées)
// Les contenus viennent de la base Supabase, modifiée depuis /admin.
// Tout le texte est inséré avec textContent : aucun HTML venant de la base n'est interprété.
(function () {
  "use strict";
  var SB = "https://msfsvcxmdkcfndosljgi.supabase.co";
  var KEY = "sb_publishable_tegfS9pClvpwA8_jc4lXKg_831uu8tV";
  var WA = "237687064161";

  // Menu mobile
  var btn = document.querySelector(".menu-btn"), nav = document.querySelector(".nav");
  if (btn && nav) btn.addEventListener("click", function () {
    var open = nav.classList.toggle("open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  var y = document.getElementById("annee"); if (y) y.textContent = new Date().getFullYear();

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  function safeUrl(u) { return /^(https?:\/\/|\/)/i.test(String(u || "").trim()) ? String(u).trim() : ""; }
  function img(src, alt) {
    var s = safeUrl(src); if (!s) return null;
    return el("img", { src: s, alt: alt || "", loading: "lazy", decoding: "async" });
  }
  function dateFr(d) {
    var t = new Date(d); if (isNaN(t)) return "";
    return t.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  var cache = null;
  function load() {
    if (cache) return cache;
    cache = fetch(SB + "/rest/v1/site_content?select=key,value&key=in.(articles,formations,contact)", {
      headers: { apikey: KEY, Authorization: "Bearer " + KEY }
    }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (rows) { var o = {}; rows.forEach(function (x) { o[x.key] = x.value; }); return o; });
    return cache;
  }
  function articles(d) {
    return (Array.isArray(d.articles) ? d.articles : []).slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  }

  // Carte d'article
  function articleCard(a) {
    return el("a", { class: "card", href: "/article/?id=" + encodeURIComponent(a.id) }, [
      img(a.image, "") ? el("div", { class: "img" }, [img(a.image, "")]) : null,
      el("div", { class: "body" }, [
        el("div", { class: "meta", text: [dateFr(a.date), a.category].filter(Boolean).join(" · ") }),
        el("h3", { text: a.title || "" }),
        el("p", { text: a.excerpt || "" }),
        el("span", { class: "more", text: "Lire l'article" })
      ])
    ]);
  }

  // Corps d'article : paragraphes, intertitres **…**, listes « - », boutons BTN:texte|lien
  function renderBody(text, box) {
    String(text || "").split(/\n\s*\n/).forEach(function (blk) {
      var b = blk.trim(); if (!b) return;
      if (/^BTN:/.test(b)) {
        var p = b.slice(4).split("|"), url = safeUrl(p[1]);
        if (url) box.appendChild(el("p", { class: "cta" }, [el("a", { class: "btn btn-primary", href: url, target: "_blank", rel: "noopener noreferrer", text: (p[0] || "En savoir plus").trim() })]));
        return;
      }
      if (/^VIDEO:/.test(b)) return;
      if (/^\*\*[^*]+\*\*$/.test(b)) { box.appendChild(el("h2", { text: b.replace(/\*\*/g, "") })); return; }
      var lines = b.split("\n");
      if (lines.every(function (l) { return /^- /.test(l.trim()); })) {
        box.appendChild(el("ul", null, lines.map(function (l) { return el("li", { text: l.trim().slice(2) }); })));
        return;
      }
      box.appendChild(el("p", { text: b.replace(/\*\*/g, "") }));
    });
  }

  // Fiche formation
  function course(f) {
    var left = el("div", null, [el("h3", { text: f.title || "" })]);
    if (f.audience) left.appendChild(el("p", { class: "muted", text: f.audience }));
    if (Array.isArray(f.objectives) && f.objectives.length) {
      left.appendChild(el("h4", { text: "Objectifs" }));
      left.appendChild(el("ul", null, f.objectives.map(function (x) { return el("li", { text: x }); })));
    }
    if (Array.isArray(f.skills) && f.skills.length) {
      left.appendChild(el("h4", { text: "Au programme" }));
      left.appendChild(el("ul", null, f.skills.map(function (x) { return el("li", { text: x }); })));
    }
    var poster = /affiche|formations\//.test(String(f.image || "")) ? img(f.image, "Affiche : " + (f.title || "")) : null;
    if (poster) { poster.className = "poster"; left.appendChild(poster); }
    var price = String(f.price || "").trim();
    if (/^\d+$/.test(price)) price = Number(price).toLocaleString("fr-FR") + " FCFA";
    var right = el("dl", null, [
      el("dt", { text: "Durée" }), el("dd", { text: f.duration || "Nous consulter" }),
      el("dt", { text: "Tarif" }), el("dd", { text: price || "Nous consulter" }),
      el("dt", { text: "Inscription" }),
      el("dd", null, [el("a", { class: "btn btn-primary", target: "_blank", rel: "noopener noreferrer",
        href: "https://wa.me/" + WA + "?text=" + encodeURIComponent("Bonjour ITI, je souhaite m'inscrire à la formation : " + (f.title || "")),
        text: "S'inscrire sur WhatsApp" })])
    ]);
    return el("article", { class: "course" }, [left, right]);
  }

  function fail(box, msg) { clear(box); box.appendChild(el("p", { class: "muted", text: msg })); }

  var latest = document.getElementById("dernieres-actualites");
  var list = document.getElementById("liste-actualites");
  var courses = document.getElementById("liste-formations");
  var art = document.getElementById("article");
  var info = document.getElementById("coordonnees");

  if (latest || list || courses || art || info) load().then(function (d) {
    var arts = articles(d);
    if (latest) { clear(latest); arts.slice(0, 3).forEach(function (a) { latest.appendChild(articleCard(a)); }); }
    if (list) { clear(list); if (!arts.length) fail(list, "Aucune actualité pour le moment."); arts.forEach(function (a) { list.appendChild(articleCard(a)); }); }
    if (courses) {
      clear(courses);
      var fs = Array.isArray(d.formations) ? d.formations : [];
      if (!fs.length) fail(courses, "Le calendrier des sessions est en cours de mise à jour. Contactez-nous.");
      fs.forEach(function (f) { courses.appendChild(course(f)); });
    }
    if (art) {
      var id = new URLSearchParams(location.search).get("id");
      var a = arts.filter(function (x) { return String(x.id) === String(id); })[0];
      clear(art);
      if (!a) { art.appendChild(el("h1", { text: "Article introuvable" })); art.appendChild(el("p", null, [el("a", { href: "/actualites/", text: "Voir toutes les actualités" })])); return; }
      document.title = a.title + " | ITI";
      var md = document.querySelector('meta[name="description"]'); if (md && a.excerpt) md.setAttribute("content", a.excerpt);
      art.appendChild(el("p", { class: "eyebrow", text: [a.category, dateFr(a.date)].filter(Boolean).join(" · ") }));
      art.appendChild(el("h1", { text: a.title }));
      if (a.author) art.appendChild(el("p", { class: "muted", text: "Par " + a.author }));
      var c = img(a.image, ""); if (c) art.appendChild(el("div", { class: "cover" }, [c]));
      renderBody(a.content, art);
      art.appendChild(el("p", null, [el("a", { href: "/actualites/", text: "Toutes les actualités" })]));
    }
    if (info && d.contact) {
      var map = { phone1: "tel1", phone2: "tel2", email: "mail", address: "adresse" };
      Object.keys(map).forEach(function (k) {
        var n = document.getElementById(map[k]); var v = d.contact[k];
        if (!n || !v) return;
        n.textContent = v;
        if (n.tagName === "A") n.setAttribute("href", k === "email" ? "mailto:" + v : "tel:" + String(v).replace(/[^+0-9]/g, ""));
      });
    }
  }).catch(function () {
    [latest, list, courses].forEach(function (b) { if (b) fail(b, "Le contenu n'a pas pu être chargé. Réessayez dans un instant ou écrivez-nous sur WhatsApp."); });
    if (art) fail(art, "L'article n'a pas pu être chargé. Réessayez dans un instant.");
  });

  // Formulaire de contact : enregistré dans la base (vérifié côté serveur), puis repli WhatsApp
  var form = document.getElementById("form-contact");
  if (form) form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var note = document.getElementById("form-note"), b = form.querySelector("button");
    var v = function (n) { return (form.elements[n].value || "").trim(); };
    var msg = { name: v("name"), email: v("email"), phone: v("phone"), subject: v("subject"), message: v("message") };
    note.className = "notice";
    if (msg.name.length < 2 || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(msg.email) || msg.message.length < 3) {
      note.className = "notice err"; note.textContent = "Merci d'indiquer votre nom, une adresse e-mail valide et votre message."; return;
    }
    b.disabled = true; b.textContent = "Envoi…";
    fetch(SB + "/rest/v1/rpc/iti_add_contact_message", {
      method: "POST", headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ p_message: msg })
    }).then(function (r) { return r.ok ? r.json() : false; }).catch(function () { return false; })
      .then(function (ok) {
        b.disabled = false; b.textContent = "Envoyer le message";
        if (ok === true) { form.reset(); note.className = "notice ok"; note.textContent = "Message bien reçu. Nous vous répondons sous 24 h ouvrées."; return; }
        note.className = "notice err";
        note.textContent = "L'envoi n'a pas abouti. Vous pouvez nous écrire directement sur WhatsApp : ";
        note.appendChild(el("a", { href: "https://wa.me/" + WA + "?text=" + encodeURIComponent("Bonjour ITI, je suis " + msg.name + ". " + msg.message), target: "_blank", rel: "noopener noreferrer", text: "ouvrir WhatsApp" }));
      });
  });
})();
