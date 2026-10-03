import type { DomainEvent } from './DomainEvent'

export interface HeroEpicEquipped extends DomainEvent {
  readonly name: 'hero.epic.equipped'
  readonly heroId: string
  readonly epicItemId: string
  readonly epicProductId: string
}

export const heroEpicEquipped = (params: {
  aggregateId: string
  heroId: string
  epicItemId: string
  epicProductId: string
  occurredAt: Date
}): HeroEpicEquipped => ({
  name: 'hero.epic.equipped',
  aggregateId: params.aggregateId,
  heroId: params.heroId,
  epicItemId: params.epicItemId,
  epicProductId: params.epicProductId,
  occurredAt: params.occurredAt,
})
