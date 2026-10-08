import { HeroLoadout } from '../../domain/entities/HeroLoadout'
import type { ClockPort } from '../ports/ClockPort'
import { categoryOfSlot, parseEquipmentSlot } from '../../domain/value-objects/equipment'
import { PlayerId } from '../../domain/value-objects/identifiers'
import type { HeroEquipmentDto } from '../dto/HeroEquipmentDto'
import { EquipmentLockedDuringBattleError } from '../errors/ApplicationError'
import type { BattleStatePort } from '../ports/BattleStatePort'
import type { CatalogReadPort } from '../ports/CatalogReadPort'
import type { HeroLoadoutRepositoryPort } from '../ports/HeroLoadoutRepositoryPort'
import type { HeroProgressionRepositoryPort } from '../ports/HeroProgressionRepositoryPort'
import type { InventoryQueryPort } from '../ports/InventoryQueryPort'
import { assembleEquipmentView, resolveOwnedHero } from './hero-equipment-shared'
import { decideEquipmentChange } from '../../domain/policies/EquipmentCombatLockPolicy'

export interface UnequipItemFromHeroCommand {
  readonly ownerId: string
  readonly heroReference: string
  readonly slot: string
}

/**
 * Desequipa la pieza de una ranura EXACTA de un heroe propio (HU-28.4).
 *
 * Simetrico a `EquipItemOnHero`: mismo orden estricto (VALIDAR -> CALCULAR
 * ESTADO RESULTANTE -> PERSISTIR -> RESPONDER), mismo guard de batalla
 * (HU-29), mismo bloqueo optimista. La pieza removida SIGUE siendo del
 * jugador -este caso de uso solo borra la asociacion heroe/ranura del
 * agregado `HeroLoadout`, nunca toca el inventario ni Catalog-.
 *
 * Una ranura ya vacia es un 409 de dominio (`EquipmentSlotEmptyError`, ver
 * `HeroLoadout.unequip`), nunca un 500: idempotencia semantica sin fingir
 * exito sobre un estado que no cambio.
 */
export class UnequipItemFromHero {
  private readonly inventories: InventoryQueryPort
  private readonly catalog: CatalogReadPort
  private readonly loadouts: HeroLoadoutRepositoryPort
  private readonly clock: ClockPort
  private readonly battles: BattleStatePort
  private readonly progressions: HeroProgressionRepositoryPort

  constructor(
    inventories: InventoryQueryPort,
    catalog: CatalogReadPort,
    loadouts: HeroLoadoutRepositoryPort,
    clock: ClockPort,
    battles: BattleStatePort,
    progressions: HeroProgressionRepositoryPort,
  ) {
    this.inventories = inventories
    this.catalog = catalog
    this.loadouts = loadouts
    this.clock = clock
    this.battles = battles
    this.progressions = progressions
  }

  async execute(command: UnequipItemFromHeroCommand): Promise<HeroEquipmentDto> {
    const owner = PlayerId.create(command.ownerId)
    const slot = parseEquipmentSlot(command.slot)
    const deps = {
      inventories: this.inventories,
      catalog: this.catalog,
      progressions: this.progressions,
    }

    // 1. El heroe pertenece al jugador y es un HEROE canonico.
    const hero = await resolveOwnedHero(deps, owner, command.heroReference)

    // 2. HU-29 precede a TODA mutacion del loadout, igual que al equipar.
    const battleActive = await this.battles.isHeroInActiveBattle(owner, hero.heroProduct.productId)
    const decision = decideEquipmentChange(battleActive, categoryOfSlot(slot))
    if (!decision.ok) {
      throw new EquipmentLockedDuringBattleError(decision.message)
    }

    // 3. Estado resultante: el agregado exige que la ranura este ocupada
    //    (`EquipmentSlotEmptyError` si no) y borra solo esa asociacion.
    const loadout = await this.loadouts.findByHero(owner, hero.heroProduct.productId)
    const current = loadout ?? HeroLoadout.createEmpty(owner.value, hero.heroProduct.productId)
    const expectedVersion = current.version

    current.unequip({ slot, occurredAt: this.clock.now() })

    // 4. Persistencia atomica con bloqueo optimista (lanza HeroLoadoutConflictError).
    const saved = await this.loadouts.save(current, expectedVersion)

    // 5. Nuevo estado consistente, con stats/effects/capacity recalculados por
    //    el MISMO ensamblador que usa Equip -nunca se duplica la formula-.
    return { ...(await assembleEquipmentView(deps, hero, saved)), locked: false }
  }
}
