import type { DomainEvent } from './DomainEvent'

export interface ItemAdded extends DomainEvent {
  readonly name: 'inventory.item.added'
  readonly itemId: string
  readonly quantity: number
  readonly resultingQuantity: number
}

export interface ItemRemoved extends DomainEvent {
  readonly name: 'inventory.item.removed'
  readonly itemId: string
  readonly quantity: number
  readonly resultingQuantity: number
}

export const itemAdded = (params: {
  aggregateId: string
  itemId: string
  quantity: number
  resultingQuantity: number
  occurredAt: Date
}): ItemAdded => ({
  name: 'inventory.item.added',
  aggregateId: params.aggregateId,
  itemId: params.itemId,
  quantity: params.quantity,
  resultingQuantity: params.resultingQuantity,
  occurredAt: params.occurredAt,
})

export const itemRemoved = (params: {
  aggregateId: string
  itemId: string
  quantity: number
  resultingQuantity: number
  occurredAt: Date
}): ItemRemoved => ({
  name: 'inventory.item.removed',
  aggregateId: params.aggregateId,
  itemId: params.itemId,
  quantity: params.quantity,
  resultingQuantity: params.resultingQuantity,
  occurredAt: params.occurredAt,
})
