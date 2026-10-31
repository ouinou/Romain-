// État de la session courante. Les permissions servent à adapter l'interface ;
// la décision réelle reste au serveur.
export const session = { me: null, perms: new Set(), defs: {} };
export const can = (res, action = 'read') => session.perms.has(`${res}:${action}`);
export const userKey = () => (session.me ? session.me.user.id : 'anonyme');
