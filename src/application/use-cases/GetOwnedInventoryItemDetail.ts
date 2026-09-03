import { PlayerId } from '../../domain/value-objects/identifiers'
import type { OwnedInventoryItemDetailDto } from '../dto/OwnedInventoryItemDetailDto'
import { InventoryItemNotFoundError } from '../errors/ApplicationError'
import type { CatalogReadPort } from '../ports/CatalogReadPort'
import type { InventoryQueryPort } from '../ports/InventoryQueryPort'

/**
 * Ficha de un producto que el jugador posee (HU-27, RF-27).
 *
 * Compone la pertenencia y la cantidad —dato propio de Player/Inventory— con la
 * información vigente del producto que aporta Catalog por su API. No lee la base
 * de datos de Catalog ni incluye calificación o comentarios: esos pertenecen a
 * la ficha de E-commerce/Subasta.
 *
 * - Referencia no poseída o desconocida por Catalog: 404 (`InventoryItemNotFoundError`).
 *   No se distingue el caso para no revelar el catálogo de otra persona.
 * - Catalog no disponible: se propaga `CatalogUnavailableError` -> 503. No se
 *   fabrica una ficha incompleta.
 */
export class GetOwnedInventoryItemDetail {
  private readonly inventories: InventoryQueryPort
  private readonly catalog: CatalogReadPort

  constructor(inventories: InventoryQueryPort, catalog: CatalogReadPort) {
    this.inventories = inventories
    this.catalog = catalog
  }

  async execute(ownerId: string, itemReference: string): Promise<OwnedInventoryItemDetailDto> {
    const owner = PlayerId.create(ownerId)
    const reference = itemReference.trim()

    const owned = await this.inventories.findAllOwnedItems(owner)
    const slot = owned.find((item) => item.itemId === reference)

    if (slot === undefined) {
      throw new InventoryItemNotFoundError(reference)
    }

    const product = await this.catalog.getByReference(reference)

    if (product === null) {
      throw new InventoryItemNotFoundError(reference)
    }

    return {
      itemId: slot.itemId,
      quantity: slot.quantity,
      product: {
        productId: product.productId,
        sku: product.sku,
        name: product.name,
        imageUrl: product.imageUrl,
        description: product.description,
        type: product.type,
        lifecycleStatus: product.lifecycleStatus,
        creditsPrice: product.creditsPrice,
        premium: product.premium,
        realMoneyPrice: product.realMoneyPrice,
        attributes: product.attributes,
      },
    }
  }
}
