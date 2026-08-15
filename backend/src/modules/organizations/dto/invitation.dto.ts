import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateInvitationDto {
  /**
   * Pas de `@IsEmail`, volontairement.
   *
   * Le même choix que `LoginRequestDto` : une adresse malformée doit échouer
   * comme une adresse inconnue, pas comme une erreur de validation. Ici la
   * raison diffère — la réponse est identique dans les deux cas de toute
   * façon — mais la cohérence de traitement compte, et `@IsEmail` rejette des
   * adresses valides selon la RFC que des utilisateurs réels possèdent.
   */
  @IsString()
  @Length(3, 320)
  email!: string;

  /**
   * Le code du rôle, jamais son identifiant.
   *
   * Un identifiant obligerait le client à connaître les clés primaires du
   * catalogue ; un code est stable, lisible en revue, et le use case vérifie
   * qu'il désigne bien un rôle de portée `ORGANIZATION`.
   */
  @IsString()
  @Length(2, 64)
  roleCode!: string;
}

export class AcceptInvitationDto {
  @IsString()
  @Length(16, 256)
  token!: string;

  /**
   * Requis seulement quand l'adresse n'a pas encore de compte.
   *
   * Le use case tranche : l'exiger toujours obligerait un utilisateur existant
   * à ressaisir son mot de passe pour rejoindre une organisation, et l'exiger
   * jamais laisserait un compte sans moyen de connexion.
   *
   * Les bornes reprennent la politique d'ADR-0007 (12 à 128). Le backend la
   * revalide à l'écriture ; ce contrôle-ci évite un aller-retour Argon2id sur
   * une valeur qui sera refusée.
   */
  @IsOptional()
  @IsString()
  @Length(12, 128)
  @MaxLength(128)
  password?: string;
}
