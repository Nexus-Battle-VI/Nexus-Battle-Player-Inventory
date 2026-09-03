import {
  ListOwnedInventoryItems,
  MIN_SEARCH_LENGTH,
  OWNED_ITEMS_PAGE_SIZE,
} from '../../src/application/use-cases/ListOwnedInventoryItems'
import { InMemoryInventoryRepository } from '../../src/adapters/outbound/persistence/InMemoryInventoryRepository'
import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import { CatalogUnavailableError } from '../../src/application/ports/CatalogReadPort'
import type { CatalogProductView } from '../../src/application/ports/CatalogReadPort'
import { CapacityPolicy } from '../../src/domain/policies/CapacityPolicy'
import { Inventory } from '../../src/domain/entities/Inventory'
import { ItemId, PlayerId, Quantity } from '../../src/domain/value-objects/identifiers'
import { DomainError } from '../../src/domain/errors/DomainError'

const FIXED_NOW = new Date('2026-08-21T10:00:00.000Z')
const OWNER = 'sujeto-1'

const itemId = (index: number): string => `item-${String(index).padStart(3, '0')}`

const product = (
  index: number,
  overrides: Partial<CatalogProductView> = {},
): CatalogProductView => ({
  productId: `pid-${String(index).padStart(3, '0')}`,
  sku: itemId(index),
  name: `Producto ${String(index)}`,
  imageUrl: `https://assets.example.test/p-${String(index)}.png`,
  description: `Descripción ${String(index)}`,
  type: 'ARMA',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 10,
  premium: false,
  realMoneyPrice: null,
  attributes: { schemaVersion: '1' },
  ...overrides,
})

const seedInventory = async (
  repository: InMemoryInventoryRepository,
  owner: string,
  count: number,
): Promise<void> => {
  const capacity = Math.min(CapacityPolicy.MAX_CAPACITY, Math.max(count, 1))
  const inventory = Inventory.createEmpty(PlayerId.create(owner), CapacityPolicy.of(capacity))

  for (let index = count - 1; index >= 0; index -= 1) {
    inventory.add(ItemId.create(itemId(index)), Quantity.create(index + 1), FIXED_NOW)
  }

  await repository.save(inventory)
}

const build = (options: {
  readonly inventoryCount: number
  readonly catalog?: readonly CatalogProductView[]
  readonly catalogUnavailable?: boolean
}): { useCase: ListOwnedInventoryItems; repo: InMemoryInventoryRepository } => {
  const repo = new InMemoryInventoryRepository()
  const catalog = new InMemoryCatalogReadClient(
    options.catalog ?? [],
    options.catalogUnavailable ?? false,
  )

  return { repo, useCase: new ListOwnedInventoryItems(repo, catalog) }
}

describe('ListOwnedInventoryItems — paginación', () => {
  it('expone el tamaño de página de RF-27 y el umbral de búsqueda', () => {
    expect(OWNED_ITEMS_PAGE_SIZE).toBe(16)
    expect(MIN_SEARCH_LENGTH).toBe(4)
  })

  it('un jugador sin inventario devuelve una página vacía con totalPages 0', async () => {
    const { useCase } = build({ inventoryCount: 0 })

    await expect(useCase.execute({ ownerId: 'nadie', page: 1 })).resolves.toEqual({
      items: [],
      page: 1,
      pageSize: 16,
      totalItems: 0,
      totalPages: 0,
    })
  })

  it.each([
    [1, 1],
    [15, 1],
    [16, 1],
    [17, 2],
    [32, 2],
    [33, 3],
  ])('con %i ítems calcula totalItems y totalPages = %i', async (count, totalPages) => {
    const { useCase, repo } = build({ inventoryCount: count })
    await seedInventory(repo, OWNER, count)

    const result = await useCase.execute({ ownerId: OWNER, page: 1 })

    expect(result.totalItems).toBe(count)
    expect(result.totalPages).toBe(totalPages)
    expect(result.pageSize).toBe(16)
  })

  it('la primera página contiene 16 ítems ordenados por itemId', async () => {
    const { useCase, repo } = build({ inventoryCount: 17 })
    await seedInventory(repo, OWNER, 17)

    const result = await useCase.execute({ ownerId: OWNER, page: 1 })

    expect(result.items).toHaveLength(16)
    expect(result.items.map((item) => item.itemId)).toEqual(
      Array.from({ length: 16 }, (_, index) => itemId(index)),
    )
  })

  it('la segunda página contiene el resto', async () => {
    const { useCase, repo } = build({ inventoryCount: 17 })
    await seedInventory(repo, OWNER, 17)

    const result = await useCase.execute({ ownerId: OWNER, page: 2 })

    expect(result.items.map((item) => item.itemId)).toEqual([itemId(16)])
    expect(result.totalItems).toBe(17)
  })

  it('una página válida más allá del total devuelve items vacíos y los metadatos reales', async () => {
    const { useCase, repo } = build({ inventoryCount: 33 })
    await seedInventory(repo, OWNER, 33)

    await expect(useCase.execute({ ownerId: OWNER, page: 99 })).resolves.toEqual({
      items: [],
      page: 99,
      pageSize: 16,
      totalItems: 33,
      totalPages: 3,
    })
  })

  it.each([
    ['cero', 0],
    ['negativa', -1],
    ['fraccionaria', 2.5],
    ['no numérica', Number.NaN],
  ])('rechaza una página %s como error de dominio', async (_caso, page) => {
    const { useCase, repo } = build({ inventoryCount: 5 })
    await seedInventory(repo, OWNER, 5)

    await expect(useCase.execute({ ownerId: OWNER, page })).rejects.toBeInstanceOf(DomainError)
  })

  it('rechaza un identificador de jugador vacío', async () => {
    const { useCase } = build({ inventoryCount: 0 })

    await expect(useCase.execute({ ownerId: '   ', page: 1 })).rejects.toBeInstanceOf(DomainError)
  })
})

describe('ListOwnedInventoryItems — enriquecido con Catalog', () => {
  it('adjunta el resumen del producto a cada ítem del listado', async () => {
    const { useCase, repo } = build({
      inventoryCount: 2,
      catalog: [product(0, { name: 'Espada' }), product(1, { name: 'Escudo' })],
    })
    await seedInventory(repo, OWNER, 2)

    const result = await useCase.execute({ ownerId: OWNER, page: 1 })

    expect(result.items[0]?.product).toMatchObject({ sku: itemId(0), name: 'Espada', type: 'ARMA' })
    expect(result.items[1]?.product?.name).toBe('Escudo')
  })

  it('un listado sin búsqueda NO se cae si Catalog no responde: product queda en null', async () => {
    const { useCase, repo } = build({ inventoryCount: 2, catalogUnavailable: true })
    await seedInventory(repo, OWNER, 2)

    const result = await useCase.execute({ ownerId: OWNER, page: 1 })

    expect(result.totalItems).toBe(2)
    expect(result.items.every((item) => item.product === null)).toBe(true)
  })
})

describe('ListOwnedInventoryItems — búsqueda (RF-27)', () => {
  const catalog = [
    product(0, { name: 'Espada Larga' }),
    product(1, { name: 'Espada Corta' }),
    product(2, { name: 'Escudo Torre' }),
    product(3, { name: 'Poción de Vida', type: 'ITEM' }),
  ]

  it.each([
    ['vacío', ''],
    ['1 carácter', 'e'],
    ['3 caracteres', 'esp'],
  ])('con un término de %s no ejecuta búsqueda: devuelve el listado completo', async (_caso, q) => {
    const { useCase, repo } = build({ inventoryCount: 4, catalog })
    await seedInventory(repo, OWNER, 4)

    const result = await useCase.execute({ ownerId: OWNER, page: 1, query: q })

    expect(result.totalItems).toBe(4)
  })

  it('con 4 caracteres filtra por nombre dentro del inventario poseído', async () => {
    const { useCase, repo } = build({ inventoryCount: 4, catalog })
    await seedInventory(repo, OWNER, 4)

    const result = await useCase.execute({ ownerId: OWNER, page: 1, query: 'espa' })

    expect(result.totalItems).toBe(2)
    expect(result.items.map((item) => item.product?.name).sort()).toEqual([
      'Espada Corta',
      'Espada Larga',
    ])
  })

  it('con más de 4 caracteres afina el resultado', async () => {
    const { useCase, repo } = build({ inventoryCount: 4, catalog })
    await seedInventory(repo, OWNER, 4)

    const result = await useCase.execute({ ownerId: OWNER, page: 1, query: 'espada larga' })

    expect(result.items.map((item) => item.product?.name)).toEqual(['Espada Larga'])
  })

  it('sin coincidencias devuelve página vacía con totalPages 0', async () => {
    const { useCase, repo } = build({ inventoryCount: 4, catalog })
    await seedInventory(repo, OWNER, 4)

    await expect(
      useCase.execute({ ownerId: OWNER, page: 1, query: 'martillo' }),
    ).resolves.toMatchObject({ items: [], totalItems: 0, totalPages: 0 })
  })

  it('la metadata de paginación se calcula sobre el resultado FILTRADO, no sobre el inventario', async () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      product(index, { name: index < 20 ? `Espada N${String(index)}` : `Otro N${String(index)}` }),
    )
    const { useCase, repo } = build({ inventoryCount: 40, catalog: many })
    await seedInventory(repo, OWNER, 40)

    const first = await useCase.execute({ ownerId: OWNER, page: 1, query: 'espada' })
    const second = await useCase.execute({ ownerId: OWNER, page: 2, query: 'espada' })

    expect(first.totalItems).toBe(20)
    expect(first.totalPages).toBe(2)
    expect(first.items).toHaveLength(16)
    expect(second.items).toHaveLength(4)
  })

  it('la búsqueda nunca devuelve un producto que el jugador no posee', async () => {
    const { useCase, repo } = build({
      inventoryCount: 1,
      catalog: [product(0, { name: 'Espada Poseída' }), product(99, { name: 'Espada Ajena' })],
    })
    await seedInventory(repo, OWNER, 1)

    const result = await useCase.execute({ ownerId: OWNER, page: 1, query: 'espada' })

    expect(result.items.map((item) => item.product?.name)).toEqual(['Espada Poseída'])
  })

  it('el filtro por tipo también restringe el listado', async () => {
    const { useCase, repo } = build({ inventoryCount: 4, catalog })
    await seedInventory(repo, OWNER, 4)

    const result = await useCase.execute({ ownerId: OWNER, page: 1, type: 'ITEM' })

    expect(result.items.map((item) => item.product?.name)).toEqual(['Poción de Vida'])
  })

  it('propaga CatalogUnavailableError cuando hay búsqueda y Catalog no responde', async () => {
    const { useCase, repo } = build({ inventoryCount: 4, catalogUnavailable: true })
    await seedInventory(repo, OWNER, 4)

    await expect(
      useCase.execute({ ownerId: OWNER, page: 1, query: 'espada' }),
    ).rejects.toBeInstanceOf(CatalogUnavailableError)
  })

  it('un inventario vacío con búsqueda no llama a Catalog y devuelve página vacía', async () => {
    const { useCase } = build({ inventoryCount: 0, catalogUnavailable: true })

    await expect(
      useCase.execute({ ownerId: 'nadie', page: 1, query: 'espada' }),
    ).resolves.toMatchObject({ items: [], totalItems: 0, totalPages: 0 })
  })
})
