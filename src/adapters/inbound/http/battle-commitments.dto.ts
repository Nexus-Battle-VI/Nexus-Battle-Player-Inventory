import { IsDateString, IsString, IsUUID, MaxLength, MinLength } from 'class-validator'

/**
 * Cuerpo de `POST /api/internal/v1/inventory/heroes/:heroId/battle-commitments`.
 *
 * NO lleva `purpose`: la ruta ya dice que es un compromiso de BATTLE, y repetirlo
 * en el cuerpo daria dos sitios donde equivocarse.
 *
 * `operationId` ES UUID, como en el compromiso de mision y en las entregas de
 * HU-22: el `operationId` de un servicio interno es una clave tecnica, no un
 * texto libre, y aceptar texto libre invitaria a claves no reproducibles.
 */
export class CreateBattleCommitmentRequest {
  @IsUUID()
  operationId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  playerId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  reference!: string

  @IsDateString()
  expiresAt!: string
}
