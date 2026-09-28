import { parseHeroAttributes } from '../../domain/value-objects/equipment-effects'
import { PlayerId } from '../../domain/value-objects/identifiers'
import type { AvailableHeroDto, HeroAbilityDto } from '../dto/HeroSelectionDto'
import type { HeroProgressionDto } from '../dto/HeroProgressionDto'
import type { CatalogProductView, CatalogReadPort } from '../ports/CatalogReadPort'
import type { HeroSelectionRepositoryPort } from '../ports/HeroSelectionRepositoryPort'
import type { InventoryQueryPort } from '../ports/InventoryQueryPort'
import type { GetHeroProgression } from './GetHeroProgression'

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
 *
 * LA PROGRESION DE CADA HEROE (auditoria 2026-09-27, HU-08/HU-09) SE RESUELVE
 * REUTILIZANDO `GetHeroProgression`: ni una segunda tabla de umbrales, ni un
 * segundo camino de lectura del agregado `HeroProgression`. Se resuelve en
 * paralelo para todos los heroes de la respuesta (`Promise.all`); son lecturas
 * LOCALES a Mongo -no llamadas a otro servicio-, asi que no es el mismo riesgo
 * de N+1 que justifica agrupar las llamadas a Catalog.
 */
export class ListAvailableHeroes {
  constructor(
    private readonly inventories: InventoryQueryPort,
    private readonly catalog: CatalogReadPort,
    private readonly selections: HeroSelectionRepositoryPort,
    private readonly getHeroProgression: GetHeroProgression,
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
    const progressions = await this.resolveProgressions(
      owner.value,
      parsed.map(({ product }) => product.productId),
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
        progression: requireProgression(progressions, product.productId),
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'es'))
  }

  /**
   * Progresion individual de cada heroe, por (jugador, heroe) -- NUNCA global
   * del jugador (HU-08: "el nivel pertenece al heroe, no al jugador"). Usar
   * `heroId` (el UUID canonico) y no `reference` evita que la progresion se
   * pierda si el jugador posee el heroe por el alias en una lista y por el UUID
   * en otra: es la misma clave que usa el agregado.
   */
  private async resolveProgressions(
    ownerId: string,
    heroIds: readonly string[],
  ): Promise<ReadonlyMap<string, HeroProgressionDto>> {
    const entries = await Promise.all(
      heroIds.map(async (heroId): Promise<readonly [string, HeroProgressionDto]> => [
        heroId,
        await this.getHeroProgression.execute(ownerId, heroId),
      ]),
    )

    return new Map(entries)
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
 * Recupera la progresion resuelta para `heroId`, sin `as` ni asercion de no
 * nulo. `resolveProgressions` pide una entrada por cada heroe de `parsed` y
 * `GetHeroProgression.execute` siempre responde -crea el estado inicial en
 * memoria cuando no hay documento, nunca lanza-, asi que esta ausencia no
 * deberia ocurrir; si ocurriera (un cambio futuro que desalinee ambas listas),
 * es un error de programacion y se dice, en vez de devolver un heroe sin
 * progresion o inventarle una.
 */
const requireProgression = (
  progressions: ReadonlyMap<string, HeroProgressionDto>,
  heroId: string,
): HeroProgressionDto => {
  const progression = progressions.get(heroId)

  if (progression === undefined) {
    throw new Error(`No se resolvio la progresion del heroe ${heroId}.`)
  }

  return progression
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
