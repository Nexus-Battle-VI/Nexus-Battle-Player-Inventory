import { Inventory } from '../../../domain/entities/Inventory'
import type { InventorySnapshot } from '../../../domain/entities/Inventory'
import { PlayerId } from '../../../domain/value-objects/identifiers'
import type { InventoryRepositoryPort } from '../../../application/ports/InventoryRepositoryPort'
import type {
  InventoryQueryPort,
  OwnedInventoryItem,
  OwnedInventoryItemsSlice,
} from '../../../application/ports/InventoryQueryPort'

/**
 * Repositorio en memoria del agregado Inventory.
 *
 * Almacena instantaneas, no referencias al agregado, de modo que una mutacion
 * no persistida nunca se filtra al almacen. Con referencias vivas, una prueba
 * pasaria aunque el caso de uso olvidara guardar.
 *
 * Cumple los dos puertos sobre el mismo almacen: `InventoryRepositoryPort` para
 * los comandos e `InventoryQueryPort` para la consulta paginada de HU-27.
 */
export class InMemoryInventoryRepository implements InventoryRepositoryPort, InventoryQueryPort {
  private readonly byOwner = new Map<string, InventorySnapshot>()

  save(inventory: Inventory): Promise<void> {
    this.byOwner.set(inventory.ownerId.value, inventory.toSnapshot())

    return Promise.resolve()
  }

  findByOwner(ownerId: PlayerId): Promise<Inventory | null> {
    const snapshot = this.byOwner.get(ownerId.value)

    if (snapshot === undefined) {
      return Promise.resolve(null)
    }

    return Promise.resolve(
      Inventory.restore({
        ownerId: PlayerId.create(snapshot.ownerId),
        capacity: snapshot.capacity,
        slots: snapshot.slots,
      }),
    )
  }

  listOwnedItems(
    ownerId: PlayerId,
    page: number,
    pageSize: number,
  ): Promise<OwnedInventoryItemsSlice> {
    const ordered = this.orderedSlots(ownerId)
    const start = (page - 1) * pageSize

    return Promise.resolve({
      items: ordered.slice(start, start + pageSize),
      totalItems: ordered.length,
    })
  }

  findAllOwnedItems(ownerId: PlayerId): Promise<readonly OwnedInventoryItem[]> {
    return Promise.resolve(this.orderedSlots(ownerId))
  }

  private orderedSlots(ownerId: PlayerId): readonly OwnedInventoryItem[] {
    const slots = this.byOwner.get(ownerId.value)?.slots ?? []

    return [...slots]
      .sort((left, right) => left.itemId.localeCompare(right.itemId))
      .map((slot) => ({ itemId: slot.itemId, quantity: slot.quantity }))
  }

  get size(): number {
    return this.byOwner.size
  }

  clear(): void {
    this.byOwner.clear()
  }
}
