import { DomainError } from '../../domain/errors/DomainError'
import { PlayerId } from '../../domain/value-objects/identifiers'
import type {
  CatalogProductSummary,
  OwnedInventoryItemCardDto,
  PagedInventoryItemsDto,
} from '../dto/PagedInventoryItemsDto'
import type { CatalogProductView, CatalogReadPort } from '../ports/CatalogReadPort'
import { CatalogUnavailableError } from '../ports/CatalogReadPort'
import type { InventoryQueryPort, OwnedInventoryItem } from '../ports/InventoryQueryPort'

/**
 * Tamano de pagina fijado por RF-27: 16 productos por pagina. No se acepta desde
 * el cliente y no es configurable.
 */
export const OWNED_ITEMS_PAGE_SIZE = 16

/**
 * Longitud minima del termino para que la busqueda indexada se ejecute (RF-27).
 * Un termino mas corto se ignora y la consulta se comporta como un listado
 * normal.
 */
export const MIN_SEARCH_LENGTH = 4

export interface ListOwnedInventoryItemsQuery {
  readonly ownerId: string
  readonly page: number
  readonly query?: string
  readonly type?: string
}

/**
 * Consulta self-service y paginada del inventario del jugador autenticado
 * (HU-27, RF-27), con busqueda por nombre y filtro por tipo.
 *
 * No modifica el inventario ni emite eventos de dominio. El `ownerId` proviene
 * siempre del sujeto verificado del testimonio.
 *
 * - Sin busqueda ni filtro: pagina el inventario y lo enriquece con Catalog en
 *   modo "mejor esfuerzo"; si Catalog no responde, el listado se devuelve con
 *   `product: null` en vez de caerse, porque el inventario es dato propio.
 * - Con busqueda (>= 4 caracteres) o filtro por tipo: se necesita la
 *   informacion del producto, que vive en Catalog. Si Catalog no responde, la
 *   operacion falla (`CatalogUnavailableError` -> 503). El total y las paginas
 *   se calculan sobre el resultado FILTRADO, no sobre el inventario entero, y
 *   la busqueda solo puede devolver productos que el jugador posee.
 */
export class ListOwnedInventoryItems {
  private readonly inventories: InventoryQueryPort
  private readonly catalog: CatalogReadPort

  constructor(inventories: InventoryQueryPort, catalog: CatalogReadPort) {
    this.inventories = inventories
    this.catalog = catalog
  }

  async execute(query: ListOwnedInventoryItemsQuery): Promise<PagedInventoryItemsDto> {
    const owner = PlayerId.create(query.ownerId)

    if (!Number.isInteger(query.page) || query.page < 1) {
      throw new DomainError(
        `La pagina debe ser un entero mayor o igual a 1. Se recibio ${String(query.page)}.`,
      )
    }

    const term = query.query?.trim() ?? ''
    const searchTerm = term.length >= MIN_SEARCH_LENGTH ? term : undefined
    const filtering = searchTerm !== undefined || query.type !== undefined

    return filtering
      ? this.filteredPage(owner, query.page, searchTerm, query.type)
      : this.plainPage(owner, query.page)
  }

  /** Listado normal: pagina en persistencia y enriquece en modo mejor esfuerzo. */
  private async plainPage(owner: PlayerId, page: number): Promise<PagedInventoryItemsDto> {
    const { items, totalItems } = await this.inventories.listOwnedItems(
      owner,
      page,
      OWNED_ITEMS_PAGE_SIZE,
    )

    const byReference = await this.enrichBestEffort(items)

    return this.toDto(items, byReference, page, totalItems)
  }

  /** Busqueda / filtro: universo poseido -> Catalog -> intersecar -> paginar. */
  private async filteredPage(
    owner: PlayerId,
    page: number,
    searchTerm: string | undefined,
    type: string | undefined,
  ): Promise<PagedInventoryItemsDto> {
    const owned = await this.inventories.findAllOwnedItems(owner)

    if (owned.length === 0) {
      return { items: [], page, pageSize: OWNED_ITEMS_PAGE_SIZE, totalItems: 0, totalPages: 0 }
    }

    // Si Catalog no responde aqui, la excepcion se propaga: una busqueda no se
    // puede resolver sin la informacion del producto.
    const products = await this.catalog.lookup({
      references: owned.map((item) => item.itemId),
      nameQuery: searchTerm,
      type,
    })

    const byReference = indexByReference(products)
    const matched = owned.filter((item) => byReference.has(item.itemId))

    const start = (page - 1) * OWNED_ITEMS_PAGE_SIZE
    const pageItems = matched.slice(start, start + OWNED_ITEMS_PAGE_SIZE)

    return this.toDto(pageItems, byReference, page, matched.length)
  }

  private async enrichBestEffort(
    items: readonly OwnedInventoryItem[],
  ): Promise<Map<string, CatalogProductView>> {
    if (items.length === 0) {
      return new Map()
    }

    try {
      const products = await this.catalog.lookup({ references: items.map((item) => item.itemId) })
      return indexByReference(products)
    } catch (error: unknown) {
      if (error instanceof CatalogUnavailableError) {
        return new Map()
      }

      throw error
    }
  }

  private toDto(
    items: readonly OwnedInventoryItem[],
    byReference: ReadonlyMap<string, CatalogProductView>,
    page: number,
    totalItems: number,
  ): PagedInventoryItemsDto {
    return {
      items: items.map((item): OwnedInventoryItemCardDto => ({
        itemId: item.itemId,
        quantity: item.quantity,
        product: toSummary(byReference.get(item.itemId)),
      })),
      page,
      pageSize: OWNED_ITEMS_PAGE_SIZE,
      totalItems,
      // Con cero resultados no hay ninguna pagina que mostrar: totalPages 0.
      totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / OWNED_ITEMS_PAGE_SIZE),
    }
  }
}

const indexByReference = (
  products: readonly CatalogProductView[],
): Map<string, CatalogProductView> => {
  const map = new Map<string, CatalogProductView>()

  for (const product of products) {
    map.set(product.productId, product)
    map.set(product.sku, product)
  }

  return map
}

const toSummary = (product: CatalogProductView | undefined): CatalogProductSummary | null =>
  product === undefined
    ? null
    : {
        productId: product.productId,
        sku: product.sku,
        name: product.name,
        imageUrl: product.imageUrl,
        type: product.type,
        lifecycleStatus: product.lifecycleStatus,
      }
