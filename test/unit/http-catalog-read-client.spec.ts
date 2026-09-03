import { HttpCatalogReadClient } from '../../src/adapters/outbound/catalog/HttpCatalogReadClient'
import { CatalogUnavailableError } from '../../src/application/ports/CatalogReadPort'

const PRODUCT = {
  productId: '3f6af5b5-5f43-4dd8-93cb-e8e73355ae42',
  sku: 'espada-de-fuego',
  name: 'Espada de Fuego',
  imageUrl: 'https://assets.example.test/espada.webp',
  description: 'Espada de dos manos',
  type: 'ARMA',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 40,
  premium: false,
  realMoneyPrice: null,
  attributes: { schemaVersion: '1' },
}

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as Response

const client = (fetchImpl: typeof fetch): HttpCatalogReadClient =>
  new HttpCatalogReadClient({ baseUrl: 'http://catalog:3003/', timeoutMs: 500, fetch: fetchImpl })

describe('HttpCatalogReadClient — getByReference', () => {
  it('recupera y proyecta un producto (200)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, PRODUCT))

    const view = await client(fetchImpl).getByReference('espada-de-fuego')

    expect(view).toMatchObject({
      productId: PRODUCT.productId,
      sku: 'espada-de-fuego',
      name: 'Espada de Fuego',
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://catalog:3003/api/v1/catalog/products/espada-de-fuego',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('devuelve null ante 404', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(404, { message: 'no existe' }))

    await expect(client(fetchImpl).getByReference('fantasma')).resolves.toBeNull()
  })

  it('traduce un 5xx a CatalogUnavailableError', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(502, {}))

    await expect(client(fetchImpl).getByReference('x')).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    )
  })

  it('traduce un fallo de red o timeout a CatalogUnavailableError', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('The operation was aborted'))

    await expect(client(fetchImpl).getByReference('x')).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    )
  })

  it('traduce una respuesta con forma inesperada a CatalogUnavailableError', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { productId: 123 }))

    await expect(client(fetchImpl).getByReference('x')).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    )
  })
})

describe('HttpCatalogReadClient — lookup', () => {
  it('no llama a la red cuando no hay referencias', async () => {
    const fetchImpl = jest.fn()

    await expect(client(fetchImpl).lookup({ references: [] })).resolves.toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('envía referencias, query y type y proyecta los items', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, { items: [PRODUCT] }))

    const items = await client(fetchImpl).lookup({
      references: ['espada-de-fuego', 'otro'],
      nameQuery: 'espada',
      type: 'ARMA',
    })

    expect(items).toHaveLength(1)
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({
      references: ['espada-de-fuego', 'otro'],
      query: 'espada',
      type: 'ARMA',
    })
  })

  it('traduce un 5xx a CatalogUnavailableError', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(503, {}))

    await expect(client(fetchImpl).lookup({ references: ['x'] })).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    )
  })
})
