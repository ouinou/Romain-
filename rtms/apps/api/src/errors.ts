export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'requete_invalide', msg, details);
export const unauthorized = (msg = 'Authentification requise') => new HttpError(401, 'non_authentifie', msg);
export const forbidden = (msg = 'Action non autorisée pour votre profil') => new HttpError(403, 'interdit', msg);
export const notFound = (msg = 'Introuvable') => new HttpError(404, 'introuvable', msg);
export const conflict = (msg: string, details?: unknown) => new HttpError(409, 'conflit', msg, details);
