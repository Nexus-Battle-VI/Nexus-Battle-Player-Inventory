import 'reflect-metadata'

import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import { type Collection, type Db, type MongoClient } from 'mongodb'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import {
  createMongoClient,
  databaseOf,
  migrateToLatest,
} from '../../src/infrastructure/persistence/database'
import { MongoHeroSelectionRepository } from '../../src/adapters/outbound/persistence/MongoHeroSelectionRepository'
import { HeroSelection } from '../../src/domain/entities/HeroSelection'
import { HeroSelectionConflictError } from '../../src/application/errors/ApplicationError'
import { PlayerId } from '../../src/domain/value-objects/identifiers'

/**
 * Seleccion de heroe contra un MongoDB REAL, en contenedor.
 *
 * Comprueba lo que un doble no puede: que el validador de `004-hero-selections`
 * exista de verdad, que el documento tenga la forma esperada, que la clave
 * primaria por jugador impida dos heroes preparados a la vez y que el bloqueo
 * optimista de `save` sea real.
 */
describe('MongoHeroSelectionRepository', () => {
  let container: StartedMongoDBContainer
  let client: MongoClient
  let db: Db
  let repository: MongoHeroSelectionRepository

  let counter = 0
  const owner = (): PlayerId => {
    counter += 1
    return PlayerId.create(`jugador-hu07-${String(counter)}`)
  }

  const AT = new Date('2026-09-03T10:00:00.000Z')
  const LATER = new Date('2026-09-03T11:00:00.000Z')

  const selections = (): Collection<Record<string, unknown> & { _id: string }> =>
    db.collection<Record<string, unknown> & { _id: string }>('hero-selections')

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

    repository = new MongoHeroSelectionRepository(db)
  }, 180_000)

  afterAll(async () => {
    await client.close()
    await container.stop()
  })

  it('sin seleccion previa devuelve null', async () => {
    await expect(repository.findByOwner(owner())).resolves.toBeNull()
  })

  it('guarda la seleccion con el jugador como _id y la recupera', async () => {
    const jugador = owner()

    const guardada = await repository.save(
      HeroSelection.create(jugador.value, 'pid-guerrero-tanque', AT),
      0,
    )

    expect(guardada.version).toBe(1)

    const documento = await selections().findOne({ _id: jugador.value })
    expect(documento).toMatchObject({
      _id: jugador.value,
      heroId: 'pid-guerrero-tanque',
      selectedAt: AT,
    })

    await expect(repository.findByOwner(jugador)).resolves.toMatchObject({
      heroId: 'pid-guerrero-tanque',
      version: 1,
    })
  })

  /**
   * La invariante que el diseno del documento hace imposible de romper: elegir
   * otro heroe SUSTITUYE el documento. Se comprueba contando documentos del
   * jugador, no leyendo la seleccion: contarlos es lo unico que demostraria
   * que no quedo una segunda fila olvidada.
   */
  it('cambiar de heroe deja exactamente un documento por jugador', async () => {
    const jugador = owner()

    const primera = await repository.save(
      HeroSelection.create(jugador.value, 'pid-guerrero-tanque', AT),
      0,
    )
    await repository.save(primera.selectAnother('pid-mago-fuego', LATER), primera.version)

    await expect(selections().countDocuments({ _id: jugador.value })).resolves.toBe(1)
    await expect(repository.findByOwner(jugador)).resolves.toMatchObject({
      heroId: 'pid-mago-fuego',
      version: 2,
    })
  })

  /**
   * CONTROL del bloqueo optimista con el motor real: dos escrituras con la
   * misma version esperada, una gana y la otra recibe conflicto. Sin esto, dos
   * peticiones simultaneas podrian dejar preparado un heroe que el jugador no
   * eligio el ultimo.
   */
  it('dos escrituras con la misma version esperada: una gana, la otra choca', async () => {
    const jugador = owner()
    const inicial = await repository.save(
      HeroSelection.create(jugador.value, 'pid-guerrero-tanque', AT),
      0,
    )

    const resultados = await Promise.allSettled([
      repository.save(inicial.selectAnother('pid-mago-fuego', LATER), inicial.version),
      repository.save(inicial.selectAnother('pid-chaman', LATER), inicial.version),
    ])

    const cumplidas = resultados.filter((entry) => entry.status === 'fulfilled')
    const rechazadas = resultados.filter((entry) => entry.status === 'rejected')

    expect(cumplidas).toHaveLength(1)
    expect(rechazadas).toHaveLength(1)
    expect(rechazadas[0]?.reason).toBeInstanceOf(HeroSelectionConflictError)
  })

  it('dos inserciones simultaneas del mismo jugador: una gana, la otra choca', async () => {
    const jugador = owner()

    const resultados = await Promise.allSettled([
      repository.save(HeroSelection.create(jugador.value, 'pid-guerrero-tanque', AT), 0),
      repository.save(HeroSelection.create(jugador.value, 'pid-mago-fuego', AT), 0),
    ])

    expect(resultados.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1)
    expect(resultados.filter((entry) => entry.status === 'rejected')).toHaveLength(1)
    await expect(selections().countDocuments({ _id: jugador.value })).resolves.toBe(1)
  })

  /**
   * El validador vive en el motor y no en la aplicacion. Se comprueba
   * escribiendo a mano un documento con un campo de mas: si el validador no
   * existiera, la insercion pasaria y esta prueba fallaria.
   */
  it('el motor rechaza un documento con campos ajenos al esquema', async () => {
    await expect(
      selections().insertOne({
        _id: 'jugador-con-basura',
        heroId: 'pid-guerrero-tanque',
        selectedAt: AT,
        version: 0,
        campoInventado: true,
      }),
    ).rejects.toThrow()
  })

  it('el motor rechaza una version que no es entera', async () => {
    await expect(
      selections().insertOne({
        _id: 'jugador-version-decimal',
        heroId: 'pid-guerrero-tanque',
        selectedAt: AT,
        version: 1.5,
      }),
    ).rejects.toThrow()
  })
})
