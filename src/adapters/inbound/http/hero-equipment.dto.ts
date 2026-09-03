import { ApiProperty } from '@nestjs/swagger'
import { IsString, Length } from 'class-validator'

const EQUIPMENT_SLOTS = [
  'WEAPON_1',
  'WEAPON_2',
  'HELMET',
  'CHEST',
  'GLOVES',
  'BRACERS',
  'PANTS',
  'SHOES',
  'ITEM_1',
  'ITEM_2',
] as const

/**
 * Cuerpo de `PUT /api/inventories/me/heroes/:heroId/equipment/:slot`.
 *
 * Solo la referencia del producto: la ranura viaja en la URL y el heroe
 * tambien. NO se acepta `ownerId` —la identidad sale del testimonio— ni un
 * `heroId` en el cuerpo, para que no exista un identificador manipulable.
 */
export class EquipItemRequest {
  @ApiProperty({
    description: 'productId (UUID) o alias sku del producto propio a equipar.',
    example: 'espada-de-fuego',
  })
  @IsString()
  @Length(1, 128)
  productReference!: string
}

class MagnitudeResponse {
  @ApiProperty({ enum: ['FIXED', 'PERCENTAGE', 'DICE'] })
  readonly mode!: string

  @ApiProperty({ required: false })
  readonly amount?: number

  @ApiProperty({ required: false })
  readonly basisPoints?: number

  @ApiProperty({ required: false })
  readonly count?: number

  @ApiProperty({ required: false })
  readonly sides?: number
}

class EquippedProductResponse {
  @ApiProperty({ enum: EQUIPMENT_SLOTS })
  readonly slot!: string

  @ApiProperty({ example: 'espada-de-fuego' })
  readonly itemId!: string

  @ApiProperty({ format: 'uuid' })
  readonly productId!: string

  @ApiProperty()
  readonly name!: string

  @ApiProperty({ format: 'uri' })
  readonly imageUrl!: string

  @ApiProperty({ enum: ['ARMA', 'ARMADURA', 'ITEM'] })
  readonly type!: string

  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  readonly lifecycleStatus!: string
}

class HeroSummaryResponse {
  @ApiProperty({ format: 'uuid' })
  readonly heroId!: string

  @ApiProperty({ description: 'Referencia con la que el heroe figura en el inventario.' })
  readonly reference!: string

  @ApiProperty({ example: 'GUERRERO_TANQUE' })
  readonly subtype!: string

  @ApiProperty()
  readonly name!: string

  @ApiProperty({ format: 'uri' })
  readonly imageUrl!: string
}

class HeroStatsResponse {
  @ApiProperty()
  readonly power!: number

  @ApiProperty()
  readonly health!: number

  @ApiProperty()
  readonly defense!: number

  @ApiProperty({ nullable: true, type: 'number' })
  readonly attack!: number | null

  @ApiProperty({ nullable: true, type: MagnitudeResponse })
  readonly damage!: MagnitudeResponse | null

  @ApiProperty({ nullable: true, type: MagnitudeResponse })
  readonly healing!: MagnitudeResponse | null
}

class HeroStatDeltaResponse {
  @ApiProperty({ enum: ['POWER', 'HEALTH', 'DEFENSE', 'ATTACK'] })
  readonly statistic!: string

  @ApiProperty()
  readonly base!: number

  @ApiProperty()
  readonly effective!: number

  @ApiProperty()
  readonly delta!: number
}

class EquippedEffectResponse {
  @ApiProperty({ enum: EQUIPMENT_SLOTS })
  readonly sourceSlot!: string

  @ApiProperty({ format: 'uuid' })
  readonly sourceProductId!: string

  @ApiProperty()
  readonly sourceProductReference!: string

  @ApiProperty({
    description: 'kind del efecto canonico: STAT_MODIFIER, DAMAGE, HEALING, ...',
  })
  readonly kind!: string

  @ApiProperty({ enum: ['SELF', 'ALLY', 'ALLIED_GROUP', 'OPPONENT', 'ENEMY_GROUP'] })
  readonly target!: string

  @ApiProperty({ required: false })
  readonly statistic?: string

  @ApiProperty({ required: false })
  readonly operation?: string

  @ApiProperty({ required: false, type: MagnitudeResponse })
  readonly magnitude?: MagnitudeResponse

  @ApiProperty({ required: false })
  readonly durationTurns?: number

  @ApiProperty()
  readonly hasActivationCondition!: boolean

  @ApiProperty({
    description:
      'true si el efecto ya se refleja en effectiveStats; false si queda para el motor de combate (HU-29+).',
  })
  readonly appliedToStats!: boolean

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'Efecto canonico crudo.',
  })
  readonly raw!: unknown
}

class EquipmentArmorResponse {
  @ApiProperty({ nullable: true, type: EquippedProductResponse })
  readonly HELMET!: EquippedProductResponse | null

  @ApiProperty({ nullable: true, type: EquippedProductResponse })
  readonly CHEST!: EquippedProductResponse | null

  @ApiProperty({ nullable: true, type: EquippedProductResponse })
  readonly GLOVES!: EquippedProductResponse | null

  @ApiProperty({ nullable: true, type: EquippedProductResponse })
  readonly BRACERS!: EquippedProductResponse | null

  @ApiProperty({ nullable: true, type: EquippedProductResponse })
  readonly PANTS!: EquippedProductResponse | null

  @ApiProperty({ nullable: true, type: EquippedProductResponse })
  readonly SHOES!: EquippedProductResponse | null
}

class EquipmentResponse {
  @ApiProperty({ type: EquippedProductResponse, isArray: true, description: 'Hasta 2 armas.' })
  readonly weapons!: readonly EquippedProductResponse[]

  @ApiProperty({ type: EquipmentArmorResponse, description: 'Una pieza por ranura exacta.' })
  readonly armor!: EquipmentArmorResponse

  @ApiProperty({ type: EquippedProductResponse, isArray: true, description: 'Hasta 2 items.' })
  readonly items!: readonly EquippedProductResponse[]
}

export class HeroEquipmentResponse {
  @ApiProperty({ type: HeroSummaryResponse })
  readonly hero!: HeroSummaryResponse

  @ApiProperty({ type: EquipmentResponse })
  readonly equipment!: EquipmentResponse

  @ApiProperty({ type: HeroStatsResponse })
  readonly baseStats!: HeroStatsResponse

  @ApiProperty({ type: HeroStatsResponse })
  readonly effectiveStats!: HeroStatsResponse

  @ApiProperty({ type: HeroStatDeltaResponse, isArray: true })
  readonly deltas!: readonly HeroStatDeltaResponse[]

  @ApiProperty({ type: EquippedEffectResponse, isArray: true })
  readonly activeEffects!: readonly EquippedEffectResponse[]
}
