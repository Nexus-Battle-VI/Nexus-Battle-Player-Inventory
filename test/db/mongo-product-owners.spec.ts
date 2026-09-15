import { randomUUID } from 'node:crypto'
import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import { type Db, type MongoClient } from 'mongodb'
import {
  createMongoClient,
  databaseOf,
  migrateToLatest,
} from '../../src/infrastructure/persistence/database'
import { MongoInventoryRepository } from '../../src/adapters/outbound/persistence/MongoInventoryRepository'
import { GrantPurchasedItems } from '../../src/application/use-cases/GrantPurchasedItems'
import { GetProductOwners } from '../../src/application/use-cases/GetProductOwners'
import { ItemId } from '../../src/domain/value-objects/identifiers'

describe('Resolucion de propietarios por producto contra MongoDB (HU-38, TASK #175)', () => {
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

  it('la migracion 005 crea el indice multikey sobre slots.itemId', async () => {
    const indexes = await db.collection('inventories').indexes()
    const productIndex = indexes.find((index) => index.name === 'owners_by_product')

    expect(productIndex).toBeDefined()
    expect(productIndex?.key).toEqual({ 'slots.itemId': 1 })
  })

  it('resuelve propietarios reales, sin duplicados, cubierto por el indice (sin escaneo completo)', async () => {
    const repository = new MongoInventoryRepository(db)
    const grant = new GrantPurchasedItems(repository)
    const productId = randomUUID()
    const otroProducto = randomUUID()
    const jugadorA = randomUUID()
    const jugadorB = randomUUID()

    await grant.execute({
      operationId: randomUUID(),
      playerId: jugadorA,
      items: [{ productId, quantity: 1 }],
    })
    // Segunda entrega al mismo jugador: se apila en la misma ranura, no debe duplicarlo en el resultado.
    await grant.execute({
      operationId: randomUUID(),
      playerId: jugadorA,
      items: [{ productId, quantity: 3 }],
    })
    await grant.execute({
      operationId: randomUUID(),
      playerId: jugadorB,
      items: [{ productId: otroProducto, quantity: 1 }],
    })
    await grant.execute({
      operationId: randomUUID(),
      playerId: jugadorB,
      items: [{ productId, quantity: 2 }],
    })

    const useCase = new GetProductOwners(repository)
    const result = await useCase.execute(productId)

    expect(result.owners.map((owner) => owner.playerId).sort()).toEqual([jugadorA, jugadorB].sort())

    const otroResultado = await useCase.execute(otroProducto)
    expect(otroResultado.owners).toEqual([{ playerId: jugadorB }])

    const explain = await db
      .collection('inventories')
      .find({ 'slots.itemId': productId })
      .explain('queryPlanner')
    const winningPlanJson = JSON.stringify(explain.queryPlanner.winningPlan)
    expect(winningPlanJson).toContain('owners_by_product')
    expect(winningPlanJson).not.toContain('COLLSCAN')
  })

  it('un producto sin propietarios devuelve una lista vacia sin lanzar error', async () => {
    const repository = new MongoInventoryRepository(db)
    const result = await new GetProductOwners(repository).execute(randomUUID())

    expect(result.owners).toEqual([])
  })

  it('la consulta no crea, modifica ni elimina ningun documento de inventario', async () => {
    const repository = new MongoInventoryRepository(db)
    const productId = randomUUID()
    const before = await db.collection('inventories').countDocuments({})

    await new GetProductOwners(repository).execute(productId)
    await repository.findOwnersOfProduct(ItemId.create(productId))

    const after = await db.collection('inventories').countDocuments({})
    expect(after).toBe(before)
  })
})
