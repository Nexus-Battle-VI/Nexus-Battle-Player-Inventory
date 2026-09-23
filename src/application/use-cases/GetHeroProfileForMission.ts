import { HeroLoadout } from '../../domain/entities/HeroLoadout'
import { DomainError } from '../../domain/errors/DomainError'
import { PlayerId } from '../../domain/value-objects/identifiers'
import type { HeroProfileDto } from '../dto/HeroProfileDto'
import type { CatalogReadPort } from '../ports/CatalogReadPort'
import type { HeroLoadoutRepositoryPort } from '../ports/HeroLoadoutRepositoryPort'
import type { InventoryQueryPort } from '../ports/InventoryQueryPort'
import { assembleEquipmentView, resolveOwnedHero } from './hero-equipment-shared'
import { resolveHeroAbilities, toEquippedHeroEffect } from './hero-profile-shared'

/**
 * Perfil de un heroe CONCRETO del jugador, para el contrato interno de Missions
 * (HU-71, Management#56/#370; ruta `GET /api/internal/v1/players/{playerId}/heroes/{heroId}`).
 *
 * PARA QUE EXISTE. Missions valida al guardar una estrategia de rotaciones que
 * cada `ABILITY` use una habilidad que el heroe TIENE (P-R4 del diseno de HU-71),
 * y ademas congela el perfil del heroe en la solicitud de simulacion de HU-72.
 * Hasta ahora Player/Inventory solo publicaba el heroe **seleccionado**
 * (`equipped-hero`, para Combat), y el heroe de una estrategia no tiene por que
 * ser el seleccionado.
 *
 * SOLO LEE, Y NO DUPLICA NINGUNA REGLA:
 *   - la pertenencia la decide `resolveOwnedHero`, la MISMA funcion que sirve la
 *     consulta publica de equipamiento (HU-28): la referencia debe estar en el
 *     inventario del jugador (por `itemId` o por el `sku` de Catalog), Catalog
 *     debe conocerla y su tipo tiene que ser `HEROE`. Cualquier otro caso es
 *     `HeroNotOwnedError` (404) por la misma politica anti-enumeracion del resto
 *     del servicio.
 *   - el equipamiento (estadisticas base y efectivas, y efectos) lo produce
 *     `assembleEquipmentView`, que es el MISMO calculo de HU-28 en una sola
 *     pasada y con una sola llamada a Catalog.
 *   - las habilidades las resuelve `resolveHeroAbilities`, compartido con
 *     `GetEquippedHeroForCombat`: una `lookup` para todas, en el orden de Catalog,
 *     omitiendo la que no cumpla el contrato canonico y propagando el fallo de
 *     Catalog (503).
 *
 * LA CREACION DEL LOADOUT ES PEREZOSA, como en la consulta publica: un heroe sin
 * documento de equipamiento se interpreta como `HeroLoadout.createEmpty` (nivel 0
 * de version) y **no** se escribe nada. Una lectura no crea estado.
 *
 * NO DEVUELVE `ready`, `blockers` NI `selectedAt`: ver `HeroProfileDto`.
 */
export class GetHeroProfileForMission {
  constructor(
    private readonly inventories: InventoryQueryPort,
    private readonly catalog: CatalogReadPort,
    private readonly loadouts: HeroLoadoutRepositoryPort,
  ) {}

  async execute(playerId: string, heroId: string): Promise<HeroProfileDto> {
    const owner = PlayerId.create(playerId)
    const heroReference = requireHeroReference(heroId)
    const deps = { inventories: this.inventories, catalog: this.catalog }

    const hero = await resolveOwnedHero(deps, owner, heroReference)
    const loadout =
      (await this.loadouts.findByHero(owner, hero.heroProduct.productId)) ??
      HeroLoadout.createEmpty(owner.value, hero.heroProduct.productId)

    const view = await assembleEquipmentView(deps, hero, loadout)
    const abilities = await resolveHeroAbilities(this.catalog, hero.heroProduct.productId)

    return {
      playerId,
      // El `productId` canonico, no la referencia pedida: el consumidor compara
      // este campo con el `heroId` que envio.
      heroId: hero.heroProduct.productId,
      reference: hero.ownedItemId,
      subtype: hero.heroView.heroSubtype,
      name: hero.heroProduct.name,
      baseStats: view.baseStats,
      effectiveStats: view.effectiveStats,
      activeEffects: view.activeEffects.map(toEquippedHeroEffect),
      abilities,
      loadoutVersion: loadout.version,
    }
  }
}

/**
 * Un `heroId` vacio es un error de la peticion (400), no un heroe ajeno (404):
 * sin identificador no hay nada que resolver y no se consulta a Catalog.
 */
const requireHeroReference = (raw: string): string => {
  const normalized = raw.trim()

  if (normalized.length === 0) {
    throw new DomainError('El perfil necesita un heroe.')
  }

  return normalized
}
