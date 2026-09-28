import { randomUUID } from 'node:crypto'

import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import type { Collection, Db, MongoClient } from 'mongodb'

import {
  down as revertToRivalDefeatOnly,
  up as allowMissionCompletion,
} from '../../src/adapters/outbound/persistence/migrations/014-experience-grants-mission-completion'
import { MongoExperienceGrantRepository } from '../../src/adapters/outbound/persistence/MongoExperienceGrantRepository'
import {
  toSource,
  type ExperienceGrantDocument,
} from '../../src/adapters/outbound/persistence/experience-grant-mapping'
import { ExperienceGrantConflictError } from '../../src/application/errors/ApplicationError'
import type { ExperienceGrantCommand } from '../../src/application/ports/ExperienceGrantPort'
import {
  createMongoClient,
  databaseOf,
  migrateToLatest,
} from '../../src/infrastructure/persistence/database'

/**
 * La XP de FINALIZACION (HU-10, Task HU-10.2) contra un MongoDB REAL.
 *
 * Lo que un doble no puede demostrar:
 *   - que la migracion `014` acepte `MISSION_COMPLETION` SIN tocar los asientos de
 *     HU-09 ya guardados, que siguen legibles y con su huella;
 *   - que el validador sea un `oneOf` cerrado: no admite un asiento que mezcle
 *     campos de derrota con un origen de finalizacion;
 *   - que la idempotencia (replay tras reiniciar, conflicto, concurrencia) valga
 *     con el asiento nuevo, y que ledger y progresion sigan siendo UNA transaccion.
 */
const HERO_ID = '7f3c2a9e-2d4b-4c1a-9e7f-1b2c3d4e5f60'
const LEDGER = 'experience_grants'
const PROGRESSIONS = 'hero-progressions'

type RawDocument = Record<string, unknown> & { _id: string }

describe('Acreditacion de XP de finalizacion (MISSION_COMPLETION) sobre MongoDB real', () => {
  let container: StartedMongoDBContainer | undefined
  let client: MongoClient
  let db: Db
  let repository: MongoExperienceGrantRepository

  beforeAll(async () => {
    const externalUri = process.env.MONGO_TEST_URI
    if (externalUri === undefined) container = await new MongoDBContainer('mongo:8.0').start()
    const options = {
      uri: externalUri ?? `${container!.getConnectionString()}/?directConnection=true`,
      databaseName: `test_completion_${randomUUID().replaceAll('-', '')}`,
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

  const ledger = (): Collection<RawDocument> => db.collection<RawDocument>(LEDGER)
  const progressions = (): Collection<RawDocument> => db.collection<RawDocument>(PROGRESSIONS)

  const enrollment = (): string => `enr-${randomUUID()}`

  const completionCommand = (
    overrides: Partial<ExperienceGrantCommand> & { enrollmentId?: string } = {},
  ): ExperienceGrantCommand => {
    const enrollmentId = overrides.enrollmentId ?? enrollment()

    return {
      operationId: overrides.operationId ?? `mission:${enrollmentId}:reward:completion:xp`,
      ownerId: overrides.ownerId ?? `sub-${randomUUID()}`,
      heroId: overrides.heroId ?? HERO_ID,
      amount: overrides.amount ?? 40,
      source: overrides.source ?? {
        kind: 'MISSION_COMPLETION',
        enrollmentId,
        missionId: 'msn_templo_olvidado',
        simulationId: `sim-${randomUUID()}`,
        difficulty: 'NORMAL',
        missionOutcome: 'COMPLETED',
      },
    }
  }

  const rivalCommand = (
    overrides: Partial<ExperienceGrantCommand> = {},
  ): ExperienceGrantCommand => ({
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

  it('primera aplicacion: guarda el asiento con su source y la progresion, en una transaccion', async () => {
    const command = completionCommand({ amount: 40 })

    const result = await repository.grant(command)

    expect(result).toMatchObject({
      applied: true,
      currentXp: 40,
      level: 1,
      leveledUp: false,
      levelsGained: 0,
    })

    const stored = await ledger().findOne({ _id: command.operationId })

    expect(stored).not.toBeNull()
    // Con `source` discriminado y SIN ningun campo de derrota.
    expect(stored?.source).toEqual(command.source)
    for (const forbidden of ['roll', 'rivalRef', 'enemyInstanceId', 'encounterId']) {
      expect(stored).not.toHaveProperty(forbidden)
    }
    expect(toSource(stored as unknown as ExperienceGrantDocument)).toEqual(command.source)

    const progression = await progressions().findOne({ _id: `${command.ownerId}::${HERO_ID}` })

    expect(Number(progression?.currentXp)).toBe(40)
  })

  it('replay tras "reiniciar" (instancia nueva sobre la MISMA base): applied:false y sin sumar', async () => {
    const command = completionCommand({ amount: 120 })
    const first = await repository.grant(command)

    const restarted = new MongoExperienceGrantRepository(db)
    const replay = await restarted.grant(command)

    expect(first).toMatchObject({ applied: true, currentXp: 120, level: 2 })
    expect(replay).toEqual({ ...first, applied: false })
    expect(await ledger().countDocuments({ _id: command.operationId })).toBe(1)
    expect(
      Number((await progressions().findOne({ _id: `${command.ownerId}::${HERO_ID}` }))?.currentXp),
    ).toBe(120)
  })

  it('el mismo operationId con OTRO contenido es conflicto y no sobrescribe', async () => {
    const command = completionCommand({ amount: 40 })
    await repository.grant(command)

    const changed = [
      { ...command, amount: 41 },
      {
        ...command,
        source: { ...command.source, difficulty: 'HEROIC' },
      } as ExperienceGrantCommand,
      {
        ...command,
        source: { ...command.source, missionOutcome: 'FAILED' },
      } as ExperienceGrantCommand,
    ]

    for (const attempt of changed) {
      await expect(repository.grant(attempt)).rejects.toThrow(ExperienceGrantConflictError)
    }

    expect(await repository.grant(command)).toMatchObject({ applied: false, currentXp: 40 })
    expect((await ledger().findOne({ _id: command.operationId }))?.amount).toBe(40)
  })

  it('la misma finalizacion pedida DOS VECES A LA VEZ acredita una sola vez', async () => {
    const command = completionCommand({ amount: 60 })

    const [a, b] = await Promise.all([repository.grant(command), repository.grant(command)])

    expect([a.applied, b.applied].sort()).toEqual([false, true])
    expect(
      Number((await progressions().findOne({ _id: `${command.ownerId}::${HERO_ID}` }))?.currentXp),
    ).toBe(60)
  })

  it('acumula sobre la XP de HU-09 y cruza niveles con la tabla de HU-08', async () => {
    const ownerId = `sub-${randomUUID()}`

    await repository.grant(rivalCommand({ ownerId, amount: 290 }))
    const result = await repository.grant(completionCommand({ ownerId, amount: 25 }))

    expect(result).toMatchObject({ currentXp: 315, level: 3, leveledUp: true, levelsGained: 1 })
  })

  it('el nivel 8 sigue acumulando XP de finalizacion', async () => {
    const ownerId = `sub-${randomUUID()}`

    await repository.grant(rivalCommand({ ownerId, amount: 1300 }))
    const result = await repository.grant(completionCommand({ ownerId, amount: 9 }))

    expect(result).toMatchObject({ currentXp: 1309, level: 8, leveledUp: false, levelsGained: 0 })
  })

  describe('migracion 014 sobre asientos de HU-09 preexistentes', () => {
    it('no toca ni reinterpreta los asientos historicos, y estos siguen legibles y con su huella', async () => {
      // El ledger de HU-09 tal y como lo dejo `009`: se vuelve al validador previo,
      // se acredita una derrota REAL por el repositorio y se anota el asiento.
      await revertToRivalDefeatOnly(db)

      const historical = rivalCommand({ amount: 30 })
      const original = await repository.grant(historical)
      const before = await ledger().findOne({ _id: historical.operationId })

      // Con el validador historico una finalizacion NO cabe.
      await expect(repository.grant(completionCommand())).rejects.toThrow()

      // Se aplica la migracion sobre datos ya existentes.
      await allowMissionCompletion(db)

      const after = await ledger().findOne({ _id: historical.operationId })

      // El asiento es IDENTICO: ni un campo nuevo, ni `source`, ni `kind`.
      expect(after).toEqual(before)
      expect(after).not.toHaveProperty('source')
      expect(after).not.toHaveProperty('kind')
      expect(toSource(after as unknown as ExperienceGrantDocument)).toEqual(historical.source)

      // Un reintento actual de esa derrota sigue siendo replay (la huella coincide)...
      expect(await new MongoExperienceGrantRepository(db).grant(historical)).toEqual({
        ...original,
        applied: false,
      })
      // ...y un cuerpo distinto sigue siendo conflicto.
      await expect(
        repository.grant({ ...historical, amount: historical.amount + 1 }),
      ).rejects.toThrow(ExperienceGrantConflictError)

      // Ahora la finalizacion si cabe.
      await expect(repository.grant(completionCommand())).resolves.toMatchObject({ applied: true })
    })

    it('es idempotente: aplicarla otra vez deja el mismo validador y nada se pierde', async () => {
      const command = completionCommand({ amount: 15 })
      await repository.grant(command)
      const validatorBefore = (await db.listCollections({ name: LEDGER }).toArray())[0]

      await allowMissionCompletion(db)
      await allowMissionCompletion(db)

      const validatorAfter = (await db.listCollections({ name: LEDGER }).toArray())[0]

      expect(validatorAfter).toEqual(validatorBefore)
      expect(await repository.grant(command)).toMatchObject({ applied: false, currentXp: 15 })
    })
  })

  describe('el validador es un oneOf cerrado', () => {
    const common = () => ({
      fingerprint: 'huella',
      ownerId: 'sub-validador',
      heroId: HERO_ID,
      amount: 10,
      result: {
        operationId: 'op',
        applied: true,
        heroId: HERO_ID,
        level: 1,
        currentXp: 10,
        leveledUp: false,
        levelsGained: 0,
      },
      createdAt: new Date(),
    })
    const completionSource = () => ({
      kind: 'MISSION_COMPLETION',
      enrollmentId: 'enr-1',
      missionId: 'msn-1',
      simulationId: 'sim-1',
      difficulty: 'NORMAL',
      missionOutcome: 'COMPLETED',
    })

    it('admite una finalizacion bien formada', async () => {
      await expect(
        ledger().insertOne({ _id: 'v-ok', ...common(), source: completionSource() }),
      ).resolves.toMatchObject({ acknowledged: true })
    })

    it.each([
      ['un campo de derrota (`roll`) junto al source', { roll: 5 }],
      ['un campo suelto de derrota (`rivalRef`)', { rivalRef: 'x' }],
    ])('rechaza una finalizacion con %s', async (_label, extra) => {
      await expect(
        ledger().insertOne({
          _id: `v-${randomUUID()}`,
          ...common(),
          source: completionSource(),
          ...extra,
        }),
      ).rejects.toThrow()
    })

    it.each([
      ['un desenlace fuera del vocabulario', { missionOutcome: 'VOIDED' }],
      ['una dificultad fuera del vocabulario', { difficulty: 'EASY' }],
      ['un kind de derrota dentro del source', { kind: 'MISSION_RIVAL_DEFEAT' }],
      ['un campo de mas dentro del source', { roll: 5 }],
    ])('rechaza un source con %s', async (_label, overrides) => {
      await expect(
        ledger().insertOne({
          _id: `v-${randomUUID()}`,
          ...common(),
          source: { ...completionSource(), ...overrides },
        }),
      ).rejects.toThrow()
    })

    it('rechaza un asiento de derrota que traiga `source` o le falten campos', async () => {
      const rival = {
        ...common(),
        roll: 5,
        enrollmentId: 'enr-1',
        simulationId: 'sim-1',
        encounterId: '5',
        enemyInstanceId: 'x#1',
        rivalRef: 'x',
      }

      await expect(
        ledger().insertOne({ _id: 'v-rival-source', ...rival, source: completionSource() }),
      ).rejects.toThrow()
      await expect(
        ledger().insertOne({ _id: 'v-rival-sin-roll', ...rival, roll: undefined }),
      ).rejects.toThrow()
      await expect(
        ledger().insertOne({ _id: `v-${randomUUID()}`, ...rival }),
      ).resolves.toMatchObject({ acknowledged: true })
    })
  })
})
