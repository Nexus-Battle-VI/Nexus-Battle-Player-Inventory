import { randomUUID } from 'node:crypto'
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import { Int32, type Db, type MongoClient } from 'mongodb'
import {
  createMongoClient,
  databaseOf,
  migrateToLatest,
} from '../../src/infrastructure/persistence/database'
import { MongoInventoryRepository } from '../../src/adapters/outbound/persistence/MongoInventoryRepository'
import { GrantPurchasedItems } from '../../src/application/use-cases/GrantPurchasedItems'
import { PlayerId, ItemId, Quantity } from '../../src/domain/value-objects/identifiers'
import {
  InventoryConcurrentWriteError,
  InventoryGrantConflictError,
  InventoryGrantRejectedError,
} from '../../src/application/ports/InventoryGrantPort'
import { Inventory } from '../../src/domain/entities/Inventory'

describe('Entrega atomica contra MongoDB', () => {
  let container: StartedMongoDBContainer | undefined
  let client: MongoClient
  let db: Db
  beforeAll(async () => {
    const externalUri = process.env.MONGO_TEST_URI
    if (externalUri === undefined) container = await new MongoDBContainer('mongo:8.0').start()
    const options = {
      uri: externalUri ?? `${container!.getConnectionString()}/?directConnection=true`,
      databaseName: `test_inventory_${randomUUID().replaceAll('-', '')}`,
    }
    client = createMongoClient(options)
    await client.connect()
    db = databaseOf(client, options)
    const result = await migrateToLatest(db)
    if (result.error instanceof Error) throw result.error
    if (result.error !== undefined) throw new Error('La migracion fallo.')
  }, 180000)
  afterAll(async () => {
    await db.dropDatabase()
    await client.close()
    await container?.stop()
  })

  it('replay concurrente y reinicio no duplican unidades; huella diferente falla', async () => {
    const command = {
      operationId: randomUUID(),
      playerId: randomUUID(),
      items: [{ productId: randomUUID(), quantity: 2 }],
    }
    const useCase = new GrantPurchasedItems(new MongoInventoryRepository(db))
    const results = await Promise.all([useCase.execute(command), useCase.execute(command)])
    expect(results[1]).toEqual(results[0])
    const restarted = new GrantPurchasedItems(new MongoInventoryRepository(db))
    expect(await restarted.execute(command)).toEqual(results[0])
    await expect(restarted.execute({ ...command, playerId: randomUUID() })).rejects.toBeInstanceOf(
      InventoryGrantConflictError,
    )
    const found = await new MongoInventoryRepository(db).findByOwner(
      PlayerId.create(command.playerId),
    )
    expect(found?.toSnapshot().slots).toEqual([
      { itemId: command.items[0]!.productId, quantity: 2 },
    ])
  })

  it('un lote rechazado conserva una decision terminal sin slots parciales', async () => {
    const command = {
      operationId: randomUUID(),
      playerId: randomUUID(),
      items: Array.from({ length: 31 }, () => ({ productId: randomUUID(), quantity: 1 })),
    }
    await expect(
      new GrantPurchasedItems(new MongoInventoryRepository(db)).execute(command),
    ).rejects.toThrow(/completo/)
    expect(
      await db
        .collection<Record<string, unknown> & { _id: string }>('inventory_grants')
        .countDocuments({ _id: command.operationId }),
    ).toBe(1)
    expect(
      await new MongoInventoryRepository(db).findByOwner(PlayerId.create(command.playerId)),
    ).toBeNull()
  })

  it('el guardado legacy no sobrescribe una entrega posterior a su lectura', async () => {
    const repository = new MongoInventoryRepository(db)
    const useCase = new GrantPurchasedItems(repository)
    const command = {
      operationId: randomUUID(),
      playerId: randomUUID(),
      items: [{ productId: randomUUID(), quantity: 1 }],
    }
    await useCase.execute(command)
    const stale = (await repository.findByOwner(PlayerId.create(command.playerId)))!
    await useCase.execute({ ...command, operationId: randomUUID() })
    stale.add(ItemId.create('espada-legacy'), Quantity.create(1), new Date())
    await expect(repository.save(stale)).rejects.toBeInstanceOf(InventoryConcurrentWriteError)
    const found = await repository.findByOwner(stale.ownerId)
    expect(found?.toSnapshot().slots[0]?.quantity).toBe(2)
  })

  it('rechazo concurrente se reproduce despues de liberar espacio y reiniciar', async () => {
    const repository = new MongoInventoryRepository(db)
    const ownerId = PlayerId.create(randomUUID())
    await repository.save(
      Inventory.restore({ ownerId, capacity: 1, slots: [{ itemId: 'ocupado', quantity: 1 }] }),
    )
    const command = {
      operationId: randomUUID(),
      playerId: ownerId.value,
      items: [{ productId: randomUUID(), quantity: 1 }],
    }
    const useCase = new GrantPurchasedItems(repository)
    const outcomes = await Promise.allSettled([useCase.execute(command), useCase.execute(command)])
    expect(outcomes).toEqual([
      expect.objectContaining({
        status: 'rejected',
        reason: expect.any(InventoryGrantRejectedError),
      }),
      expect.objectContaining({
        status: 'rejected',
        reason: expect.any(InventoryGrantRejectedError),
      }),
    ])
    const inventory = (await repository.findByOwner(ownerId))!
    inventory.remove(ItemId.create('ocupado'), Quantity.create(1), new Date())
    await repository.save(inventory)
    const restarted = new GrantPurchasedItems(new MongoInventoryRepository(db))
    await expect(restarted.execute(command)).rejects.toBeInstanceOf(InventoryGrantRejectedError)
    expect((await repository.findByOwner(ownerId))?.usedSlots).toBe(0)
    await expect(
      restarted.execute({ ...command, operationId: randomUUID() }),
    ).resolves.toMatchObject({ applied: true })
  })

  it('migra por CAS un inventario legacy sin revision y no permite recrearlo encima', async () => {
    const repository = new MongoInventoryRepository(db)
    const ownerId = PlayerId.create(randomUUID())
    await db
      .collection<Record<string, unknown> & { _id: string }>('inventories')
      .insertOne({ _id: ownerId.value, capacity: new Int32(30), slots: [] })
    const legacy = (await repository.findByOwner(ownerId))!
    await repository.save(legacy)
    await expect(
      repository.save(Inventory.restore({ ownerId, capacity: 30, slots: [] })),
    ).rejects.toBeInstanceOf(InventoryConcurrentWriteError)
    const second = PlayerId.create(randomUUID())
    await db
      .collection<Record<string, unknown> & { _id: string }>('inventories')
      .insertOne({ _id: second.value, capacity: new Int32(30), slots: [] })
    await new GrantPurchasedItems(repository).execute({
      operationId: randomUUID(),
      playerId: second.value,
      items: [{ productId: randomUUID(), quantity: 1 }],
    })
    expect((await repository.findByOwner(second))?.totalUnits).toBe(1)
  })

  it('rechaza un resultado persistido incompleto sin conceder nuevas unidades', async () => {
    const command = {
      operationId: randomUUID(),
      playerId: randomUUID(),
      items: [{ productId: randomUUID(), quantity: 1 }],
    }
    await db.collection<Record<string, unknown> & { _id: string }>('inventory_grants').insertOne({
      _id: command.operationId,
      fingerprint: JSON.stringify({ playerId: command.playerId, items: command.items }),
      result: null,
      rejection: null,
      createdAt: new Date(),
    })
    await expect(
      new GrantPurchasedItems(new MongoInventoryRepository(db)).execute(command),
    ).rejects.toThrow('Resultado de entrega incompleto')
    expect(
      await new MongoInventoryRepository(db).findByOwner(PlayerId.create(command.playerId)),
    ).toBeNull()
  })
})
