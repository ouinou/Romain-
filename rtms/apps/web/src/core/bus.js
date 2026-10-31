// Bus d'événements de l'application (changement d'onglet, de sélection, de données...).
const target = new EventTarget();
export const emit = (name, detail) => target.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => {
  const h = (e) => fn(e.detail);
  target.addEventListener(name, h);
  return () => target.removeEventListener(name, h);
};
