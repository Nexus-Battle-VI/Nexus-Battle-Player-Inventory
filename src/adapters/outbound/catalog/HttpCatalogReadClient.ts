import {
  CatalogUnavailableError,
  type CatalogLookupQuery,
  type CatalogProductView,
  type CatalogReadPort,
} from '../../../application/ports/CatalogReadPort'

export interface HttpCatalogReadClientOptions {
  /** URL interna de Catalog, sin barra final. */
  readonly baseUrl: string
  readonly timeoutMs: number
  /** Inyectable para pruebas; por defecto el `fetch` global de Node. */
  readonly fetch?: typeof fetch
}

interface RawCatalogProduct {
  readonly productId?: unknown
  readonly sku?: unknown
  readonly name?: unknown
  readonly imageUrl?: unknown
  readonly description?: unknown
  readonly type?: unknown
  readonly lifecycleStatus?: unknown
  readonly creditsPrice?: unknown
  readonly premium?: unknown
  readonly realMoneyPrice?: unknown
  readonly attributes?: unknown
}

/**
 * Adaptador HTTP contra el contrato de lectura canónica de Catalog
 * (`GET /api/v1/catalog/products/:reference` y `POST .../lookup`).
 *
 * Traduce cualquier fallo que no sea "no existe" a `CatalogUnavailableError`,
 * de modo que la capa de aplicación decide el 503 sin conocer HTTP.
 */
export class HttpCatalogReadClient implements CatalogReadPort {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(options: HttpCatalogReadClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.timeoutMs = options.timeoutMs
    this.fetchImpl = options.fetch ?? fetch
  }

  async getByReference(reference: string): Promise<CatalogProductView | null> {
    const response = await this.send(
      `${this.baseUrl}/api/v1/catalog/products/${encodeURIComponent(reference)}`,
      { method: 'GET' },
    )

    if (response.status === 404) {
      return null
    }

    if (!response.ok) {
      throw new CatalogUnavailableError(
        `respuesta ${String(response.status)} al recuperar el producto`,
      )
    }

    return toView(await this.readJson(response))
  }

  async lookup(query: CatalogLookupQuery): Promise<readonly CatalogProductView[]> {
    if (query.references.length === 0) {
      return []
    }

    const response = await this.send(`${this.baseUrl}/api/v1/catalog/products/lookup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        references: [...query.references],
        ...(query.nameQuery === undefined ? {} : { query: query.nameQuery }),
        ...(query.type === undefined ? {} : { type: query.type }),
      }),
    })

    if (!response.ok) {
      throw new CatalogUnavailableError(`respuesta ${String(response.status)} en el lookup`)
    }

    const payload = await this.readJson(response)
    const items = Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : []

    return items.map((item) => toView(item))
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) })
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new CatalogUnavailableError(detail)
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json()
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new CatalogUnavailableError(`respuesta ilegible: ${detail}`)
    }
  }
}

const asString = (value: unknown, field: string): string => {
  if (typeof value !== 'string') {
    throw new CatalogUnavailableError(`el campo "${field}" del producto no es un texto`)
  }

  return value
}

const asNumber = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CatalogUnavailableError(`el campo "${field}" del producto no es un número`)
  }

  return value
}

const toView = (raw: unknown): CatalogProductView => {
  const product = (raw ?? {}) as RawCatalogProduct
  const realMoneyPrice = product.realMoneyPrice as
    { readonly amount?: unknown; readonly currency?: unknown } | null | undefined

  return {
    productId: asString(product.productId, 'productId'),
    sku: asString(product.sku, 'sku'),
    name: asString(product.name, 'name'),
    imageUrl: asString(product.imageUrl, 'imageUrl'),
    description: asString(product.description, 'description'),
    type: asString(product.type, 'type'),
    lifecycleStatus: asString(product.lifecycleStatus, 'lifecycleStatus'),
    creditsPrice: asNumber(product.creditsPrice, 'creditsPrice'),
    premium: product.premium === true,
    realMoneyPrice:
      realMoneyPrice === null || realMoneyPrice === undefined
        ? null
        : {
            amount: asNumber(realMoneyPrice.amount, 'realMoneyPrice.amount'),
            currency: asString(realMoneyPrice.currency, 'realMoneyPrice.currency'),
          },
    attributes: product.attributes ?? null,
  }
}
