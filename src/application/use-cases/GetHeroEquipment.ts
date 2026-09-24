import { HeroLoadout } from '../../domain/entities/HeroLoadout'
import { PlayerId } from '../../domain/value-objects/identifiers'
import type { HeroEquipmentDto } from '../dto/HeroEquipmentDto'
import type { BattleStatePort } from '../ports/BattleStatePort'
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
 *
 * HU-29: publica ademas `locked`, que dice si el loadout esta bloqueado por una
 * batalla activa. Es el mismo dato que decide el rechazo al equipar, servido para
 * que la interfaz no tenga que reimplementar la regla.
 */
export class GetHeroEquipment {
  private readonly inventories: InventoryQueryPort
  private readonly catalog: CatalogReadPort
  private readonly loadouts: HeroLoadoutRepositoryPort
  private readonly battles: BattleStatePort

  constructor(
    inventories: InventoryQueryPort,
    catalog: CatalogReadPort,
    loadouts: HeroLoadoutRepositoryPort,
    battles: BattleStatePort,
  ) {
    this.inventories = inventories
    this.catalog = catalog
    this.loadouts = loadouts
    this.battles = battles
  }

  async execute(ownerId: string, heroReference: string): Promise<HeroEquipmentDto> {
    const owner = PlayerId.create(ownerId)
    const deps = { inventories: this.inventories, catalog: this.catalog }

    const hero = await resolveOwnedHero(deps, owner, heroReference)
    const heroId = hero.heroProduct.productId

    const loadout =
      (await this.loadouts.findByHero(owner, heroId)) ??
      HeroLoadout.createEmpty(owner.value, heroId)

    // Se consulta DESPUES de resolver la pertenencia del heroe, por el mismo
    // motivo que en el caso de uso de equipar: el estado de batalla no debe ser
    // un canal para deducir que heroes ajenos existen.
    const locked = await this.battles.isHeroInActiveBattle(owner, heroId)

    return { ...(await assembleEquipmentView(deps, hero, loadout)), locked }
  }
}
