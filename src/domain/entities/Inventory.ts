import { DomainError } from '../errors/DomainError'
import type { DomainEvent } from '../events/DomainEvent'
import { itemAdded, itemRemoved } from '../events/InventoryEvents'
import type { CapacityPolicy } from '../policies/CapacityPolicy'
import type { PlayerId } from '../value-objects/identifiers'
import { ItemId, Quantity } from '../value-objects/identifiers'

export interface InventorySlotSnapshot {
  readonly itemId: string
  readonly quantity: number
}

export interface InventorySnapshot {
  readonly ownerId: string
  readonly capacity: number
  readonly slots: readonly InventorySlotSnapshot[]
}

/**
 * Raiz de agregado del contexto Player/Inventory.
 *
 * Un inventario es un conjunto de ranuras, cada una con un objeto y una
 * cantidad. La capacidad limita el numero de **ranuras distintas**, no el
 * total de unidades: apilar mas unidades de un objeto que ya se posee no
 * consume una ranura nueva. Esa distincion es la regla central del contexto.
 */
export class Inventory {
  readonly ownerId: PlayerId
  private readonly capacity: number
  private readonly slots: Map<string, Quantity>
  private readonly events: DomainEvent[] = []

  private constructor(ownerId: PlayerId, capacity: number, slots: Map<string, Quantity>) {
    this.ownerId = ownerId
    this.capacity = capacity
    this.slots = slots
  }

  static createEmpty(ownerId: PlayerId, policy: CapacityPolicy): Inventory {
    return new Inventory(ownerId, policy.capacity, new Map<string, Quantity>())
  }

  /** Reconstituye un inventario persistido. No emite eventos. */
  static restore(params: {
    ownerId: PlayerId
    capacity: number
    slots: readonly InventorySlotSnapshot[]
  }): Inventory {
    if (!Number.isInteger(params.capacity) || params.capacity < 1) {
      throw new DomainError('La capacidad restaurada debe ser un entero mayor o igual a 1.')
    }

    if (params.slots.length > params.capacity) {
      throw new DomainError(
        `El inventario restaurado tiene ${String(params.slots.length)} ranuras y una capacidad de ${String(params.capacity)}.`,
      )
    }

    const slots = new Map<string, Quantity>()

    for (const slot of params.slots) {
      const itemId = ItemId.create(slot.itemId)

      if (slots.has(itemId.value)) {
        throw new DomainError(`El inventario restaurado repite el objeto "${itemId.value}".`)
      }

      slots.set(itemId.value, Quantity.create(slot.quantity))
    }

    return new Inventory(params.ownerId, params.capacity, slots)
  }

  get maxSlots(): number {
    return this.capacity
  }

  get usedSlots(): number {
    return this.slots.size
  }

  get freeSlots(): number {
    return this.capacity - this.slots.size
  }

  get isFull(): boolean {
    return this.slots.size >= this.capacity
  }

  get totalUnits(): number {
    let total = 0

    for (const quantity of this.slots.values()) {
      total += quantity.value
    }

    return total
  }

  quantityOf(itemId: ItemId): number {
    return this.slots.get(itemId.value)?.value ?? 0
  }

  contains(itemId: ItemId): boolean {
    return this.slots.has(itemId.value)
  }

  /**
   * Anade unidades de un objeto.
   *
   * Si el objeto ya esta presente se apila sobre la ranura existente y la
   * capacidad no interviene. Solo un objeto nuevo consume una ranura.
   */
  add(itemId: ItemId, quantity: Quantity, occurredAt: Date): void {
    const existing = this.slots.get(itemId.value)

    if (existing === undefined) {
      if (this.isFull) {
        throw new DomainError(
          `El inventario de ${this.ownerId.value} esta completo: ${String(this.capacity)} ranuras ocupadas.`,
        )
      }

      this.slots.set(itemId.value, quantity)
    } else {
      this.slots.set(itemId.value, existing.plus(quantity))
    }

    this.events.push(
      itemAdded({
        aggregateId: this.ownerId.value,
        itemId: itemId.value,
        quantity: quantity.value,
        resultingQuantity: this.quantityOf(itemId),
        occurredAt,
      }),
    )
  }

  /**
   * Retira unidades de un objeto. La ranura desaparece cuando se agota, de modo
   * que no quedan ranuras vacias ocupando capacidad.
   */
  remove(itemId: ItemId, quantity: Quantity, occurredAt: Date): void {
    const existing = this.slots.get(itemId.value)

    if (existing === undefined) {
      throw new DomainError(
        `El inventario de ${this.ownerId.value} no contiene el objeto "${itemId.value}".`,
      )
    }

    const remaining = existing.minus(quantity)

    if (remaining === null) {
      this.slots.delete(itemId.value)
    } else {
      this.slots.set(itemId.value, remaining)
    }

    this.events.push(
      itemRemoved({
        aggregateId: this.ownerId.value,
        itemId: itemId.value,
        quantity: quantity.value,
        resultingQuantity: remaining?.value ?? 0,
        occurredAt,
      }),
    )
  }

  pullEvents(): readonly DomainEvent[] {
    const pulled = [...this.events]
    this.events.length = 0

    return pulled
  }

  toSnapshot(): InventorySnapshot {
    return {
      ownerId: this.ownerId.value,
      capacity: this.capacity,
      slots: [...this.slots.entries()]
        .map(([itemId, quantity]) => ({ itemId, quantity: quantity.value }))
        .sort((a, b) => a.itemId.localeCompare(b.itemId)),
    }
  }
}
