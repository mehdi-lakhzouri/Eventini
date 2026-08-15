import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsString,
  Length,
} from 'class-validator';

export class ReplaceMemberRolesDto {
  /**
   * L'ensemble **voulu** des codes de rôle, pas un delta.
   *
   * Un tableau vide est valide et signifie « retirer tous les rôles » : c'est
   * un état légitime — un membre présent sans droits, le temps d'une décision
   * — et le refuser obligerait à passer par la révocation du membership, qui
   * a de tout autres conséquences.
   *
   * `ArrayUnique` évite qu'un doublon fasse échouer l'insertion sur l'index
   * partiel `ux_membership_role_active` avec une erreur de base plutôt qu'un
   * message de validation.
   *
   * Le plafond de dix n'est pas une limite métier : le catalogue en compte six
   * dont un seul est `PLATFORM`. Il borne simplement ce qu'une requête peut
   * demander de résoudre.
   */
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(2, 64, { each: true })
  roleCodes!: string[];
}
