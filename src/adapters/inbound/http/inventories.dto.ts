import { ApiProperty } from '@nestjs/swagger'
import { IsInt, IsString, Matches, Max, Min } from 'class-validator'

/**
 * Contrato de entrada de una operacion sobre el inventario.
 *
 * La validacion aqui es de forma. Las reglas de negocio (capacidad, apilado,
 * agotamiento de una ranura) siguen viviendo en el dominio y se aplican
 * igualmente aunque la peticion llegue por otro adaptador.
 */
export class ChangeInventoryRequest {
  @ApiProperty({
    example: 'espada-de-hierro',
    description: 'Identificador del objeto en kebab-case',
  })
  @IsString()
  @Matches(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, {
    message: 'El identificador del objeto debe estar en kebab-case.',
  })
  itemId!: string

  @ApiProperty({ example: 3, minimum: 1, maximum: 9999 })
  @IsInt()
  @Min(1)
  @Max(9999)
  quantity!: number
}

export class InventorySlotResponse {
  @ApiProperty({ example: 'espada-de-hierro' })
  readonly itemId!: string

  @ApiProperty({ example: 3 })
  readonly quantity!: number
}

export class InventoryResponse {
  @ApiProperty({ example: 'player-42' })
  readonly ownerId!: string

  @ApiProperty({ example: 30 })
  readonly capacity!: number

  @ApiProperty({ example: 2 })
  readonly usedSlots!: number

  @ApiProperty({ example: 28 })
  readonly freeSlots!: number

  @ApiProperty({ example: 7 })
  readonly totalUnits!: number

  @ApiProperty({ type: InventorySlotResponse, isArray: true })
  readonly slots!: readonly InventorySlotResponse[]
}
