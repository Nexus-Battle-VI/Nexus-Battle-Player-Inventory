import type { Inventory } from '../../domain/entities/Inventory'
import type { PlayerId } from '../../domain/value-objects/identifiers'

/**
 * Puerto de persistencia del agregado Inventory.
 *
 * Player/Inventory es propietario exclusivo de sus datos. Ningun otro servicio
 * accede a este almacen, ni directamente ni mediante claves foraneas.
 *
 * El adaptador definitivo sobre MongoDB queda sujeto a ADR-005, que decide el
 * ODM. En Foundation opera un adaptador en memoria real.
 */
export interface InventoryRepositoryPort {
  save(inventory: Inventory): Promise<void>
  findByOwner(ownerId: PlayerId): Promise<Inventory | null>
}

export const INVENTORY_REPOSITORY = Symbol('InventoryRepositoryPort')
