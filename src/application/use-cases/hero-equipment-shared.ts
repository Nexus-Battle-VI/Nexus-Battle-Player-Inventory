import type { HeroLoadout } from '../../domain/entities/HeroLoadout'
import { computeEffectiveStats } from '../../domain/services/effective-stats'
import { slotsOfCategory } from '../../domain/value-objects/equipment'
import {
  parseEquippableAttributes,
  parseHeroAttributes,
  type HeroAttributeView,
} from '../../domain/value-objects/equipment-effects'
import type { PlayerId } from '../../domain/value-objects/identifiers'
import type { HeroEquipmentDto, EquippedProductDto } from '../dto/HeroEquipmentDto'
import { HeroNotOwnedError } from '../errors/ApplicationError'
import type { CatalogProductView, CatalogReadPort } from '../ports/CatalogReadPort'
import type { InventoryQueryPort } from '../ports/InventoryQueryPort'

export interface HeroEquipmentDeps {
  readonly inventories: InventoryQueryPort
  readonly catalog: CatalogReadPort
}

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
  deps: HeroEquipmentDeps,
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
): Promise<HeroEquipmentDto> => {
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

  const stats = computeEffectiveStats(hero.heroView.baseStats, forStats)

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
    baseStats: stats.baseStats,
    effectiveStats: stats.effectiveStats,
    deltas: stats.deltas,
    activeEffects: stats.activeEffects,
  }
}
