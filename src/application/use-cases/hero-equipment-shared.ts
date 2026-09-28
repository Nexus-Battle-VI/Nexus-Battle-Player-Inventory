import type { HeroLoadout } from '../../domain/entities/HeroLoadout'
import { computeEffectiveStats } from '../../domain/services/effective-stats'
import { slotsOfCategory } from '../../domain/value-objects/equipment'
import {
  parseEquippableAttributes,
  parseHeroAttributes,
  type HeroAttributeView,
} from '../../domain/value-objects/equipment-effects'
import { PlayerId } from '../../domain/value-objects/identifiers'
import { MIN_HERO_LEVEL } from '../../domain/value-objects/hero-level'
import type { HeroEquipmentDto, EquippedProductDto } from '../dto/HeroEquipmentDto'
import { HeroNotOwnedError } from '../errors/ApplicationError'
import type { CatalogProductView, CatalogReadPort } from '../ports/CatalogReadPort'
import type { HeroProgressionRepositoryPort } from '../ports/HeroProgressionRepositoryPort'
import type { InventoryQueryPort } from '../ports/InventoryQueryPort'

/** Lo minimo para resolver un heroe propio (pertenencia + catalogo). */
export interface HeroResolutionDeps {
  readonly inventories: InventoryQueryPort
  readonly catalog: CatalogReadPort
}

export interface HeroEquipmentDeps extends HeroResolutionDeps {
  /**
   * De donde sale el NIVEL del heroe (HU-08, CA-06). Player/Inventory es la unica
   * autoridad de nivel; sin documento el heroe esta en el nivel 1.
   */
  readonly progressions: HeroProgressionRepositoryPort
}

/**
 * La vista de equipamiento SIN el estado de bloqueo.
 *
 * `locked` es de HU-29 y no lo puede fabricar este ensamblador: hay tres
 * llamadores y solo uno tiene el estado de batalla delante. Ponerlo aqui
 * obligaria a inventar un valor en los otros dos, que es como se cuela un `false`
 * mentiroso. Cada llamador añade el que conoce.
 */
export type EquipmentViewWithoutLock = Omit<HeroEquipmentDto, 'locked'>

export interface ResolvedHero {
  readonly heroProduct: CatalogProductView
  readonly heroView: HeroAttributeView
  /** El `itemId` con el que el heroe figura en el inventario del jugador. */
  readonly ownedItemId: string
}

const ownedReferenceSet = (owned: readonly { readonly itemId: string }[]): ReadonlySet<string> =>
  new Set(owned.map((item) => item.itemId))

/**
 * Resuelve un heroe que el jugador posee de verdad.
 *
 * - La referencia debe figurar en el inventario del jugador (por `itemId` o por
 *   el `sku` que Catalog devuelve). Si no, `HeroNotOwnedError` (404).
 * - Catalog debe conocerla y su tipo debe ser HEROE. Si no, `HeroNotOwnedError`
 *   (404): no se revela si ese heroe existe en el catalogo de otra persona.
 * - Si Catalog no responde, se propaga `CatalogUnavailableError` (503): sin las
 *   estadisticas base no se puede construir la vista del heroe.
 */
export const resolveOwnedHero = async (
  deps: HeroResolutionDeps,
  owner: PlayerId,
  heroReference: string,
): Promise<ResolvedHero> => {
  const reference = heroReference.trim()
  const owned = await deps.inventories.findAllOwnedItems(owner)
  const ownedRefs = ownedReferenceSet(owned)

  const heroProduct = await deps.catalog.getByReference(reference)

  if (heroProduct === null) {
    throw new HeroNotOwnedError(reference)
  }
  if (heroProduct.type !== 'HEROE') {
    throw new HeroNotOwnedError(reference)
  }

  const isOwned = ownedRefs.has(reference) || ownedRefs.has(heroProduct.sku)
  if (!isOwned) {
    throw new HeroNotOwnedError(reference)
  }

  return {
    heroProduct,
    heroView: parseHeroAttributes(heroProduct.attributes),
    ownedItemId: ownedRefs.has(heroProduct.sku) ? heroProduct.sku : reference,
  }
}

const toEquippedDto = (
  slot: string,
  itemId: string,
  productId: string,
  product: CatalogProductView | undefined,
): EquippedProductDto => ({
  slot: slot as EquippedProductDto['slot'],
  itemId,
  productId,
  name: product?.name ?? itemId,
  imageUrl: product?.imageUrl ?? '',
  type: product?.type ?? 'UNKNOWN',
  lifecycleStatus: product?.lifecycleStatus ?? 'UNKNOWN',
})

/**
 * Construye la vista completa del equipamiento de un heroe: ranuras ocupadas,
 * estadisticas base y efectivas, deltas y efectos estructurados.
 *
 * Resuelve TODOS los productos equipados en una sola llamada `lookup` (sin
 * N+1). Si Catalog no responde durante esa resolucion se propaga
 * `CatalogUnavailableError` (503).
 */
export const assembleEquipmentView = async (
  deps: HeroEquipmentDeps,
  hero: ResolvedHero,
  loadout: HeroLoadout,
): Promise<EquipmentViewWithoutLock> => {
  const entries = loadout.toSnapshot().entries
  const productIds = entries.map((entry) => entry.productId)

  const products =
    productIds.length === 0 ? [] : await deps.catalog.lookup({ references: productIds })
  const byId = new Map<string, CatalogProductView>()
  for (const product of products) {
    byId.set(product.productId, product)
    byId.set(product.sku, product)
  }

  const forStats = entries.flatMap((entry) => {
    const product = byId.get(entry.productId)
    if (product === undefined) return []
    return [
      {
        slot: entry.slot,
        productId: entry.productId,
        reference: entry.itemId,
        attributes: parseEquippableAttributes(product.attributes),
      },
    ]
  })

  // CA-06: el nivel es el del propio heroe (nunca el del jugador). Lectura pura:
  // sin documento de progresion, nivel 1, y no se escribe nada.
  const progression = await deps.progressions.findByHero(
    PlayerId.create(loadout.toSnapshot().ownerId),
    hero.heroProduct.productId,
  )
  const level = progression?.level.value ?? MIN_HERO_LEVEL

  const stats = computeEffectiveStats(hero.heroView.baseStats, forStats, level)

  const dtoBySlot = new Map<string, EquippedProductDto>(
    entries.map((entry) => [
      entry.slot,
      toEquippedDto(entry.slot, entry.itemId, entry.productId, byId.get(entry.productId)),
    ]),
  )

  const armor: Record<string, EquippedProductDto | null> = {}
  for (const slot of slotsOfCategory('ARMOR')) {
    armor[slot] = dtoBySlot.get(slot) ?? null
  }

  return {
    hero: {
      heroId: hero.heroProduct.productId,
      reference: hero.ownedItemId,
      subtype: hero.heroView.heroSubtype,
      name: hero.heroProduct.name,
      imageUrl: hero.heroProduct.imageUrl,
    },
    equipment: {
      weapons: slotsOfCategory('WEAPON').flatMap((slot) => {
        const dto = dtoBySlot.get(slot)
        return dto === undefined ? [] : [dto]
      }),
      armor,
      items: slotsOfCategory('ITEM').flatMap((slot) => {
        const dto = dtoBySlot.get(slot)
        return dto === undefined ? [] : [dto]
      }),
    },
    level: stats.level,
    baseStats: stats.baseStats,
    levelStats: stats.levelStats,
    effectiveStats: stats.effectiveStats,
    deltas: stats.deltas,
    activeEffects: stats.activeEffects,
  }
}
