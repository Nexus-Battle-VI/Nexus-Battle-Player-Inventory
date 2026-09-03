import { ApiProperty } from '@nestjs/swagger'
import { IsString, Length } from 'class-validator'

import { HERO_READINESS_BLOCKERS } from '../../../domain/policies/HeroReadinessPolicy'
import { HeroEquipmentResponse } from './hero-equipment.dto'

/**
 * Cuerpo de `PUT /api/inventories/me/heroes/selection`.
 *
 * Solo la referencia del heroe. NO se acepta `ownerId`: la identidad sale del
 * sujeto verificado del testimonio, de modo que no existe un identificador
 * manipulable con el que preparar el heroe de otra persona (CA-06).
 */
export class SelectHeroRequest {
  @ApiProperty({
    description: 'productId (UUID) o alias sku del heroe propio a preparar.',
    example: 'guerrero-tanque',
  })
  @IsString()
  @Length(1, 128)
  heroReference!: string
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

class HeroBaseStatsResponse {
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

class HeroAbilityResponse {
  @ApiProperty({ description: 'Referencia del producto HABILIDAD publicada por el heroe.' })
  readonly reference!: string

  @ApiProperty({
    nullable: true,
    type: 'string',
    description: 'null cuando Catalog no resolvio la referencia. No se inventa un nombre.',
  })
  readonly name!: string | null
}

/**
 * Un heroe que el jugador puede preparar.
 *
 * `subtype` viaja como CODIGO del registro vigente (`GUERRERO_TANQUE`, ...) y
 * no como enumeracion cerrada de este contrato: un noveno heroe aprobado por
 * administracion viaja por aqui sin cambiar el esquema (CA-11).
 */
export class AvailableHeroResponse {
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

  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  readonly lifecycleStatus!: string

  @ApiProperty({ type: HeroBaseStatsResponse })
  readonly baseStats!: HeroBaseStatsResponse

  @ApiProperty({ type: HeroAbilityResponse, isArray: true })
  readonly abilities!: readonly HeroAbilityResponse[]

  @ApiProperty({ description: 'true si es el heroe preparado ahora mismo.' })
  readonly selected!: boolean
}

class HeroReadinessBlockerResponse {
  @ApiProperty({ enum: HERO_READINESS_BLOCKERS })
  readonly code!: string

  @ApiProperty({ nullable: true, type: 'string' })
  readonly slot!: string | null

  @ApiProperty()
  readonly reference!: string

  @ApiProperty()
  readonly detail!: string
}

class HeroReadinessResponse {
  @ApiProperty({
    description:
      'true cuando la configuracion es valida (CA-10). Un heroe SIN equipamiento esta listo: la HU fija techos, no minimos.',
  })
  readonly ready!: boolean

  @ApiProperty({ type: HeroReadinessBlockerResponse, isArray: true })
  readonly blockers!: readonly HeroReadinessBlockerResponse[]
}

class EquipmentCapacityResponse {
  @ApiProperty()
  readonly used!: number

  @ApiProperty()
  readonly max!: number
}

class HeroCapacityResponse {
  @ApiProperty({ type: EquipmentCapacityResponse })
  readonly weapons!: EquipmentCapacityResponse

  @ApiProperty({ type: EquipmentCapacityResponse })
  readonly armor!: EquipmentCapacityResponse

  @ApiProperty({ type: EquipmentCapacityResponse })
  readonly items!: EquipmentCapacityResponse
}

export class HeroSelectionResponse {
  @ApiProperty({ format: 'date-time' })
  readonly selectedAt!: string

  @ApiProperty({
    type: HeroEquipmentResponse,
    description: 'La MISMA vista que devuelve HU-28. HU-07 no recalcula estadisticas.',
  })
  readonly configuration!: HeroEquipmentResponse

  @ApiProperty({ type: HeroReadinessResponse })
  readonly readiness!: HeroReadinessResponse

  @ApiProperty({ type: HeroCapacityResponse, description: 'Ocupacion frente al techo 2/6/2.' })
  readonly capacity!: HeroCapacityResponse
}
