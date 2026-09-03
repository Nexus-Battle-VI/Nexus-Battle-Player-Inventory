import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator'

const PRODUCT_TYPES = ['HEROE', 'HABILIDAD', 'ARMA', 'ARMADURA', 'ITEM', 'EPICA'] as const

/**
 * Parametros de la consulta paginada del inventario propio.
 *
 * `page` es 1-based y por defecto 1. El tamano de pagina lo fija RF-27 en 16 y
 * NO se acepta desde el cliente. `q` activa la busqueda por nombre solo desde 4
 * caracteres; `type` filtra por tipo canonico. Cualquier otro campo en la query
 * se rechaza con 400 (`forbidNonWhitelisted`), incluido un `ownerId`.
 */
export class ListOwnedItemsQuery {
  @ApiPropertyOptional({
    minimum: 1,
    default: 1,
    description: 'Numero de pagina, 1-based. Por defecto 1.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1

  @ApiPropertyOptional({
    maxLength: 80,
    description: 'Termino de busqueda por nombre. Se ignora con menos de 4 caracteres (RF-27).',
  })
  @IsOptional()
  @IsString()
  @Length(0, 80)
  q?: string

  @ApiPropertyOptional({
    enum: PRODUCT_TYPES,
    description: 'Filtra por tipo canonico de producto de Catalog.',
  })
  @IsOptional()
  @IsIn(PRODUCT_TYPES)
  type?: string
}

export class CatalogProductSummaryResponse {
  @ApiProperty({ format: 'uuid' })
  readonly productId!: string

  @ApiProperty({ example: 'espada-de-hierro' })
  readonly sku!: string

  @ApiProperty({ example: 'Espada de Hierro' })
  readonly name!: string

  @ApiProperty({ format: 'uri' })
  readonly imageUrl!: string

  @ApiProperty({ enum: PRODUCT_TYPES })
  readonly type!: string

  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  readonly lifecycleStatus!: string
}

export class OwnedInventoryItemResponse {
  @ApiProperty({ example: 'espada-de-hierro' })
  readonly itemId!: string

  @ApiProperty({ example: 3 })
  readonly quantity!: number

  @ApiPropertyOptional({
    type: CatalogProductSummaryResponse,
    nullable: true,
    description:
      'Resumen del producto vigente. Es null si Catalog no conoce la referencia o no estaba disponible en un listado sin busqueda.',
  })
  readonly product!: CatalogProductSummaryResponse | null
}

export class PagedInventoryItemsResponse {
  @ApiProperty({ type: OwnedInventoryItemResponse, isArray: true })
  readonly items!: readonly OwnedInventoryItemResponse[]

  @ApiProperty({ example: 1, description: 'Pagina devuelta, 1-based' })
  readonly page!: number

  @ApiProperty({ example: 16, description: 'Tamano de pagina fijo de RF-27' })
  readonly pageSize!: number

  @ApiProperty({
    example: 42,
    description: 'Total de resultados. Con busqueda o filtro, del conjunto filtrado.',
  })
  readonly totalItems!: number

  @ApiProperty({
    example: 3,
    description: 'ceil(totalItems / 16). Es 0 cuando no hay resultados.',
  })
  readonly totalPages!: number
}

export class RealMoneyPriceResponse {
  @ApiProperty({ example: 999 })
  readonly amount!: number

  @ApiProperty({ example: 'USD' })
  readonly currency!: string
}

export class OwnedInventoryItemDetailProductResponse {
  @ApiProperty({ format: 'uuid' })
  readonly productId!: string

  @ApiProperty({ example: 'espada-de-hierro' })
  readonly sku!: string

  @ApiProperty()
  readonly name!: string

  @ApiProperty({ format: 'uri' })
  readonly imageUrl!: string

  @ApiProperty()
  readonly description!: string

  @ApiProperty({ enum: PRODUCT_TYPES })
  readonly type!: string

  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  readonly lifecycleStatus!: string

  @ApiProperty({ example: 40 })
  readonly creditsPrice!: number

  @ApiProperty({ example: false })
  readonly premium!: boolean

  @ApiPropertyOptional({ type: RealMoneyPriceResponse, nullable: true })
  readonly realMoneyPrice!: RealMoneyPriceResponse | null

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Sobre de atributos canonicos (habilidades, efectos) tal como los publica Catalog.',
  })
  readonly attributes!: unknown
}

export class OwnedInventoryItemDetailResponse {
  @ApiProperty({ example: 'espada-de-hierro' })
  readonly itemId!: string

  @ApiProperty({ example: 3 })
  readonly quantity!: number

  @ApiProperty({ type: OwnedInventoryItemDetailProductResponse })
  readonly product!: OwnedInventoryItemDetailProductResponse
}
