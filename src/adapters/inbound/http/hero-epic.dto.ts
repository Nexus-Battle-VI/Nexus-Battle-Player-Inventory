import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsString, Length } from 'class-validator'

/**
 * Cuerpo de `PUT /api/inventories/me/heroes/:heroId/epic` (HU-31, contrato
 * `hu-31-equipped-epic-v1` §11).
 *
 * Solo la referencia del producto: el heroe viaja en la URL. NO se acepta
 * `ownerId` -la identidad sale del testimonio- ni los efectos de la epica:
 * la definicion canonica la resuelve el backend contra Catalog, nunca el
 * cliente.
 */
export class EquipEpicRequest {
  @ApiProperty({
    description: 'productId (UUID) o alias sku de la epica propia a equipar.',
    example: 'golpe-de-defensa',
  })
  @IsString()
  @Length(1, 128)
  productReference!: string
}

class EquippedHeroEpicAppliedResponse {
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  readonly baseApplied!: Record<string, unknown> | null

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  readonly additionalApplied!: Record<string, unknown> | null
}

class EquippedHeroEpicResponse {
  @ApiProperty({ format: 'uuid' })
  readonly epicProductId!: string

  @ApiProperty({ example: 'golpe-de-defensa' })
  readonly epicReference!: string

  @ApiProperty()
  readonly name!: string

  @ApiProperty({ example: 'GUERRERO_TANQUE' })
  readonly compatibleHeroSubtype!: string

  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true })
  readonly baseEffect!: Record<string, unknown> | null

  @ApiProperty({ type: 'object', additionalProperties: true })
  readonly specificEffect!: Record<string, unknown>

  @ApiProperty({ type: EquippedHeroEpicAppliedResponse })
  readonly applied!: EquippedHeroEpicAppliedResponse
}

/** Respuesta de `GET/PUT /api/inventories/me/heroes/:heroId/epic`. */
export class HeroEpicResponse {
  @ApiProperty({ format: 'uuid' })
  readonly heroId!: string

  @ApiPropertyOptional({ type: EquippedHeroEpicResponse, nullable: true })
  readonly epic!: EquippedHeroEpicResponse | null

  @ApiProperty({ example: 0 })
  readonly version!: number

  @ApiProperty()
  readonly locked!: boolean
}
