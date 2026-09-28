import 'reflect-metadata'
import { randomUUID } from 'node:crypto'

import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import { Int32, type Db, type MongoClient } from 'mongodb'

import {
  createMongoClient,
  databaseOf,
  migrateToLatest,
} from '../../src/infrastructure/persistence/database'
import { up as recomputeLevels } from '../../src/adapters/outbound/persistence/migrations/013-hero-progressions-cumulative-thresholds'

/**
 * `013-hero-progressions-cumulative-thresholds` recalcula el NIVEL de las
 * progresiones ya persistidas con la tabla acumulada vigente (HU-08). La XP no
 * se toca: solo el nivel derivado. Sin la migracion, un heroe guardado con la
 * tabla temporal anterior (p. ej. 301 XP en nivel 2) seria rechazado por
 * `HeroProgression.restore` como dato corrupto.
 */
describe('Migracion 013: recalcula el nivel de las progresiones existentes', () => {
  let container: StartedMongoDBContainer | undefined
  let client: MongoClient
  let db: Db

  beforeAll(async () => {
    const externalUri = process.env.MONGO_TEST_URI
    if (externalUri === undefined) container = await new MongoDBContainer('mongo:8.0').start()
    const options = {
      uri: externalUri ?? `${container?.getConnectionString() ?? ''}/?directConnection=true`,
      databaseName: `test_migration013_${randomUUID().replaceAll('-', '')}`,
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

  const progressions = (): ReturnType<Db['collection']> => db.collection('hero-progressions')

  const insert = async (id: string, level: number, currentXp: number): Promise<void> => {
    await progressions().insertOne({
      _id: id as never,
      ownerId: 'jugador',
      heroId: id,
      level: new Int32(level),
      currentXp: new Int32(currentXp),
      version: new Int32(0),
    })
  }

  const levelOf = async (id: string): Promise<{ level: number; currentXp: number }> => {
    const doc = await progressions().findOne({ _id: id as never })
    return { level: Number(doc?.level), currentXp: Number(doc?.currentXp) }
  }

  it('corrige el nivel segun la tabla vigente y conserva la XP', async () => {
    // Estado que dejaba la tabla anterior (100, 200, 400, ... 12800).
    await insert('a-301', 2, 301)
    await insert('a-849', 4, 849)
    await insert('a-13000', 8, 13000)
    await insert('a-99', 1, 99)
    await insert('a-1300', 7, 1300)

    await recomputeLevels(db)

    expect(await levelOf('a-301')).toEqual({ level: 3, currentXp: 301 })
    expect(await levelOf('a-849')).toEqual({ level: 5, currentXp: 849 })
    expect(await levelOf('a-13000')).toEqual({ level: 8, currentXp: 13000 })
    expect(await levelOf('a-99')).toEqual({ level: 1, currentXp: 99 })
    expect(await levelOf('a-1300')).toEqual({ level: 8, currentXp: 1300 })
  })

  it('respeta cada frontera exacta de la tabla', async () => {
    const boundaries: readonly (readonly [number, number])[] = [
      [0, 1],
      [99, 1],
      [100, 2],
      [299, 2],
      [300, 3],
      [499, 3],
      [500, 4],
      [699, 4],
      [700, 5],
      [899, 5],
      [900, 6],
      [1099, 6],
      [1100, 7],
      [1299, 7],
      [1300, 8],
    ]

    for (const [xp] of boundaries) await insert(`b-${String(xp)}`, 1, xp)

    await recomputeLevels(db)

    for (const [xp, level] of boundaries) {
      expect(await levelOf(`b-${String(xp)}`)).toEqual({ level, currentXp: xp })
    }
  })

  it('es idempotente y deja el nivel entero', async () => {
    await recomputeLevels(db)
    await recomputeLevels(db)

    expect(await levelOf('a-301')).toEqual({ level: 3, currentXp: 301 })
    // Se guarda como entero: el validador `int` de la coleccion lo exige al escribir.
    const doc = await progressions().findOne({ _id: 'a-301' as never })
    expect(Number.isInteger(doc?.level)).toBe(true)
  })
})
