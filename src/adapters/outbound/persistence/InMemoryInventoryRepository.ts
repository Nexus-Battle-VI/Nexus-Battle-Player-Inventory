import { Inventory } from '../../../domain/entities/Inventory'
import type { InventorySnapshot } from '../../../domain/entities/Inventory'
import { PlayerId } from '../../../domain/value-objects/identifiers'
import type { InventoryRepositoryPort } from '../../../application/ports/InventoryRepositoryPort'

/**
 * Repositorio en memoria del agregado Inventory.
 *
 * Almacena instantaneas, no referencias al agregado, de modo que una mutacion
 * no persistida nunca se filtra al almacen. Con referencias vivas, una prueba
 * pasaria aunque el caso de uso olvidara guardar.
 *
 * El adaptador definitivo sobre MongoDB queda sujeto a ADR-005.
 */
export class InMemoryInventoryRepository implements InventoryRepositoryPort {
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

  get size(): number {
    return this.byOwner.size
  }

  clear(): void {
    this.byOwner.clear()
  }
}
