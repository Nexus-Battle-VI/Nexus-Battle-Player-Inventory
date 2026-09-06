import { ItemId } from '../../domain/value-objects/identifiers'
import type { InventoryQueryPort } from '../ports/InventoryQueryPort'

export interface ProductOwnersResult {
  readonly productId: string
  readonly owners: readonly { readonly playerId: string }[]
}

/**
 * Resuelve los jugadores que poseen actualmente un producto (HU-38, TASK
 * #175): la unica pregunta que este caso de uso responde. No consulta
 * Catalog, no modifica el inventario ni reserva stock -es una lectura pura,
 * expresada en la interfaz de `InventoryQueryPort` en lugar de en la de
 * comandos-.
 *
 * `ItemId.create` valida la forma (UUID o legacy kebab-case); un `productId`
 * mal formado se traduce a `DomainError`, que el controlador interno
 * responde como 400 en vez de propagar una consulta con un valor que ninguna
 * ranura real podria tener.
 */
export class GetProductOwners {
  constructor(private readonly inventories: InventoryQueryPort) {}

  async execute(rawProductId: string): Promise<ProductOwnersResult> {
    const productId = ItemId.create(rawProductId)
    const owners = await this.inventories.findOwnersOfProduct(productId)

    return {
      productId: productId.value,
      owners: owners.map((playerId) => ({ playerId })),
    }
  }
}

export const GET_PRODUCT_OWNERS = Symbol('GetProductOwners')
