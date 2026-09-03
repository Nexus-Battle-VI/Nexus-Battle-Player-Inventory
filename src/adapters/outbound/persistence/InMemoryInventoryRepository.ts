import { Inventory } from '../../../domain/entities/Inventory'
import type { InventorySnapshot } from '../../../domain/entities/Inventory'
import { ItemId, PlayerId, Quantity } from '../../../domain/value-objects/identifiers'
import { CapacityPolicy } from '../../../domain/policies/CapacityPolicy'
import {
  InventoryGrantConflictError,
  InventoryGrantRejectedError,
  type InventoryGrantCommand,
  type InventoryGrantPort,
  type InventoryGrantResult,
} from '../../../application/ports/InventoryGrantPort'
import { DomainError } from '../../../domain/errors/DomainError'
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
export class InMemoryInventoryRepository
  implements InventoryRepositoryPort, InventoryQueryPort, InventoryGrantPort
{
  private readonly byOwner = new Map<string, InventorySnapshot>()
  private readonly grants = new Map<
    string,
    { fingerprint: string; result: InventoryGrantResult | null; rejection: string | null }
  >()

  grant(command: InventoryGrantCommand): Promise<InventoryGrantResult> {
    try {
      const fingerprint = JSON.stringify({ playerId: command.playerId, items: command.items })
      const previous = this.grants.get(command.operationId)
      if (previous !== undefined) {
        if (previous.fingerprint !== fingerprint) throw new InventoryGrantConflictError()
        if (previous.rejection !== null) throw new InventoryGrantRejectedError(previous.rejection)
        if (previous.result === null) throw new Error('Resultado de entrega incompleto.')
        return Promise.resolve(structuredClone(previous.result))
      }
      const snapshot = this.byOwner.get(command.playerId)
      const ownerId = PlayerId.create(command.playerId)
      const inventory =
        snapshot === undefined
          ? Inventory.createEmpty(ownerId, CapacityPolicy.default())
          : Inventory.restore({ ownerId, capacity: snapshot.capacity, slots: snapshot.slots })
      try {
        for (const item of command.items) {
          inventory.add(ItemId.create(item.productId), Quantity.create(item.quantity), new Date())
        }
      } catch (error: unknown) {
        if (!(error instanceof DomainError)) throw error
        this.grants.set(command.operationId, {
          fingerprint,
          result: null,
          rejection: error.message,
        })
        throw new InventoryGrantRejectedError(error.message)
      }
      const result: InventoryGrantResult = { ...command, applied: true }
      // No await entre validar el lote y guardar ambas partes: un solo turno de JS.
      this.byOwner.set(command.playerId, inventory.toSnapshot())
      this.grants.set(command.operationId, {
        fingerprint,
        result: structuredClone(result),
        rejection: null,
      })
      return Promise.resolve(result)
    } catch (error: unknown) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

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
    this.grants.clear()
  }
}
