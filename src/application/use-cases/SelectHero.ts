import { HeroLoadout } from '../../domain/entities/HeroLoadout'
import { HeroSelection } from '../../domain/entities/HeroSelection'
import { ACTIVE_LIFECYCLE_STATUS } from '../../domain/policies/HeroReadinessPolicy'
import { PlayerId } from '../../domain/value-objects/identifiers'
import type { HeroSelectionDto } from '../dto/HeroSelectionDto'
import { HeroNotSelectableError } from '../errors/ApplicationError'
import type { ClockPort } from '../ports/ClockPort'
import type { CatalogReadPort } from '../ports/CatalogReadPort'
import type { HeroLoadoutRepositoryPort } from '../ports/HeroLoadoutRepositoryPort'
import type { HeroSelectionRepositoryPort } from '../ports/HeroSelectionRepositoryPort'
import type { InventoryQueryPort } from '../ports/InventoryQueryPort'
import { resolveOwnedHero } from './hero-equipment-shared'
import { assembleSelectionView } from './hero-selection-shared'

/**
 * Prepara un heroe del jugador autenticado (HU-07, CA-01 y CA-02).
 *
 * LA PERTENENCIA SE COMPRUEBA CON EL MISMO CODIGO QUE HU-28. `resolveOwnedHero`
 * es literalmente el helper que usa el equipamiento: la referencia debe estar
 * en el inventario del jugador y Catalog debe declararla HEROE. Reescribir esa
 * comprobacion aqui daria dos definiciones de "heroe propio" que podrian
 * separarse con el tiempo.
 *
 * SE EXIGE QUE EL HEROE ESTE ACTIVO (CA-11: "el catalogo VIGENTE"). Un heroe
 * suspendido se rechaza con `HeroNotSelectableError` (409) y no con un 404: el
 * jugador SI lo tiene, y decirle que no lo tiene le mandaria a buscar donde no
 * es. Un heroe que se suspende DESPUES de elegirlo no se desprepara solo: eso
 * lo informa la politica de disponibilidad como impedimento, sin destruir nada.
 *
 * ES IDEMPOTENTE. Volver a elegir el heroe ya preparado devuelve la
 * configuracion sin escribir ni mover la fecha: un doble clic no debe parecer
 * un cambio.
 *
 * NO TOCA EL EQUIPAMIENTO. Cambiar de heroe conserva el loadout de cada uno.
 */
export class SelectHero {
  constructor(
    private readonly inventories: InventoryQueryPort,
    private readonly catalog: CatalogReadPort,
    private readonly loadouts: HeroLoadoutRepositoryPort,
    private readonly selections: HeroSelectionRepositoryPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(ownerId: string, heroReference: string): Promise<HeroSelectionDto> {
    const owner = PlayerId.create(ownerId)
    const deps = { inventories: this.inventories, catalog: this.catalog }

    const hero = await resolveOwnedHero(deps, owner, heroReference)

    if (hero.heroProduct.lifecycleStatus !== ACTIVE_LIFECYCLE_STATUS) {
      throw new HeroNotSelectableError(heroReference)
    }

    const heroId = hero.heroProduct.productId
    const current = await this.selections.findByOwner(owner)

    const selection =
      current?.isFor(heroId) === true
        ? current
        : await this.selections.save(
            current === null
              ? HeroSelection.create(owner.value, heroId, this.clock.now())
              : current.selectAnother(heroId, this.clock.now()),
            current?.version ?? 0,
          )

    const loadout =
      (await this.loadouts.findByHero(owner, heroId)) ??
      HeroLoadout.createEmpty(owner.value, heroId)

    return assembleSelectionView(deps, owner, hero, loadout, selection.selectedAt)
  }
}
