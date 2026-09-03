/**
 * Ficha de un producto que el jugador posee (HU-27, RF-27).
 *
 * Compone lo que Player/Inventory sabe (pertenencia y cantidad) con la
 * información vigente del producto que aporta Catalog. NO incluye calificación
 * ni comentarios: por decisión funcional confirmada, rating y comentarios
 * pertenecen a la ficha de E-commerce/Subasta, no a "Mi Inventario".
 */
export interface OwnedInventoryItemDetailDto {
  readonly itemId: string
  readonly quantity: number
  readonly product: {
    readonly productId: string
    readonly sku: string
    readonly name: string
    readonly imageUrl: string
    readonly description: string
    readonly type: string
    readonly lifecycleStatus: string
    readonly creditsPrice: number
    readonly premium: boolean
    readonly realMoneyPrice: { readonly amount: number; readonly currency: string } | null
    readonly attributes: unknown
  }
}
