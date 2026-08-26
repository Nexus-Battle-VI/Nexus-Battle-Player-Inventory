import type { Inventory } from '../../domain/entities/Inventory'
import type { PlayerId } from '../../domain/value-objects/identifiers'

/**
 * Puerto de persistencia del agregado Inventory.
 *
 * Player/Inventory es propietario exclusivo de sus datos. Ningun otro servicio
 * accede a este almacen, ni directamente ni mediante claves foraneas.
 *
 * Hay dos adaptadores, y `PERSISTENCE_DRIVER` elige cual opera:
 * `MongoInventoryRepository` sobre MongoDB (ADR-012) y el de memoria.
 *
 * El de memoria NO es un resto del andamiaje: es el que permite que las pruebas
 * del dominio y de los casos de uso corran sin Docker. Ambos cumplen el mismo
 * contrato, incluido el de no filtrar al almacen una mutacion sin guardar.
 */
export interface InventoryRepositoryPort {
  save(inventory: Inventory): Promise<void>
  findByOwner(ownerId: PlayerId): Promise<Inventory | null>
}

export const INVENTORY_REPOSITORY = Symbol('InventoryRepositoryPort')
