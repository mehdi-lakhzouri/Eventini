import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * La justification d'un changement de statut.
 *
 * Facultative, et volontairement : l'exiger produirait des « raison » remplies
 * de « x » pour passer la validation, ce qui vaut moins qu'un champ vide et
 * honnête. Quand elle est fournie, elle atterrit dans `audit_logs.reason`, où
 * un auditeur la lira.
 */
export class MembershipStatusChangeDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
