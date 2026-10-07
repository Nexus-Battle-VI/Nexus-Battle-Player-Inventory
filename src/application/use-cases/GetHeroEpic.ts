import { PlayerId } from '../../domain/value-objects/identifiers'
import type { HeroEpicDto } from '../dto/HeroEpicDto'
import type { BattleStatePort } from '../ports/BattleStatePort'
import type { CatalogReadPort } from '../ports/CatalogReadPort'
import type { HeroEpicSelectionRepositoryPort } from '../ports/HeroEpicSelectionRepositoryPort'
import type { InventoryQueryPort } from '../ports/InventoryQueryPort'
import { resolveOwnedHero } from './hero-equipment-shared'
import { resolveHeroEpic } from './hero-profile-shared'

/**
 * Consulta de la epica equipada de un heroe propio (HU-31, contrato
 * `hu-31-equipped-epic-v1` §11). Solo lee, mismo criterio que
 * `GetHeroEquipment`: la identidad del jugador proviene del sujeto
 * verificado del testimonio, nunca de un parametro del cliente.
 */
export class GetHeroEpic {
  constructor(
    private readonly inventories: InventoryQueryPort,
    private readonly catalog: CatalogReadPort,
    private readonly epicSelections: HeroEpicSelectionRepositoryPort,
    private readonly battles: BattleStatePort,
  ) {}

  async execute(ownerId: string, heroReference: string): Promise<HeroEpicDto> {
    const owner = PlayerId.create(ownerId)
    const deps = { inventories: this.inventories, catalog: this.catalog }

    const hero = await resolveOwnedHero(deps, owner, heroReference)
    const heroId = hero.heroProduct.productId

    const selection = await this.epicSelections.findByHero(owner, heroId)
    const epicProductId = selection?.epicProductId ?? null
    const epic =
      epicProductId === null
        ? null
        : await resolveHeroEpic(this.catalog, hero.heroView.heroSubtype, { epicProductId })

    // Se consulta DESPUES de resolver la pertenencia del heroe, mismo
    // criterio que `GetHeroEquipment`: el estado de batalla no debe ser un
    // canal para deducir que heroes ajenos existen.
    const locked = await this.battles.isHeroInActiveBattle(owner, heroId)

    return { heroId, epic, version: selection?.version ?? 0, locked }
  }
}
