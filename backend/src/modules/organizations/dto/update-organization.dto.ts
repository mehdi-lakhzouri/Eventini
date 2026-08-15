import { IsOptional, IsString, Length, Matches } from 'class-validator';

/**
 * Ce qu'un administrateur d'organisation peut changer — EVT-042.
 *
 * ## Ce qui n'y figure pas, et pourquoi
 *
 * `status`, `isEnabled`, `licensePlan`, `userLimit` et `eventLimit` sont des
 * attributs **plateforme** : ils décident si l'organisation est active, jusqu'où
 * elle peut croître et ce qu'elle paie. Seul `platform.organizations.manage`
 * les modifie.
 *
 * Ils ne sont pas « ignorés » : `forbidNonWhitelisted` fait échouer la requête
 * en `400`. La différence compte — ignorer silencieusement laisserait un
 * administrateur croire qu'il vient de relever sa limite d'utilisateurs, et
 * découvrir le contraire au pire moment.
 */
export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  /**
   * Le slug, modifiable — décision produit du 14 août 2026.
   *
   * 🔴 Le changer casse tout lien portant l'ancien : URL partagées, signets,
   * liens d'invitation déjà envoyés. Aucune redirection n'est conservée, faute
   * de table d'historique — et le sprint 08 est documenté « Migrations :
   * aucune ». À reconsidérer si le renommage devient courant.
   *
   * Le format est contraint parce qu'un slug finit dans une URL : minuscules,
   * chiffres et tirets, jamais de tiret en tête ou en fin, jamais deux
   * consécutifs. Un slug de trois caractères minimum évite les collisions avec
   * les segments réservés ci-dessous.
   */
  @IsOptional()
  @IsString()
  @Length(3, 63)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'slug must contain only lowercase letters, digits and single hyphens, and must not start or end with one',
  })
  @Matches(RESERVED_SLUG_PATTERN(), {
    message: 'slug is reserved',
  })
  slug?: string;
}

/**
 * Les segments qu'un slug ne peut pas prendre.
 *
 * Sans cette liste, une organisation nommée `api` ou `admin` rendrait
 * ambiguë toute URL de la forme `/{slug}/…` le jour où le produit en aura —
 * et l'ambiguïté se résoudrait en faveur de l'organisation, ce qui en fait
 * une prise de contrôle de chemin plutôt qu'un simple conflit.
 *
 * Exprimée en négatif dans une expression régulière parce que `class-validator`
 * n'offre pas de « n'est pas dans cette liste » sans décorateur maison.
 */
function RESERVED_SLUG_PATTERN(): RegExp {
  const reserved = [
    'api',
    'admin',
    'auth',
    'login',
    'logout',
    'new',
    'settings',
    'organizations',
    'events',
    'health',
    'metrics',
    'static',
    'assets',
    'public',
    'www',
  ];

  return new RegExp(`^(?!(?:${reserved.join('|')})$).+`);
}
