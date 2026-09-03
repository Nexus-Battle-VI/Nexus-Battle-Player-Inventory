import { GetOwnedInventoryItemDetail } from '../../src/application/use-cases/GetOwnedInventoryItemDetail'
import { InventoryItemNotFoundError } from '../../src/application/errors/ApplicationError'
import { CatalogUnavailableError } from '../../src/application/ports/CatalogReadPort'
import type { CatalogProductView } from '../../src/application/ports/CatalogReadPort'
import { InMemoryInventoryRepository } from '../../src/adapters/outbound/persistence/InMemoryInventoryRepository'
import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import { Inventory } from '../../src/domain/entities/Inventory'
import { CapacityPolicy } from '../../src/domain/policies/CapacityPolicy'
import { ItemId, PlayerId, Quantity } from '../../src/domain/value-objects/identifiers'

const NOW = new Date('2026-09-01T00:00:00.000Z')
const OWNER = 'sujeto-1'

const view = (sku: string): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name: 'Espada de Fuego',
  imageUrl: `https://assets.example.test/${sku}.png`,
  description: 'Espada de dos manos con daño de fuego',
  type: 'ARMA',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 40,
  premium: false,
  realMoneyPrice: null,
  attributes: { schemaVersion: '1', values: { kind: 'ARMA' } },
})

const withInventory = async (items: readonly string[]): Promise<InMemoryInventoryRepository> => {
  const repo = new InMemoryInventoryRepository()
  const inventory = Inventory.createEmpty(PlayerId.create(OWNER), CapacityPolicy.of(10))
  for (const item of items) {
    inventory.add(ItemId.create(item), Quantity.create(2), NOW)
  }
  await repo.save(inventory)
  return repo
}

describe('GetOwnedInventoryItemDetail', () => {
  it('compone pertenencia, cantidad e información vigente del producto', async () => {
    const repo = await withInventory(['espada-de-fuego'])
    const useCase = new GetOwnedInventoryItemDetail(
      repo,
      new InMemoryCatalogReadClient([view('espada-de-fuego')]),
    )

    const detail = await useCase.execute(OWNER, 'espada-de-fuego')

    expect(detail).toEqual({
      itemId: 'espada-de-fuego',
      quantity: 2,
      product: {
        productId: 'pid-espada-de-fuego',
        sku: 'espada-de-fuego',
        name: 'Espada de Fuego',
        imageUrl: 'https://assets.example.test/espada-de-fuego.png',
        description: 'Espada de dos manos con daño de fuego',
        type: 'ARMA',
        lifecycleStatus: 'ACTIVE',
        creditsPrice: 40,
        premium: false,
        realMoneyPrice: null,
        attributes: { schemaVersion: '1', values: { kind: 'ARMA' } },
      },
    })
  })

  it('la ficha no incluye calificación ni comentarios', async () => {
    const repo = await withInventory(['espada-de-fuego'])
    const useCase = new GetOwnedInventoryItemDetail(
      repo,
      new InMemoryCatalogReadClient([view('espada-de-fuego')]),
    )

    const detail = await useCase.execute(OWNER, 'espada-de-fuego')

    expect(Object.keys(detail.product)).not.toEqual(expect.arrayContaining(['rating', 'comments']))
  })

  it('una referencia que el jugador no posee lanza InventoryItemNotFoundError', async () => {
    const repo = await withInventory(['espada-de-fuego'])
    const useCase = new GetOwnedInventoryItemDetail(
      repo,
      new InMemoryCatalogReadClient([view('escudo-de-dragon')]),
    )

    await expect(useCase.execute(OWNER, 'escudo-de-dragon')).rejects.toBeInstanceOf(
      InventoryItemNotFoundError,
    )
  })

  it('una referencia poseída que Catalog no conoce lanza InventoryItemNotFoundError', async () => {
    const repo = await withInventory(['reliquia-sin-catalogo'])
    const useCase = new GetOwnedInventoryItemDetail(repo, new InMemoryCatalogReadClient([]))

    await expect(useCase.execute(OWNER, 'reliquia-sin-catalogo')).rejects.toBeInstanceOf(
      InventoryItemNotFoundError,
    )
  })

  it('propaga CatalogUnavailableError cuando Catalog no responde', async () => {
    const repo = await withInventory(['espada-de-fuego'])
    const useCase = new GetOwnedInventoryItemDetail(repo, new InMemoryCatalogReadClient([], true))

    await expect(useCase.execute(OWNER, 'espada-de-fuego')).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    )
  })
})
