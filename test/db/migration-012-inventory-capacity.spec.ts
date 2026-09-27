import 'reflect-metadata'
import { randomUUID } from 'node:crypto'

import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import { Int32, type Db, type MongoClient } from 'mongodb'

import {
  createMongoClient,
  databaseOf,
  migrateToLatest,
} from '../../src/infrastructure/persistence/database'
import { up as backfillCapacity } from '../../src/adapters/outbound/persistence/migrations/012-inventories-capacity-200'

/**
 * `012-inventories-capacity-200` sube a 200 la capacidad de inventarios YA
 * EXISTENTES: el default en codigo (`CapacityPolicy.DEFAULT_CAPACITY`) solo
 * rige inventarios nuevos, porque `Inventory.restore` usa la capacidad
 * GRABADA en el documento, no la constante actual. Sin esta migracion, un
 * jugador con inventario previo al cambio seguiria topando en 30 para
 * siempre, aunque el dominio ya admita hasta 200.
 */
describe('Migracion 012: sube la capacidad de inventarios existentes a 200', () => {
  let container: StartedMongoDBContainer | undefined
  let client: MongoClient
  let db: Db

  beforeAll(async () => {
    const externalUri = process.env.MONGO_TEST_URI
    if (externalUri === undefined) container = await new MongoDBContainer('mongo:8.0').start()
    const options = {
      uri: externalUri ?? `${container!.getConnectionString()}/?directConnection=true`,
      databaseName: `test_migration012_${randomUUID().replaceAll('-', '')}`,
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

  it('sube a 200 solo los inventarios con capacidad menor, y no toca los que ya tienen 200 o una capacidad especial mayor', async () => {
    const inventories = db.collection<Record<string, unknown> & { _id: string }>('inventories')
    await inventories.insertMany([
      { _id: 'jugador-viejo-30', capacity: new Int32(30), slots: [] },
      { _id: 'jugador-viejo-1', capacity: new Int32(1), slots: [] },
      { _id: 'jugador-ya-200', capacity: new Int32(200), slots: [] },
    ])

    await backfillCapacity(db)

    const docs = await inventories.find({}).sort({ _id: 1 }).toArray()
    const capacityOf = (id: string): number => Number(docs.find((doc) => doc._id === id)?.capacity)

    expect(capacityOf('jugador-viejo-30')).toBe(200)
    expect(capacityOf('jugador-viejo-1')).toBe(200)
    expect(capacityOf('jugador-ya-200')).toBe(200)
  })

  it('es idempotente: aplicarla dos veces deja el mismo resultado', async () => {
    await backfillCapacity(db)
    await backfillCapacity(db)

    const stillOnlyValidCapacities = await db
      .collection('inventories')
      .find({ capacity: { $ne: 200 } })
      .toArray()

    expect(stillOnlyValidCapacities).toHaveLength(0)
  })
})
