import 'reflect-metadata'

import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import type { Db, MongoClient } from 'mongodb'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import {
  createMongoClient,
  databaseOf,
  migrateToLatest,
} from '../../src/infrastructure/persistence/database'
import { MongoInventoryRepository } from '../../src/adapters/outbound/persistence/MongoInventoryRepository'
import { Inventory } from '../../src/domain/entities/Inventory'
import { CapacityPolicy } from '../../src/domain/policies/CapacityPolicy'
import { ItemId, PlayerId, Quantity } from '../../src/domain/value-objects/identifiers'

/**
 * `InventoryQueryPort` sobre el motor REAL.
 *
 * La consulta paginada se resuelve con una agregacion `$match` por `_id` +
 * `$size`/`$slice`: el motor calcula el total y devuelve solo la porcion pedida.
 * Un doble de prueba no demostraria que ese pipeline se comporta como se cree.
 */
describe('MongoInventoryRepository (consulta paginada)', () => {
  let container: StartedMongoDBContainer
  let client: MongoClient
  let db: Db
  let repository: MongoInventoryRepository

  let contador = 0

  // La capacidad del fixture se dimensiona para que quepan `count` ranuras
  // distintas, acotada al maximo que admite el dominio. NO se altera la
  // capacidad por defecto del producto (`CapacityPolicy.default()` sigue siendo
  // 30): se pide una capacidad explicita valida con `CapacityPolicy.of(...)`,
  // que es la via que el propio dominio ofrece para inventarios mas grandes.
  const persistInventory = async (
    count: number,
    capacity = Math.min(CapacityPolicy.MAX_CAPACITY, Math.max(count, 1)),
  ): Promise<PlayerId> => {
    contador += 1
    const ownerId = PlayerId.create(`jugador-consulta-${String(contador)}`)
    const inventory = Inventory.createEmpty(ownerId, CapacityPolicy.of(capacity))

    // En orden descendente: la consulta debe devolverlos ordenados por `itemId`.
    for (let index = count - 1; index >= 0; index -= 1) {
      inventory.add(
        ItemId.create(`item-${String(index).padStart(3, '0')}`),
        Quantity.create(index + 1),
        new Date(),
      )
    }

    await repository.save(inventory)

    return ownerId
  }

  beforeAll(async () => {
    container = await new MongoDBContainer('mongo:8.0').start()

    const options = { uri: `${container.getConnectionString()}/?directConnection=true` }

    client = createMongoClient(options)
    await client.connect()
    db = databaseOf(client, options)

    const { error } = await migrateToLatest(db)

    if (error !== undefined) {
      throw new Error(`Las migraciones fallaron: ${describeError(error)}`)
    }
  }, 180_000)

  afterAll(async () => {
    await client.close()
    await container.stop()
  })

  beforeEach(() => {
    repository = new MongoInventoryRepository(db)
  })

  it('un jugador sin documento de inventario devuelve una porcion vacia', async () => {
    const slice = await repository.listOwnedItems(PlayerId.create('jugador-sin-nada'), 1, 16)

    expect(slice).toEqual({ items: [], totalItems: 0 })
  })

  it('devuelve las ranuras del propietario consultado y su total real', async () => {
    const ownerId = await persistInventory(5)

    const slice = await repository.listOwnedItems(ownerId, 1, 16)

    expect(slice.totalItems).toBe(5)
    expect(slice.items).toHaveLength(5)
    expect(slice.items[0]).toEqual({ itemId: 'item-000', quantity: 1 })
  })

  it('pagina de 16 en 16: 20 ranuras dan 16 + 4', async () => {
    const ownerId = await persistInventory(20)

    const first = await repository.listOwnedItems(ownerId, 1, 16)
    const second = await repository.listOwnedItems(ownerId, 2, 16)

    expect(first.items).toHaveLength(16)
    expect(second.items).toHaveLength(4)
    expect(first.totalItems).toBe(20)
    expect(second.totalItems).toBe(20)
  })

  it('17 ranuras se reparten en 16 + 1', async () => {
    const ownerId = await persistInventory(17)

    expect((await repository.listOwnedItems(ownerId, 1, 16)).items).toHaveLength(16)
    expect((await repository.listOwnedItems(ownerId, 2, 16)).items).toHaveLength(1)
  })

  it('33 ranuras se reparten en 16 + 16 + 1', async () => {
    const ownerId = await persistInventory(33)

    expect((await repository.listOwnedItems(ownerId, 1, 16)).items).toHaveLength(16)
    expect((await repository.listOwnedItems(ownerId, 2, 16)).items).toHaveLength(16)
    const third = await repository.listOwnedItems(ownerId, 3, 16)
    expect(third.items).toHaveLength(1)
    expect(third.items[0]).toEqual({ itemId: 'item-032', quantity: 33 })
  })

  it('nunca devuelve ranuras del inventario de otro propietario', async () => {
    const ownerA = await persistInventory(4)
    await persistInventory(9)

    const slice = await repository.listOwnedItems(ownerA, 1, 16)

    expect(slice.totalItems).toBe(4)
  })

  it('devuelve las ranuras ordenadas de forma estable por itemId', async () => {
    const ownerId = await persistInventory(18)

    const page = await repository.listOwnedItems(ownerId, 1, 16)

    expect(page.items.map((item) => item.itemId)).toEqual(
      Array.from({ length: 16 }, (_, index) => `item-${String(index).padStart(3, '0')}`),
    )
  })

  it('funciona con un documento cercano a la capacidad maxima permitida', async () => {
    const count = CapacityPolicy.MAX_CAPACITY
    const ownerId = await persistInventory(count, CapacityPolicy.MAX_CAPACITY)

    const first = await repository.listOwnedItems(ownerId, 1, 16)
    const last = await repository.listOwnedItems(ownerId, Math.ceil(count / 16), 16)

    expect(first.totalItems).toBe(count)
    expect(first.items).toHaveLength(16)
    expect(last.items).toHaveLength(count - 16 * (Math.ceil(count / 16) - 1))
  })

  it('una pagina valida mas alla del total devuelve items vacios y el total real', async () => {
    const ownerId = await persistInventory(3)

    const slice = await repository.listOwnedItems(ownerId, 99, 16)

    expect(slice).toEqual({ items: [], totalItems: 3 })
  })

  describe('findAllOwnedItems (universo de la busqueda de HU-27)', () => {
    it('devuelve todas las ranuras ordenadas por itemId', async () => {
      const ownerId = await persistInventory(20)

      const all = await repository.findAllOwnedItems(ownerId)

      expect(all).toHaveLength(20)
      expect(all.map((item) => item.itemId)).toEqual(
        Array.from({ length: 20 }, (_, index) => `item-${String(index).padStart(3, '0')}`),
      )
      expect(all[0]).toEqual({ itemId: 'item-000', quantity: 1 })
    })

    it('un jugador sin documento de inventario devuelve una lista vacia', async () => {
      const all = await repository.findAllOwnedItems(PlayerId.create('jugador-sin-nada'))

      expect(all).toEqual([])
    })

    it('nunca mezcla ranuras de otro propietario', async () => {
      const ownerA = await persistInventory(4)
      await persistInventory(9)

      const all = await repository.findAllOwnedItems(ownerA)

      expect(all).toHaveLength(4)
    })

    it('funciona con un documento cercano a la capacidad maxima', async () => {
      const ownerId = await persistInventory(
        CapacityPolicy.MAX_CAPACITY,
        CapacityPolicy.MAX_CAPACITY,
      )

      const all = await repository.findAllOwnedItems(ownerId)

      expect(all).toHaveLength(CapacityPolicy.MAX_CAPACITY)
    })
  })
})
