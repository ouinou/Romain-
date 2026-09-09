/**
 * AFRITRADE CONNECT — comportements partagés (démo statique).
 * Menu mobile, onglets, icônes Lucide, révélation légère au scroll.
 */
document.addEventListener("DOMContentLoaded", () => {
  // Icônes Lucide
  if (window.lucide) {
    lucide.createIcons();
  }

  // Menu mobile latéral
  const menu = document.querySelector("[data-mobile-menu]");
  const openBtn = document.querySelector("[data-menu-open]");
  const closeBtn = document.querySelector("[data-menu-close]");
  const backdrop = menu ? menu.querySelector(".mobile-menu__backdrop") : null;

  const toggleMenu = (open) => {
    if (!menu) return;
    menu.classList.toggle("is-open", open);
    document.body.style.overflow = open ? "hidden" : "";
  };
  if (openBtn) openBtn.addEventListener("click", () => toggleMenu(true));
  if (closeBtn) closeBtn.addEventListener("click", () => toggleMenu(false));
  if (backdrop) backdrop.addEventListener("click", () => toggleMenu(false));

  // Marquer le lien de nav actif selon la page courante
  const current = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll("[data-nav-link]").forEach((link) => {
    if (link.getAttribute("href") === current) link.classList.add("is-active");
  });

  // Système d'onglets générique : data-tabs / data-tab / data-tab-panel
  document.querySelectorAll("[data-tabs]").forEach((tabGroup) => {
    const buttons = tabGroup.querySelectorAll("[data-tab]");
    const panels = document.querySelectorAll(`[data-tab-panel][data-tabs-target="${tabGroup.dataset.tabs}"]`);
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.classList.remove("is-active"));
        panels.forEach((p) => p.setAttribute("hidden", ""));
        btn.classList.add("is-active");
        const target = document.querySelector(
          `[data-tab-panel="${btn.dataset.tab}"][data-tabs-target="${tabGroup.dataset.tabs}"]`
        );
        if (target) target.removeAttribute("hidden");
      });
    });
  });

  // Révélation douce au scroll (amélioration progressive : le contenu est
  // visible par défaut en CSS, on ne le masque qu'ici, juste avant de
  // l'observer, pour ne jamais laisser un visiteur sans JS ou un
  // chargement lent avec du contenu invisible).
  const reveals = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window && reveals.length) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.remove("reveal-pending");
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -80px 0px" }
    );
    reveals.forEach((el) => {
      el.classList.add("reveal-pending");
      io.observe(el);
    });
  }

  // Démo : messagerie — sélection d'une conversation
  document.querySelectorAll("[data-thread-item]").forEach((item) => {
    item.addEventListener("click", () => {
      document.querySelectorAll("[data-thread-item]").forEach((i) => i.classList.remove("is-active"));
      item.classList.add("is-active");
    });
  });
});
