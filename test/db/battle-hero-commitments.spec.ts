import { randomUUID } from 'node:crypto'

import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import type { Db, MongoClient } from 'mongodb'

import { MongoBattleHeroCommitmentRepository } from '../../src/adapters/outbound/persistence/MongoBattleHeroCommitmentRepository'
import { BattleHeroCommittedError } from '../../src/application/ports/BattleHeroCommitmentPort'
import {
  createMongoClient,
  databaseOf,
  migrateToLatest,
} from '../../src/infrastructure/persistence/database'

/**
 * Compromiso de batalla contra MongoDB REAL (HU-29, Task HU-29.2).
 *
 * Hay dos cosas que solo se pueden probar contra el motor y no contra el doble en
 * memoria: que el **indice unico parcial** impide de verdad un segundo
 * compromiso activo del mismo heroe, y que la **caducidad** libera ese indice. Si
 * el indice estuviera mal, el doble diria que todo funciona y en produccion un
 * heroe podria quedar en dos batallas a la vez.
 */
describe('Compromiso de batalla contra MongoDB', () => {
  let container: StartedMongoDBContainer | undefined
  let client: MongoClient
  let db: Db
  let commitments: MongoBattleHeroCommitmentRepository

  const playerId = randomUUID()
  const heroId = randomUUID()
  const NOW = new Date('2026-09-24T12:00:00.000Z')
  const input = (operationId: string, overrides: Record<string, unknown> = {}) => ({
    operationId,
    playerId,
    heroId,
    reference: 'room_1',
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    ...overrides,
  })

  beforeAll(async () => {
    const uri = process.env.MONGO_TEST_URI

    if (!uri) container = await new MongoDBContainer('mongo:8.0').start()

    const options = {
      uri: uri ?? `${container!.getConnectionString()}/?directConnection=true`,
      databaseName: `test_battle_commitments_${randomUUID().replaceAll('-', '')}`,
    }

    client = createMongoClient(options)
    await client.connect()
    db = databaseOf(client, options)

    const result = await migrateToLatest(db)

    if (result.error instanceof Error) throw result.error
    if (result.error !== undefined) throw new Error('La migracion fallo.')

    commitments = new MongoBattleHeroCommitmentRepository(db)
  }, 180000)

  afterAll(async () => {
    await db.dropDatabase()
    await client.close()
    await container?.stop()
  })

  afterEach(async () => {
    await db.collection('battle-hero-commitments').deleteMany({})
  })

  it('compromete, y el guard lo ve como batalla activa', async () => {
    const operationId = randomUUID()

    await commitments.commit(input(operationId), NOW)

    await expect(commitments.hasActiveForHero(playerId, heroId, NOW)).resolves.toBe(true)
    await expect(commitments.hasActiveForHero(playerId, randomUUID(), NOW)).resolves.toBe(false)
  })

  it('la misma clave con el mismo cuerpo es idempotente: no crea un segundo asiento', async () => {
    const operationId = randomUUID()
    const body = input(operationId)

    const first = await commitments.commit(body, NOW)
    const second = await commitments.commit(body, NOW)

    expect(second.commitmentId).toBe(first.commitmentId)
    expect(await db.collection('battle-hero-commitments').countDocuments({})).toBe(1)
  })

  it('el indice parcial impide dos batallas activas del mismo heroe', async () => {
    await commitments.commit(input(randomUUID()), NOW)

    await expect(commitments.commit(input(randomUUID()), NOW)).rejects.toBeInstanceOf(
      BattleHeroCommittedError,
    )
    expect(await db.collection('battle-hero-commitments').countDocuments({})).toBe(1)
  })

  it('liberar deja volver a comprometer al mismo heroe', async () => {
    const first = randomUUID()
    const second = randomUUID()

    await commitments.commit(input(first), NOW)
    await commitments.release(first)
    await expect(commitments.hasActiveForHero(playerId, heroId, NOW)).resolves.toBe(false)
    await expect(commitments.commit(input(second), NOW)).resolves.toMatchObject({
      status: 'ACTIVE',
    })
  })

  it('liberar dos veces no es un error', async () => {
    const operationId = randomUUID()

    await commitments.commit(input(operationId), NOW)
    await commitments.release(operationId)
    await expect(commitments.release(operationId)).resolves.toBeUndefined()
    // Y una liberacion de algo que nunca existio, tampoco.
    await expect(commitments.release(randomUUID())).resolves.toBeUndefined()
  })

  it('un compromiso vencido deja de bloquear aunque nadie lo libere', async () => {
    const stale = randomUUID()
    const later = new Date(NOW.getTime() + 7_200_000)

    await commitments.commit(input(stale, { expiresAt: new Date(NOW.getTime() + 60_000) }), NOW)

    // Es el caso de una liberacion perdida: nadie libera, y el heroe NO puede
    // quedar bloqueado para siempre.
    await expect(commitments.hasActiveForHero(playerId, heroId, later)).resolves.toBe(false)

    const fresh = randomUUID()
    // La caducidad se mide contra `later`, no contra `NOW`: si no, el compromiso
    // nace ya vencido en el instante en que se le consulta.
    await expect(
      commitments.commit(input(fresh, { expiresAt: new Date(later.getTime() + 3_600_000) }), later),
    ).resolves.toMatchObject({ status: 'ACTIVE' })
    await expect(commitments.hasActiveForHero(playerId, heroId, later)).resolves.toBe(true)
  })
})
