// État de la session courante. Les permissions servent à adapter l'interface ;
// la décision réelle reste au serveur.
export const session = { me: null, perms: new Set(), defs: {} };
export const can = (res, action = 'read') => session.perms.has(`${res}:${action}`);
export const userKey = () => (session.me ? session.me.user.id : 'anonyme');

/**
 * Réglages de la société utiles à l'interface. Le commerce général est masqué tant qu'il n'est pas
 * activé dans Paramètres : c'est un choix d'affichage (les droits réels restent ceux du serveur).
 */
export function applyCompany(me) {
  session.company = me.company || { commerceEnabled: false, trackerName: '', trackerUrl: '' };
  session.perms = new Set(me.permissions.filter((p) => session.company.commerceEnabled || !p.startsWith('commerce:')));
}
