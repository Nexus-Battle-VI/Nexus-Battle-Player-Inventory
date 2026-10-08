import type { DomainEvent } from './DomainEvent'

export interface HeroItemEquipped extends DomainEvent {
  readonly name: 'hero.item.equipped'
  readonly heroId: string
  readonly slot: string
  readonly itemId: string
  readonly productId: string
}

export const heroItemEquipped = (params: {
  aggregateId: string
  heroId: string
  slot: string
  itemId: string
  productId: string
  occurredAt: Date
}): HeroItemEquipped => ({
  name: 'hero.item.equipped',
  aggregateId: params.aggregateId,
  heroId: params.heroId,
  slot: params.slot,
  itemId: params.itemId,
  productId: params.productId,
  occurredAt: params.occurredAt,
})

export interface HeroItemUnequipped extends DomainEvent {
  readonly name: 'hero.item.unequipped'
  readonly heroId: string
  readonly slot: string
  readonly itemId: string
  readonly productId: string
}

export const heroItemUnequipped = (params: {
  aggregateId: string
  heroId: string
  slot: string
  itemId: string
  productId: string
  occurredAt: Date
}): HeroItemUnequipped => ({
  name: 'hero.item.unequipped',
  aggregateId: params.aggregateId,
  heroId: params.heroId,
  slot: params.slot,
  itemId: params.itemId,
  productId: params.productId,
  occurredAt: params.occurredAt,
})
