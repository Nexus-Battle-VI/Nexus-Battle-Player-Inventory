import { randomUUID } from 'node:crypto'

import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import type { Collection, Db, MongoClient } from 'mongodb'

import { MongoExperienceGrantRepository } from '../../src/adapters/outbound/persistence/MongoExperienceGrantRepository'
import {
  ExperienceGrantConflictError,
  ExperienceGrantRejectedError,
  HeroProgressionConflictError,
} from '../../src/application/errors/ApplicationError'
import type { ExperienceGrantCommand } from '../../src/application/ports/ExperienceGrantPort'
import type { ExperienceGrantResult } from '../../src/application/ports/ExperienceGrantPort'
import {
  createMongoClient,
  databaseOf,
  migrateToLatest,
} from '../../src/infrastructure/persistence/database'

/**
 * Acreditacion de experiencia contra un MongoDB REAL, en contenedor (HU-09, Task
 * HU-09.3).
 *
 * Lo que un doble no puede demostrar:
 *   - que la migracion `009-experience-grants` cree la coleccion y su validador;
 *   - que ledger y progresion se escriban en la MISMA transaccion, de modo que un
 *     fallo no deje una acreditacion a medias;
 *   - que el `_id` unico haga de verdad idempotente al reintento y que el
 *     bloqueo optimista de la progresion siga gobernando las escrituras.
 */
const HERO_ID = '7f3c2a9e-2d4b-4c1a-9e7f-1b2c3d4e5f60'
const LEDGER = 'experience_grants'
const PROGRESSIONS = 'hero-progressions'

describe('MongoExperienceGrantRepository', () => {
  let container: StartedMongoDBContainer | undefined
  let client: MongoClient
  let db: Db
  let repository: MongoExperienceGrantRepository

  beforeAll(async () => {
    const externalUri = process.env.MONGO_TEST_URI
    if (externalUri === undefined) container = await new MongoDBContainer('mongo:8.0').start()
    const options = {
      uri: externalUri ?? `${container!.getConnectionString()}/?directConnection=true`,
      databaseName: `test_experience_${randomUUID().replaceAll('-', '')}`,
    }

    client = createMongoClient(options)
    await client.connect()
    db = databaseOf(client, options)

    const result = await migrateToLatest(db)
    if (result.error instanceof Error) throw result.error
    if (result.error !== undefined) throw new Error('La migracion fallo.')

    repository = new MongoExperienceGrantRepository(db)
  }, 180_000)

  afterAll(async () => {
    await db.dropDatabase()
    await client.close()
    await container?.stop()
  })

  const commandOf = (overrides: Partial<ExperienceGrantCommand> = {}): ExperienceGrantCommand => ({
    operationId: overrides.operationId ?? `mission:${randomUUID()}:xp`,
    ownerId: overrides.ownerId ?? `sub-${randomUUID()}`,
    heroId: overrides.heroId ?? HERO_ID,
    amount: overrides.amount ?? 250,
    source: overrides.source ?? {
      kind: 'MISSION_RIVAL_DEFEAT',
      enrollmentId: `enr-${randomUUID()}`,
      simulationId: `sim-${randomUUID()}`,
      encounterId: '5',
      enemyInstanceId: 'guardian-eterno#1',
      rivalRef: 'guardian-eterno',
      roll: 5,
    },
  })

  /**
   * Colecciones leidas sin el tipo del producto: varias pruebas escriben
   * documentos INVALIDOS a proposito, y `_id` es cadena (el `operationId` o la
   * clave compuesta de la progresion), no el `ObjectId` por defecto del driver.
   */
  type RawDocument = Record<string, unknown> & { _id: string }

  const ledger = (): Collection<RawDocument> => db.collection<RawDocument>(LEDGER)

  const progressions = (): Collection<RawDocument> => db.collection<RawDocument>(PROGRESSIONS)

  const ledgerCount = (operationId: string): Promise<number> =>
    ledger().countDocuments({ _id: operationId })

  const progressionOf = (ownerId: string, heroId: string) =>
    progressions().findOne({ _id: `${ownerId}::${heroId}` })

  it('la migracion 009-experience-grants crea la coleccion con su validador', async () => {
    const collections = await db.listCollections({ name: LEDGER }).toArray()

    expect(collections).toHaveLength(1)
    // Sin indices secundarios: todo se consulta por `_id`.
    expect((await ledger().indexes()).map((index) => index.name)).toEqual(['_id_'])
  })

  it('crea la progresion de forma perezosa y deja asiento y acreditacion a la vez', async () => {
    const command = commandOf({ amount: 250 })
    const result = await repository.grant(command)

    expect(result).toMatchObject({
      operationId: command.operationId,
      applied: true,
      heroId: HERO_ID,
      level: 2,
      currentXp: 250,
      leveledUp: true,
      levelsGained: 1,
    })

    const progression = await progressionOf(command.ownerId, HERO_ID)
    expect(progression).toMatchObject({ ownerId: command.ownerId, level: 2, currentXp: 250 })

    const asiento = await ledger().findOne({ _id: command.operationId })
    expect(asiento).toMatchObject({
      ownerId: command.ownerId,
      heroId: HERO_ID,
      amount: 250,
      roll: 5,
      enemyInstanceId: 'guardian-eterno#1',
      // El umbral NO se persiste: solo el resultado de la acreditacion.
      result: { operationId: command.operationId, applied: true, level: 2, currentXp: 250 },
    })
    expect(asiento).not.toHaveProperty('nextLevel')
  })

  it('el reintento devuelve lo guardado con applied:false y NO vuelve a acreditar', async () => {
    const command = commandOf({ amount: 700 })
    const first = await repository.grant(command)

    const replay = await repository.grant(command)

    expect(replay).toMatchObject({
      applied: false,
      currentXp: first.currentXp,
      level: first.level,
      leveledUp: first.leveledUp,
      levelsGained: first.levelsGained,
    })
    expect(await ledgerCount(command.operationId)).toBe(1)
    expect(await progressionOf(command.ownerId, HERO_ID)).toMatchObject({
      currentXp: first.currentXp,
    })
  })

  it('un "reinicio" del servicio (instancia nueva sobre la MISMA base) sigue viendo el asiento', async () => {
    const command = commandOf({ amount: 300 })
    const first = await repository.grant(command)

    const afterRestart = new MongoExperienceGrantRepository(db)
    const replay = await afterRestart.grant(command)

    expect(replay).toMatchObject({ applied: false, currentXp: first.currentXp, level: first.level })
    expect(await ledgerCount(command.operationId)).toBe(1)
  })

  it('el mismo operationId con OTRO contenido es conflicto y no sobrescribe el asiento', async () => {
    const command = commandOf({ amount: 100 })
    await repository.grant(command)

    await expect(repository.grant({ ...command, amount: 999 })).rejects.toBeInstanceOf(
      ExperienceGrantConflictError,
    )

    const stored = await ledger().findOne({ _id: command.operationId })
    expect(stored).toMatchObject({ amount: 100, result: { currentXp: 100 } })
  })

  it('la misma derrota acreditada DOS VECES A LA VEZ acredita una sola vez', async () => {
    const command = commandOf({ amount: 400 })

    const [first, second] = await Promise.all([
      repository.grant(command),
      repository.grant(command),
    ])

    expect(second).toEqual({ ...first, applied: false })
    expect(await ledgerCount(command.operationId)).toBe(1)
    expect(await progressionOf(command.ownerId, HERO_ID)).toMatchObject({ currentXp: 400 })
  })

  it('dos derrotas DISTINTAS del mismo heroe a la vez no pierden experiencia', async () => {
    const owner = `sub-${randomUUID()}`
    const first = commandOf({ ownerId: owner, amount: 700 })
    const second = commandOf({ ownerId: owner, amount: 700 })

    const settled = await Promise.allSettled([repository.grant(first), repository.grant(second)])

    const applied = settled.filter(
      (entry): entry is PromiseFulfilledResult<ExperienceGrantResult> =>
        entry.status === 'fulfilled',
    )
    // El bloqueo optimista puede hacer perder la carrera a una: se reintenta con
    // el MISMO operationId y entonces se aplica. Lo que NO puede pasar es que se
    // pierda experiencia, ni que quede un asiento de una acreditacion que no se
    // llego a escribir en la progresion.
    for (const rejected of settled.filter((entry) => entry.status === 'rejected')) {
      expect(rejected.reason).toBeInstanceOf(HeroProgressionConflictError)
    }

    expect(applied).not.toHaveLength(0)
    // El acumulado es la suma de los IMPORTES aplicados, no de los acumulados
    // devueltos: cada respuesta trae el total que ese asiento dejo.
    expect((await progressionOf(owner, HERO_ID))?.currentXp).toBe(applied.length * 700)
    expect(Math.max(...applied.map((entry) => entry.value.currentXp))).toBe(applied.length * 700)
    expect(await ledgerCount(first.operationId)).toBe(1)
    // Y cada asiento escrito corresponde a una acreditacion aplicada.
    expect(await ledgerCount(second.operationId)).toBe(applied.length - 1)
  })

  it('un heroe con la progresion ilegible es 422 y NO deja asiento en el ledger', async () => {
    const owner = `sub-${randomUUID()}`
    const command = commandOf({ ownerId: owner, amount: 100 })

    // Documento incoherente: el nivel no corresponde a la experiencia acumulada.
    // Se escribe saltandose el validador, como ocurriria con un documento anterior
    // a la tabla vigente o editado a mano.
    await db.command({ collMod: PROGRESSIONS, validationLevel: 'off' })
    try {
      await progressions().insertOne({
        _id: `${owner}::${HERO_ID}`,
        ownerId: owner,
        heroId: HERO_ID,
        level: 8,
        currentXp: 0,
        version: 0,
      })
    } finally {
      await db.command({ collMod: PROGRESSIONS, validationLevel: 'strict' })
    }

    await expect(repository.grant(command)).rejects.toBeInstanceOf(ExperienceGrantRejectedError)

    // LA PRUEBA DE LA TRANSACCION: fallo la acreditacion y no quedo su asiento.
    expect(await ledgerCount(command.operationId)).toBe(0)
    expect(await progressionOf(owner, HERO_ID)).toMatchObject({ level: 8, currentXp: 0 })
  })

  it('el nivel 8 acumula sin descartar experiencia', async () => {
    const owner = `sub-${randomUUID()}`
    await progressions().insertOne({
      _id: `${owner}::${HERO_ID}`,
      ownerId: owner,
      heroId: HERO_ID,
      level: 8,
      currentXp: 12800,
      version: 0,
    })

    const result = await repository.grant(commandOf({ ownerId: owner, amount: 500 }))

    expect(result).toMatchObject({
      level: 8,
      currentXp: 13300,
      leveledUp: false,
      levelsGained: 0,
      applied: true,
    })
  })

  it('el validador rechaza un asiento sin resultado, con campo de mas o con nivel imposible', async () => {
    const base = {
      ownerId: 'sub-validador',
      heroId: HERO_ID,
      amount: 100,
      roll: 5,
      enrollmentId: 'enr-1',
      simulationId: 'sim-1',
      encounterId: '5',
      enemyInstanceId: 'guardian-eterno#1',
      rivalRef: 'guardian-eterno',
      fingerprint: 'huella',
      createdAt: new Date(),
    }
    const result = {
      operationId: 'op-validador',
      applied: true,
      heroId: HERO_ID,
      level: 2,
      currentXp: 100,
      leveledUp: true,
      levelsGained: 1,
    }

    const direct = ledger()

    // Sin `result`.
    await expect(direct.insertOne({ _id: 'op-sin-result', ...base })).rejects.toThrow()
    // Con un campo que el contrato no declara.
    await expect(
      direct.insertOne({ _id: 'op-extra', ...base, nextLevel: { status: 'AVAILABLE' } }),
    ).rejects.toThrow()
    // Con un nivel fuera del rango de HU-08 dentro del resultado.
    await expect(
      direct.insertOne({
        _id: 'op-nivel',
        ...base,
        result: { ...result, level: 9 },
      }),
    ).rejects.toThrow()
    // Y el asiento bien formado si entra.
    await expect(direct.insertOne({ _id: 'op-valido', ...base, result })).resolves.toMatchObject({
      acknowledged: true,
    })
  })
})
