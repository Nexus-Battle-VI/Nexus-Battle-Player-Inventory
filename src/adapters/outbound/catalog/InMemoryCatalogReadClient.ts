import {
  CatalogUnavailableError,
  type CatalogLookupQuery,
  type CatalogProductView,
  type CatalogReadPort,
} from '../../../application/ports/CatalogReadPort'

/**
 * Doble en proceso del contrato de lectura de Catalog.
 *
 * Sirve para las pruebas del dominio y de los casos de uso sin red, y como
 * adaptador por defecto cuando `CATALOG_BASE_URL` no está configurado: en ese
 * caso `unavailable` es `true` y toda consulta lanza `CatalogUnavailableError`,
 * de modo que la búsqueda y la ficha responden 503 en lugar de inventar datos.
 */
export class InMemoryCatalogReadClient implements CatalogReadPort {
  private readonly byReference = new Map<string, CatalogProductView>()

  constructor(
    products: readonly CatalogProductView[] = [],
    private readonly unavailable = false,
  ) {
    for (const product of products) {
      this.byReference.set(product.productId, product)
      this.byReference.set(product.sku, product)
    }
  }

  getByReference(reference: string): Promise<CatalogProductView | null> {
    if (this.unavailable) {
      return Promise.reject(
        new CatalogUnavailableError('cliente en memoria marcado como no disponible'),
      )
    }

    return Promise.resolve(this.byReference.get(reference.trim()) ?? null)
  }

  lookup(query: CatalogLookupQuery): Promise<readonly CatalogProductView[]> {
    if (this.unavailable) {
      return Promise.reject(
        new CatalogUnavailableError('cliente en memoria marcado como no disponible'),
      )
    }

    const wanted = new Set(query.references)
    const normalizedQuery = query.nameQuery?.normalize('NFKC').toLocaleLowerCase('es')
    const seen = new Set<string>()
    const items: CatalogProductView[] = []

    for (const product of this.byReference.values()) {
      if (seen.has(product.productId)) continue
      if (!wanted.has(product.productId) && !wanted.has(product.sku)) continue
      if (query.type !== undefined && product.type !== query.type) continue
      if (
        normalizedQuery !== undefined &&
        !product.name.normalize('NFKC').toLocaleLowerCase('es').includes(normalizedQuery)
      ) {
        continue
      }

      seen.add(product.productId)
      items.push(product)
    }

    items.sort((left, right) => left.name.localeCompare(right.name))

    return Promise.resolve(items)
  }
}
