import 'reflect-metadata'

import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import { type Collection, type Db, type MongoClient } from 'mongodb'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import {
  createMongoClient,
  databaseOf,
  migrateToLatest,
} from '../../src/infrastructure/persistence/database'
import { MongoHeroProgressionRepository } from '../../src/adapters/outbound/persistence/MongoHeroProgressionRepository'
import { HeroProgression } from '../../src/domain/entities/HeroProgression'
import { DomainError } from '../../src/domain/errors/DomainError'
import { HeroProgressionConflictError } from '../../src/application/errors/ApplicationError'
import { PlayerId } from '../../src/domain/value-objects/identifiers'

/**
 * Progresion de heroe contra un MongoDB REAL, en contenedor (HU-08, Task #189).
 *
 * Comprueba lo que un doble no puede: que el validador de
 * `008-hero-progressions` exista de verdad, que la clave por (jugador, heroe)
 * separe a los heroes, que el bloqueo optimista de `save` sea real, y —lo mas
 * importante— que **el motor RECHAZE un intento de persistir el umbral**, que es
 * la forma verificable de "no persistir el umbral calculado de manera
 * redundante".
 */
describe('MongoHeroProgressionRepository', () => {
  let container: StartedMongoDBContainer
  let client: MongoClient
  let db: Db
  let repository: MongoHeroProgressionRepository

  let counter = 0
  const owner = (): PlayerId => {
    counter += 1
    return PlayerId.create(`jugador-hu08-${String(counter)}`)
  }

  const progressions = (): Collection<Record<string, unknown> & { _id: string }> =>
    db.collection<Record<string, unknown> & { _id: string }>('hero-progressions')

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

    repository = new MongoHeroProgressionRepository(db)
  }, 180_000)

  afterAll(async () => {
    await client.close()
    await container.stop()
  })

  it('sin progresion previa devuelve null, sin crear el documento', async () => {
    const jugador = owner()

    await expect(repository.findByHero(jugador, 'pid-guerrero-tanque')).resolves.toBeNull()
    // Creacion perezosa de verdad: la lectura no sembro nada.
    await expect(progressions().countDocuments({ ownerId: jugador.value })).resolves.toBe(0)
  })

  it('guarda la progresion con la clave compuesta y la recupera', async () => {
    const jugador = owner()

    const guardada = await repository.save(
      HeroProgression.createEmpty(jugador.value, 'pid-guerrero-tanque'),
      0,
    )

    expect(guardada.version).toBe(1)

    const documento = await progressions().findOne({
      _id: `${jugador.value}::pid-guerrero-tanque`,
    })

    expect(documento).toMatchObject({
      ownerId: jugador.value,
      heroId: 'pid-guerrero-tanque',
      level: 1,
      currentXp: 0,
    })

    await expect(repository.findByHero(jugador, 'pid-guerrero-tanque')).resolves.toMatchObject({
      version: 1,
    })
  })

  /**
   * EL CONTROL CENTRAL DE ESTA TAREA. Si el esquema no llevara
   * `additionalProperties: false`, esta insercion pasaria y el umbral quedaria
   * persistido como valor derivado, desincronizable con el nivel.
   */
  it('el motor RECHAZA persistir el umbral calculado', async () => {
    await expect(
      progressions().insertOne({
        _id: 'jugador-con-umbral::pid-guerrero-tanque',
        ownerId: 'jugador-con-umbral',
        heroId: 'pid-guerrero-tanque',
        level: 3,
        currentXp: 400,
        version: 0,
        nextLevelThreshold: 800,
      }),
    ).rejects.toThrow()
  })

  it('el motor rechaza un nivel fuera del rango 1..8', async () => {
    await expect(
      progressions().insertOne({
        _id: 'jugador-nivel-cero::pid-guerrero-tanque',
        ownerId: 'jugador-nivel-cero',
        heroId: 'pid-guerrero-tanque',
        level: 0,
        currentXp: 0,
        version: 0,
      }),
    ).rejects.toThrow()

    await expect(
      progressions().insertOne({
        _id: 'jugador-nivel-nueve::pid-guerrero-tanque',
        ownerId: 'jugador-nivel-nueve',
        heroId: 'pid-guerrero-tanque',
        level: 9,
        currentXp: 0,
        version: 0,
      }),
    ).rejects.toThrow()
  })

  it('el motor rechaza experiencia negativa y version no entera', async () => {
    await expect(
      progressions().insertOne({
        _id: 'jugador-xp-negativa::pid-guerrero-tanque',
        ownerId: 'jugador-xp-negativa',
        heroId: 'pid-guerrero-tanque',
        level: 1,
        currentXp: -1,
        version: 0,
      }),
    ).rejects.toThrow()

    await expect(
      progressions().insertOne({
        _id: 'jugador-version-decimal::pid-guerrero-tanque',
        ownerId: 'jugador-version-decimal',
        heroId: 'pid-guerrero-tanque',
        level: 1,
        currentXp: 0,
        version: 1.5,
      }),
    ).rejects.toThrow()
  })

  /**
   * La clave es (jugador, heroe), no el jugador: el progreso de dos heroes del
   * mismo jugador son dos documentos distintos y no se pisan.
   */
  it('aísla por heroe dentro del mismo jugador', async () => {
    const jugador = owner()

    await repository.save(HeroProgression.createEmpty(jugador.value, 'pid-guerrero-tanque'), 0)
    await repository.save(HeroProgression.createEmpty(jugador.value, 'pid-mago-fuego'), 0)

    await expect(progressions().countDocuments({ ownerId: jugador.value })).resolves.toBe(2)
    await expect(repository.findByHero(jugador, 'pid-guerrero-tanque')).resolves.toMatchObject({
      heroId: 'pid-guerrero-tanque',
    })
    await expect(repository.findByHero(jugador, 'pid-mago-fuego')).resolves.toMatchObject({
      heroId: 'pid-mago-fuego',
    })
  })

  /**
   * CONTROL del bloqueo optimista con el motor real: dos escrituras con la misma
   * version esperada, una gana y la otra recibe conflicto. Sin esto, dos
   * recompensas simultaneas podrian acreditar experiencia dos veces.
   */
  it('dos escrituras con la misma version esperada: una gana, la otra choca', async () => {
    const jugador = owner()
    const inicial = await repository.save(
      HeroProgression.createEmpty(jugador.value, 'pid-guerrero-tanque'),
      0,
    )

    const resultados = await Promise.allSettled([
      repository.save(
        HeroProgression.restore({ ...inicial.toSnapshot(), currentXp: 150 }),
        inicial.version,
      ),
      repository.save(
        HeroProgression.restore({ ...inicial.toSnapshot(), currentXp: 180 }),
        inicial.version,
      ),
    ])

    expect(resultados.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1)

    const rechazadas = resultados.filter((entry) => entry.status === 'rejected')
    expect(rechazadas).toHaveLength(1)
    expect(rechazadas[0]?.reason).toBeInstanceOf(HeroProgressionConflictError)
  })

  it('dos inserciones simultaneas del mismo heroe: una gana, la otra choca', async () => {
    const jugador = owner()

    const resultados = await Promise.allSettled([
      repository.save(HeroProgression.createEmpty(jugador.value, 'pid-guerrero-tanque'), 0),
      repository.save(HeroProgression.createEmpty(jugador.value, 'pid-guerrero-tanque'), 0),
    ])

    expect(resultados.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1)
    expect(resultados.filter((entry) => entry.status === 'rejected')).toHaveLength(1)
    await expect(progressions().countDocuments({ ownerId: jugador.value })).resolves.toBe(1)
  })

  it('el nivel maximo se guarda y se relee sin producir un nivel 9', async () => {
    const jugador = owner()

    await repository.save(
      HeroProgression.restore({
        ownerId: jugador.value,
        heroId: 'pid-guerrero-tanque',
        level: 8,
        currentXp: 13000,
        version: 0,
      }),
      0,
    )

    const recuperada = await repository.findByHero(jugador, 'pid-guerrero-tanque')

    expect(recuperada?.level.value).toBe(8)
    expect(recuperada?.isAtMaxLevel()).toBe(true)
    expect(recuperada?.thresholdForNextLevel().status).toBe('MAX_LEVEL')
  })

  /**
   * La invariante del agregado, con el motor real de por medio: un documento
   * cuyo nivel no corresponde a su acumulado NO se sirve como si fuera bueno.
   * Se escribe saltandose el validador porque el validador no conoce la tabla
   * --solo conoce el rango-- y es el dominio quien la aplica.
   */
  it('un documento con nivel incoherente da error controlado al leerlo', async () => {
    const jugador = owner()
    const clave = `${jugador.value}::pid-guerrero-tanque`

    await db.command({ collMod: 'hero-progressions', validationLevel: 'off' })
    try {
      await progressions().insertOne({
        _id: clave,
        ownerId: jugador.value,
        heroId: 'pid-guerrero-tanque',
        // 749 acumulados son nivel 3: declarar 4 es un dato corrupto.
        level: 4,
        currentXp: 749,
        version: 0,
      })
    } finally {
      await db.command({ collMod: 'hero-progressions', validationLevel: 'strict' })
    }

    await expect(repository.findByHero(jugador, 'pid-guerrero-tanque')).rejects.toBeInstanceOf(
      DomainError,
    )
  })
})
