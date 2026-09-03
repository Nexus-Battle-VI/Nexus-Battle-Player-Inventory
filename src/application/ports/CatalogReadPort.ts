/**
 * Vista de solo lectura de un producto de Catalog.
 *
 * Player/Inventory no es dueño de esta información: la obtiene por la API de
 * Catalog, nunca de su base de datos. Lo que aquí se declara es únicamente lo
 * que HU-27 necesita para el listado y la ficha del inventario; `attributes`
 * viaja opaco (habilidades y efectos canónicos) sin que este contexto lo
 * interprete.
 */
export interface CatalogProductView {
  readonly productId: string
  readonly sku: string
  readonly name: string
  readonly imageUrl: string
  readonly description: string
  readonly type: string
  readonly lifecycleStatus: string
  readonly creditsPrice: number
  readonly premium: boolean
  readonly realMoneyPrice: { readonly amount: number; readonly currency: string } | null
  readonly attributes: unknown
}

export interface CatalogLookupQuery {
  /** productId (UUID) o alias sku de cada producto poseído por el jugador. */
  readonly references: readonly string[]
  /** Substring del nombre a filtrar. La regla de "desde 4 caracteres" es del consumidor. */
  readonly nameQuery?: string
  /** Tipo canónico a filtrar (`HEROE`, `ARMA`, ...). */
  readonly type?: string
}

/**
 * Puerto de salida hacia el contrato de LECTURA canónica de Catalog.
 *
 * `lookup` resuelve muchas referencias de una vez: la consulta del inventario
 * nunca hace una petición por ítem.
 */
export interface CatalogReadPort {
  /** Recupera un producto por su referencia. `null` si Catalog no lo conoce. */
  getByReference(reference: string): Promise<CatalogProductView | null>

  /**
   * Resuelve varias referencias en una sola llamada. Solo devuelve productos
   * dentro del conjunto pedido: la búsqueda no puede traer productos ajenos.
   */
  lookup(query: CatalogLookupQuery): Promise<readonly CatalogProductView[]>
}

/**
 * Catalog no pudo responder (red, tiempo de espera, 5xx, o sin configurar).
 *
 * Es distinto de "el producto no existe": eso lo expresa `null`. Este error
 * significa que la información vigente del producto no se pudo comprobar, y una
 * operación que la necesita debe fallar con 503, no fingir que está completa.
 */
export class CatalogUnavailableError extends Error {
  constructor(detail: string) {
    super(`No se pudo consultar Catalog: ${detail}`)
    this.name = 'CatalogUnavailableError'
  }
}

export const CATALOG_READ = Symbol('CatalogReadPort')
