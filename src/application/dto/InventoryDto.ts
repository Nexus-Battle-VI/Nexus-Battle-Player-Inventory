import type { InventorySnapshot } from '../../domain/entities/Inventory'

export interface InventorySlotDto {
  readonly itemId: string
  readonly quantity: number
}

export interface InventoryDto {
  readonly ownerId: string
  readonly capacity: number
  readonly usedSlots: number
  readonly freeSlots: number
  readonly totalUnits: number
  readonly slots: readonly InventorySlotDto[]
}

export const toInventoryDto = (snapshot: InventorySnapshot): InventoryDto => {
  const totalUnits = snapshot.slots.reduce((sum, slot) => sum + slot.quantity, 0)

  return {
    ownerId: snapshot.ownerId,
    capacity: snapshot.capacity,
    usedSlots: snapshot.slots.length,
    freeSlots: snapshot.capacity - snapshot.slots.length,
    totalUnits,
    slots: snapshot.slots.map((slot) => ({ itemId: slot.itemId, quantity: slot.quantity })),
  }
}
