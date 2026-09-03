import { HeroLoadout } from '../../domain/entities/HeroLoadout'
import { PlayerId } from '../../domain/value-objects/identifiers'
import type { HeroSelectionDto } from '../dto/HeroSelectionDto'
import { NoHeroSelectedError } from '../errors/ApplicationError'
import type { CatalogReadPort } from '../ports/CatalogReadPort'
import type { HeroLoadoutRepositoryPort } from '../ports/HeroLoadoutRepositoryPort'
import type { HeroSelectionRepositoryPort } from '../ports/HeroSelectionRepositoryPort'
import type { InventoryQueryPort } from '../ports/InventoryQueryPort'
import { resolveOwnedHero } from './hero-equipment-shared'
import { assembleSelectionView } from './hero-selection-shared'

/**
 * Configuracion preparada del jugador autenticado (HU-07, CA-01).
 *
 * Solo lee. La identidad sale del sujeto verificado del testimonio y NUNCA de
 * la peticion: no hay identificador manipulable con el que ver la preparacion
 * de otra persona (CA-06, y la condicion de finalizacion de la TASK HU-07.2
 * sobre aislamiento entre jugadores).
 *
 * - Sin seleccion: `NoHeroSelectedError` -> 404.
 * - El heroe salio del inventario despues de elegirlo: `HeroNotOwnedError` ->
 *   404. Se dice que ya no dispone de ese heroe, que es la verdad, en vez de
 *   devolver una configuracion sobre un heroe que no tiene.
 * - Catalog no responde: `CatalogUnavailableError` -> 503.
 */
export class GetHeroSelection {
  constructor(
    private readonly inventories: InventoryQueryPort,
    private readonly catalog: CatalogReadPort,
    private readonly loadouts: HeroLoadoutRepositoryPort,
    private readonly selections: HeroSelectionRepositoryPort,
  ) {}

  async execute(ownerId: string): Promise<HeroSelectionDto> {
    const owner = PlayerId.create(ownerId)
    const selection = await this.selections.findByOwner(owner)

    if (selection === null) {
      throw new NoHeroSelectedError()
    }

    const deps = { inventories: this.inventories, catalog: this.catalog }
    const hero = await resolveOwnedHero(deps, owner, selection.heroId)

    const loadout =
      (await this.loadouts.findByHero(owner, hero.heroProduct.productId)) ??
      HeroLoadout.createEmpty(owner.value, hero.heroProduct.productId)

    return assembleSelectionView(deps, owner, hero, loadout, selection.selectedAt)
  }
}
