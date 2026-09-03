import { HeroLoadout } from '../../domain/entities/HeroLoadout'
import { PlayerId } from '../../domain/value-objects/identifiers'
import type { HeroEquipmentDto } from '../dto/HeroEquipmentDto'
import type { CatalogReadPort } from '../ports/CatalogReadPort'
import type { HeroLoadoutRepositoryPort } from '../ports/HeroLoadoutRepositoryPort'
import type { InventoryQueryPort } from '../ports/InventoryQueryPort'
import { assembleEquipmentView, resolveOwnedHero } from './hero-equipment-shared'

/**
 * Consulta de la configuracion de equipamiento de un heroe propio (RF-28, CA-09).
 *
 * Solo lee. La identidad del jugador proviene del sujeto verificado del
 * testimonio. Comprueba pertenencia del heroe, resuelve las piezas equipadas en
 * una sola llamada a Catalog y devuelve estadisticas base, efectivas y efectos.
 *
 * - Heroe no propio / inexistente / no es un HEROE: `HeroNotOwnedError` -> 404.
 * - Catalog no disponible: `CatalogUnavailableError` -> 503.
 */
export class GetHeroEquipment {
  private readonly inventories: InventoryQueryPort
  private readonly catalog: CatalogReadPort
  private readonly loadouts: HeroLoadoutRepositoryPort

  constructor(
    inventories: InventoryQueryPort,
    catalog: CatalogReadPort,
    loadouts: HeroLoadoutRepositoryPort,
  ) {
    this.inventories = inventories
    this.catalog = catalog
    this.loadouts = loadouts
  }

  async execute(ownerId: string, heroReference: string): Promise<HeroEquipmentDto> {
    const owner = PlayerId.create(ownerId)
    const deps = { inventories: this.inventories, catalog: this.catalog }

    const hero = await resolveOwnedHero(deps, owner, heroReference)

    const loadout =
      (await this.loadouts.findByHero(owner, hero.heroProduct.productId)) ??
      HeroLoadout.createEmpty(owner.value, hero.heroProduct.productId)

    return assembleEquipmentView(deps, hero, loadout)
  }
}
