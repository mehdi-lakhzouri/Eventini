import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_BYTES = 32;

export interface InvitationTokenPair {
  /** Part dans le lien d'invitation, une seule fois. Jamais stocké. */
  readonly token: string;
  readonly tokenHash: string;
}

/**
 * HMAC-SHA-256 avec le secret d'invitation dédié, et non un condensat nu.
 *
 * Le commentaire de colonne du schéma dit « SHA-256 » ; `INVITATION_TOKEN_SECRET`
 * existe pourtant dans l'environnement depuis EVT-008, et §9 du corpus range
 * l'invitation parmi les sept secrets indépendants. La même tension a été
 * tranchée de la même façon pour la réinitialisation de mot de passe, et pour
 * la même raison : un condensat nu rend une base volée directement
 * exploitable — il suffit d'y lire un `token_hash` et d'en dériver rien du
 * tout, mais surtout de comparer contre un dictionnaire de jetons précalculés.
 * Une clé rend l'empreinte inutilisable hors du serveur qui la détient.
 */
export function hashInvitationToken(token: string, secret: string): string {
  return createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(token, 'utf8')
    .digest('hex');
}

export function issueInvitationToken(secret: string): InvitationTokenPair {
  // 32 octets, base64url : sûr dans une URL sans encodage, et hors de portée
  // d'un forçage même avec la limite de 10 tentatives par heure levée.
  const token = randomBytes(TOKEN_BYTES).toString('base64url');

  return { token, tokenHash: hashInvitationToken(token, secret) };
}

/**
 * Comparaison à temps constant.
 *
 * L'égalité de chaînes s'arrête au premier octet différent : le temps de
 * réponse révèle alors combien de préfixe est correct, ce qui transforme un
 * espace de 2^256 en une recherche octet par octet. La limite de débit ne
 * suffit pas à couvrir cela — elle ralentit l'attaque, elle ne la referme pas.
 */
export function invitationTokenMatches(
  token: string,
  expectedHash: string,
  secret: string,
): boolean {
  const actual = Buffer.from(hashInvitationToken(token, secret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
