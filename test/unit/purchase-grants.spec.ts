import { GrantPurchasedItems } from '../../src/application/use-cases/GrantPurchasedItems'
import { InMemoryInventoryRepository } from '../../src/adapters/outbound/persistence/InMemoryInventoryRepository'
import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import {
  InventoryGrantConflictError,
  InventoryGrantRejectedError,
} from '../../src/application/ports/InventoryGrantPort'
import type {
  CatalogReadPort,
  CatalogProductView,
} from '../../src/application/ports/CatalogReadPort'
import { PlayerId, ItemId, Quantity } from '../../src/domain/value-objects/identifiers'
import { Inventory } from '../../src/domain/entities/Inventory'

/** Ninguno de estos productos es un heroe: no aporta habilidades incluidas. */
const noAbilitiesCatalog: CatalogReadPort = {
  getByReference: () => Promise.resolve(null),
  lookup: () => Promise.resolve([]),
}

const productId = '11111111-1111-4111-8111-111111111111'
const command = {
  operationId: '22222222-2222-4222-8222-222222222222',
  playerId: 'player-a',
  items: [{ productId, quantity: 2 }],
}

describe('Entrega de compras', () => {
  it('entrega un lote canonico una vez y conserva el resultado al repetir', async () => {
    const repository = new InMemoryInventoryRepository()
    const useCase = new GrantPurchasedItems(repository, noAbilitiesCatalog)
    const [first, second] = await Promise.all([useCase.execute(command), useCase.execute(command)])
    expect(second).toEqual(first)
    expect(first.applied).toBe(true)
    const inventory = await repository.findByOwner(PlayerId.create(command.playerId))
    expect(inventory?.toSnapshot().slots).toEqual([{ itemId: productId, quantity: 2 }])
  })

  it('rechaza la reutilizacion de una operacion para otro jugador o cantidad', async () => {
    const useCase = new GrantPurchasedItems(new InMemoryInventoryRepository(), noAbilitiesCatalog)
    await useCase.execute(command)
    await expect(useCase.execute({ ...command, playerId: 'player-b' })).rejects.toBeInstanceOf(
      InventoryGrantConflictError,
    )
    await expect(
      useCase.execute({ ...command, items: [{ productId, quantity: 3 }] }),
    ).rejects.toBeInstanceOf(InventoryGrantConflictError)
  })

  it('rechaza referencias legacy, productos duplicados y cantidades invalidas', async () => {
    const useCase = new GrantPurchasedItems(new InMemoryInventoryRepository(), noAbilitiesCatalog)
    await expect(
      useCase.execute({ ...command, items: [{ productId: 'espada', quantity: 1 }] }),
    ).rejects.toThrow()
    await expect(
      useCase.execute({ ...command, items: [...command.items, ...command.items] }),
    ).rejects.toThrow()
    await expect(
      useCase.execute({ ...command, items: [{ productId, quantity: 0 }] }),
    ).rejects.toThrow()
    await expect(useCase.execute({ ...command, items: [] })).rejects.toThrow()
  })

  it('conserva un rechazo terminal incluso si despues se libera espacio', async () => {
    const repository = new InMemoryInventoryRepository()
    const ownerId = PlayerId.create(command.playerId)
    await repository.save(
      Inventory.restore({ ownerId, capacity: 1, slots: [{ itemId: 'ocupado', quantity: 1 }] }),
    )
    const useCase = new GrantPurchasedItems(repository, noAbilitiesCatalog)
    const outcomes = await Promise.allSettled([useCase.execute(command), useCase.execute(command)])
    expect(
      outcomes.every(
        (outcome) =>
          outcome.status === 'rejected' && outcome.reason instanceof InventoryGrantRejectedError,
      ),
    ).toBe(true)
    const inventory = (await repository.findByOwner(ownerId))!
    inventory.remove(ItemId.create('ocupado'), Quantity.create(1), new Date())
    await repository.save(inventory)
    await expect(useCase.execute(command)).rejects.toBeInstanceOf(InventoryGrantRejectedError)
    expect((await repository.findByOwner(ownerId))?.usedSlots).toBe(0)
    await expect(
      useCase.execute({ ...command, operationId: '33333333-3333-4333-8333-333333333333' }),
    ).resolves.toMatchObject({ applied: true })
  })
})

describe('Habilidades incluidas con el heroe (aclaracion cliente/profesor, 2026-09-27)', () => {
  const heroId = '44444444-4444-4444-8444-444444444444'
  const abilityOne = '55555555-5555-4555-8555-555555555555'
  const abilityTwo = '66666666-6666-4666-8666-666666666666'
  const suspendedAbility = '77777777-7777-4777-8777-777777777777'

  const catalogProduct = (overrides: Partial<CatalogProductView>): CatalogProductView => ({
    productId: overrides.productId!,
    sku: overrides.sku ?? overrides.productId!,
    name: overrides.name ?? 'Producto de prueba',
    imageUrl: 'https://example.test/image.png',
    description: 'Descripcion de prueba',
    type: overrides.type ?? 'HABILIDAD',
    lifecycleStatus: overrides.lifecycleStatus ?? 'ACTIVE',
    creditsPrice: 0,
    premium: false,
    realMoneyPrice: null,
    attributes: overrides.attributes ?? null,
  })

  const hero = catalogProduct({
    productId: heroId,
    sku: 'guerrero-tanque',
    type: 'HEROE',
    attributes: {
      values: {
        kind: 'HEROE',
        heroSubtype: 'GUERRERO_TANQUE',
        basePower: 5,
        baseHealth: 40,
        baseDefense: 8,
        abilities: [abilityOne, abilityTwo, suspendedAbility],
      },
    },
  })
  const ability1 = catalogProduct({ productId: abilityOne, sku: 'golpe-con-escudo' })
  const ability2 = catalogProduct({ productId: abilityTwo, sku: 'mano-de-piedra' })
  const suspended = catalogProduct({
    productId: suspendedAbility,
    sku: 'habilidad-suspendida',
    lifecycleStatus: 'SUSPENDED',
  })

  it('al entregar un HEROE, agrega gratis sus habilidades activas declaradas en Catalog', async () => {
    const repository = new InMemoryInventoryRepository()
    const catalog = new InMemoryCatalogReadClient([hero, ability1, ability2, suspended])
    const useCase = new GrantPurchasedItems(repository, catalog)

    const result = await useCase.execute({
      operationId: '88888888-8888-4888-8888-888888888888',
      playerId: 'player-heroe',
      items: [{ productId: heroId, quantity: 1 }],
    })

    expect(result.applied).toBe(true)
    const inventory = await repository.findByOwner(PlayerId.create('player-heroe'))
    expect(
      inventory
        ?.toSnapshot()
        .slots.map((slot) => slot.itemId)
        .sort(),
    ).toEqual([heroId, abilityOne, abilityTwo].sort())
  })

  it('no duplica una habilidad que ya viniera explicita en el mismo lote', async () => {
    const repository = new InMemoryInventoryRepository()
    const catalog = new InMemoryCatalogReadClient([hero, ability1, ability2, suspended])
    const useCase = new GrantPurchasedItems(repository, catalog)

    await useCase.execute({
      operationId: '99999999-9999-4999-8999-999999999999',
      playerId: 'player-heroe-2',
      items: [
        { productId: heroId, quantity: 1 },
        { productId: abilityOne, quantity: 1 },
      ],
    })

    const inventory = await repository.findByOwner(PlayerId.create('player-heroe-2'))
    const slots = inventory?.toSnapshot().slots ?? []
    expect(slots.filter((slot) => slot.itemId === abilityOne)).toHaveLength(1)
    expect(slots.map((slot) => slot.itemId).sort()).toEqual([heroId, abilityOne, abilityTwo].sort())
  })

  it('un producto que no es HEROE no aporta habilidades', async () => {
    const repository = new InMemoryInventoryRepository()
    const catalog = new InMemoryCatalogReadClient([ability1])
    const useCase = new GrantPurchasedItems(repository, catalog)

    await useCase.execute({
      operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      playerId: 'player-solo-arma',
      items: [{ productId: abilityOne, quantity: 1 }],
    })

    const inventory = await repository.findByOwner(PlayerId.create('player-solo-arma'))
    expect(inventory?.toSnapshot().slots).toEqual([{ itemId: abilityOne, quantity: 1 }])
  })
})
