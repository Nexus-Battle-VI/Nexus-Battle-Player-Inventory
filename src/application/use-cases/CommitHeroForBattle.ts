import { PlayerId } from '../../domain/value-objects/identifiers'
import { HeroNotOwnedError } from '../errors/ApplicationError'
import type {
  BattleHeroCommitment,
  BattleHeroCommitmentInput,
  BattleHeroCommitmentPort,
} from '../ports/BattleHeroCommitmentPort'
import {
  BattleCommitmentConflictError,
  sameBattleCommitment,
} from '../ports/BattleHeroCommitmentPort'
import type { CatalogReadPort } from '../ports/CatalogReadPort'
import type { ClockPort } from '../ports/ClockPort'
import type { InventoryQueryPort } from '../ports/InventoryQueryPort'
import { resolveOwnedHero } from './hero-equipment-shared'

export class BattleCommitmentRejectionError extends Error {
  constructor(
    readonly code: 'HERO_NOT_OWNED' | 'INVALID_EXPIRY',
    readonly detail: Readonly<Record<string, unknown>> = {},
  ) {
    super(
      code === 'INVALID_EXPIRY'
        ? 'El compromiso de batalla necesita una caducidad futura.'
        : 'El heroe no es de ese jugador.',
    )
    this.name = 'BattleCommitmentRejectionError'
  }
}

/**
 * Compromete un heroe para una batalla (HU-29, contrato §3.1).
 *
 * A diferencia del compromiso de mision, NO exige loadout completo ni
 * preparacion: una batalla no requiere un mazo armado, solo congela el
 * equipamiento con el que el heroe entro. Lo unico que se valida es que el
 * heroe sea de ese jugador, porque la marca de ocupacion no puede servir para
 * reservar heroes ajenos.
 */
export class CommitHeroForBattle {
  constructor(
    private readonly inventories: InventoryQueryPort,
    private readonly catalog: CatalogReadPort,
    private readonly commitments: BattleHeroCommitmentPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(input: BattleHeroCommitmentInput): Promise<BattleHeroCommitment> {
    const now = this.clock.now()
    const previous = await this.commitments.findByOperation(input.operationId)

    if (previous !== null) {
      if (
        !sameBattleCommitment(previous, input) ||
        previous.status !== 'ACTIVE' ||
        previous.expiresAt <= now
      ) {
        throw new BattleCommitmentConflictError()
      }

      return previous
    }

    if (input.expiresAt <= now) {
      throw new BattleCommitmentRejectionError('INVALID_EXPIRY')
    }

    const owner = PlayerId.create(input.playerId)
    const deps = { inventories: this.inventories, catalog: this.catalog }
    let hero

    try {
      hero = await resolveOwnedHero(deps, owner, input.heroId)
    } catch (error: unknown) {
      if (error instanceof HeroNotOwnedError) {
        throw new BattleCommitmentRejectionError('HERO_NOT_OWNED')
      }
      throw error
    }

    if (hero.heroProduct.productId.toLowerCase() !== input.heroId.toLowerCase()) {
      throw new BattleCommitmentRejectionError('HERO_NOT_OWNED')
    }

    return this.commitments.commit(input, now)
  }

  release(operationId: string): Promise<void> {
    return this.commitments.release(operationId)
  }
}
