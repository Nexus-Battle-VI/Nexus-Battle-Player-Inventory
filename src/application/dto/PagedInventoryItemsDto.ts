/**
 * Resumen del producto de Catalog para una tarjeta del listado de HU-27.
 *
 * Es el subconjunto que una card necesita. La ficha completa —descripción,
 * habilidades, efectos— vive en la consulta de detalle, no en el listado.
 */
export interface CatalogProductSummary {
  readonly productId: string
  readonly sku: string
  readonly name: string
  readonly imageUrl: string
  readonly type: string
  readonly lifecycleStatus: string
}

/**
 * Una entrada del inventario en el listado paginado.
 *
 * `product` es `null` cuando el listado no se enriqueció con Catalog: bien
 * porque Catalog no conoce esa referencia, bien porque no estaba disponible en
 * ese momento y el listado del inventario propio no debe caerse por ello. La
 * búsqueda por nombre, en cambio, sí exige Catalog.
 */
export interface OwnedInventoryItemCardDto {
  readonly itemId: string
  readonly quantity: number
  readonly product: CatalogProductSummary | null
}

/**
 * Resultado de la consulta paginada del inventario (RF-27).
 *
 * Lleva los metadatos que la interfaz necesita para paginar y mostrar hasta 10
 * páginas. Cuando la petición trae búsqueda o filtro, `totalItems` y
 * `totalPages` se calculan sobre el resultado FILTRADO, no sobre el inventario
 * entero.
 */
export interface PagedInventoryItemsDto {
  readonly items: readonly OwnedInventoryItemCardDto[]
  readonly page: number
  readonly pageSize: number
  readonly totalItems: number
  readonly totalPages: number
}
