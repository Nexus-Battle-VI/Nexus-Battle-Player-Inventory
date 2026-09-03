import { parseHeroAttributes } from '../../domain/value-objects/equipment-effects'
import { PlayerId } from '../../domain/value-objects/identifiers'
import type { AvailableHeroDto, HeroAbilityDto } from '../dto/HeroSelectionDto'
import type { CatalogProductView, CatalogReadPort } from '../ports/CatalogReadPort'
import type { HeroSelectionRepositoryPort } from '../ports/HeroSelectionRepositoryPort'
import type { InventoryQueryPort } from '../ports/InventoryQueryPort'

const HERO_TYPE = 'HEROE'

/**
 * Heroes que el jugador puede preparar (HU-07, CA-02 y CA-11).
 *
 * EL CATALOGO MANDA, NO UNA LISTA EN EL CODIGO. La consulta cruza el inventario
 * del jugador (HU-27) con los productos de tipo HEROE del catalogo vigente. En
 * ningun punto se enumeran los ocho prototipos iniciales: un noveno heroe
 * aprobado por administracion aparece aqui sin tocar una linea, que es
 * exactamente lo que CA-11 exige. Ese es tambien el control de la prueba
 * correspondiente.
 *
 * SOLO LO QUE EL JUGADOR POSEE (CA-06). Se filtra por las referencias de su
 * inventario, asi que el catalogo completo no se filtra por esta ruta.
 *
 * DOS LLAMADAS A CATALOG COMO MUCHO, sea cual sea el numero de heroes: una para
 * los heroes y otra para todas sus habilidades juntas. Resolver las habilidades
 * heroe por heroe seria un N+1 sobre un servicio remoto.
 */
export class ListAvailableHeroes {
  constructor(
    private readonly inventories: InventoryQueryPort,
    private readonly catalog: CatalogReadPort,
    private readonly selections: HeroSelectionRepositoryPort,
  ) {}

  async execute(ownerId: string): Promise<readonly AvailableHeroDto[]> {
    const owner = PlayerId.create(ownerId)
    const owned = await this.inventories.findAllOwnedItems(owner)

    if (owned.length === 0) {
      return []
    }

    const heroes = await this.catalog.lookup({
      references: owned.map((item) => item.itemId),
      type: HERO_TYPE,
    })

    if (heroes.length === 0) {
      return []
    }

    const selection = await this.selections.findByOwner(owner)
    const ownedReferences = new Set(owned.map((item) => item.itemId))
    const parsed = heroes.flatMap((product) => {
      const view = safeHeroView(product)

      return view === null ? [] : [{ product, view }]
    })

    const abilityNames = await this.resolveAbilityNames(
      parsed.flatMap((entry) => entry.view.abilities),
    )

    return parsed
      .map(({ product, view }) => ({
        heroId: product.productId,
        // La referencia con la que el jugador lo tiene: es la que el resto de
        // rutas acepta. Si posee el UUID y no el alias, se devuelve el UUID.
        reference: ownedReferences.has(product.sku) ? product.sku : product.productId,
        subtype: view.heroSubtype,
        name: product.name,
        imageUrl: product.imageUrl,
        lifecycleStatus: product.lifecycleStatus,
        baseStats: view.baseStats,
        abilities: view.abilities.map((reference): HeroAbilityDto => ({
          reference,
          name: abilityNames.get(reference) ?? null,
        })),
        selected: selection?.isFor(product.productId) ?? false,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'es'))
  }

  private async resolveAbilityNames(
    references: readonly string[],
  ): Promise<ReadonlyMap<string, string>> {
    const unique = [...new Set(references)]

    if (unique.length === 0) {
      return new Map()
    }

    const products = await this.catalog.lookup({ references: unique })
    const byReference = new Map<string, string>()

    for (const product of products) {
      byReference.set(product.productId, product.name)
      byReference.set(product.sku, product.name)
    }

    return byReference
  }
}

/**
 * Un producto que Catalog declara HEROE pero cuyos atributos no cumplen el
 * contrato canonico se OMITE en vez de tumbar la pantalla entera.
 *
 * Catalog valida ese contrato al escribir, asi que esto no deberia ocurrir; si
 * ocurre, un solo producto mal formado no debe dejar al jugador sin poder
 * elegir ninguno de los demas. No se devuelve un heroe con estadisticas
 * inventadas: se devuelve uno menos.
 */
const safeHeroView = (
  product: CatalogProductView,
): ReturnType<typeof parseHeroAttributes> | null => {
  try {
    return parseHeroAttributes(product.attributes)
  } catch {
    return null
  }
}
