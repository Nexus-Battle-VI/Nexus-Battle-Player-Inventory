import { HeroLoadout } from '../../domain/entities/HeroLoadout'
import { MISSION_REQUIRED_SLOTS } from '../../domain/value-objects/equipment'
import { PlayerId } from '../../domain/value-objects/identifiers'
import { HeroNotOwnedError } from '../errors/ApplicationError'
import type { CatalogReadPort } from '../ports/CatalogReadPort'
import type { ClockPort } from '../ports/ClockPort'
import type { HeroLoadoutRepositoryPort } from '../ports/HeroLoadoutRepositoryPort'
import {
  MissionCommitmentConflictError,
  sameMissionCommitment,
  type MissionHeroCommitment,
  type MissionHeroCommitmentInput,
  type MissionHeroCommitmentPort,
} from '../ports/MissionHeroCommitmentPort'
import type { InventoryQueryPort } from '../ports/InventoryQueryPort'
import { resolveOwnedHero } from './hero-equipment-shared'
import { assembleSelectionView } from './hero-selection-shared'

export class MissionCommitmentRejectionError extends Error {
  constructor(
    readonly code: 'HERO_NOT_OWNED' | 'HERO_NOT_READY' | 'LOADOUT_INCOMPLETE',
    readonly detail: Readonly<Record<string, unknown>> = {},
  ) {
    super(
      code === 'LOADOUT_INCOMPLETE'
        ? 'El heroe necesita el mazo completo.'
        : 'El heroe no esta disponible para la mision.',
    )
    this.name = 'MissionCommitmentRejectionError'
  }
}

/** Valida el estado vigente antes de reservar; el repositorio compara la version al adquirir el lock. */
export class CommitHeroForMission {
  constructor(
    private readonly inventories: InventoryQueryPort,
    private readonly catalog: CatalogReadPort,
    private readonly loadouts: HeroLoadoutRepositoryPort,
    private readonly commitments: MissionHeroCommitmentPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(input: MissionHeroCommitmentInput): Promise<MissionHeroCommitment> {
    const now = this.clock.now()
    const previous = await this.commitments.findByOperation(input.operationId)
    if (previous !== null) {
      if (
        !sameMissionCommitment(previous, input) ||
        previous.status !== 'ACTIVE' ||
        previous.expiresAt <= now
      ) {
        throw new MissionCommitmentConflictError()
      }
      return previous
    }

    if (input.expiresAt <= now) {
      throw new MissionCommitmentRejectionError('HERO_NOT_READY')
    }

    const owner = PlayerId.create(input.playerId)
    const deps = { inventories: this.inventories, catalog: this.catalog }
    let hero
    try {
      hero = await resolveOwnedHero(deps, owner, input.heroId)
    } catch (error: unknown) {
      if (error instanceof HeroNotOwnedError) {
        throw new MissionCommitmentRejectionError('HERO_NOT_OWNED')
      }
      throw error
    }

    const heroId = hero.heroProduct.productId
    if (heroId.toLowerCase() !== input.heroId.toLowerCase()) {
      throw new MissionCommitmentRejectionError('HERO_NOT_OWNED')
    }
    const loadout =
      (await this.loadouts.findByHero(owner, heroId)) ??
      HeroLoadout.createEmpty(owner.value, heroId)
    const selection = await assembleSelectionView(deps, owner, hero, loadout, now)

    if (!selection.readiness.ready) {
      throw new MissionCommitmentRejectionError('HERO_NOT_READY', {
        blockers: selection.readiness.blockers,
      })
    }

    if (input.completeLoadout) {
      const missingSlots = (
        [
          ['WEAPON', selection.capacity.weapons.used, MISSION_REQUIRED_SLOTS.WEAPON],
          ['ARMOR', selection.capacity.armor.used, MISSION_REQUIRED_SLOTS.ARMOR],
          ['ITEM', selection.capacity.items.used, MISSION_REQUIRED_SLOTS.ITEM],
        ] as const
      ).flatMap(([family, used, required]) =>
        used < required ? [{ family, missing: required - used }] : [],
      )

      if (missingSlots.length > 0) {
        throw new MissionCommitmentRejectionError('LOADOUT_INCOMPLETE', { missingSlots })
      }
    }

    return this.commitments.commit(input, loadout.version)
  }

  release(operationId: string): Promise<void> {
    return this.commitments.release(operationId)
  }
}
