import 'reflect-metadata'

import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import { type Collection, type Db, type MongoClient } from 'mongodb'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import {
  createMongoClient,
  databaseOf,
  migrateToLatest,
} from '../../src/infrastructure/persistence/database'
import { MongoHeroEpicSelectionRepository } from '../../src/adapters/outbound/persistence/MongoHeroEpicSelectionRepository'
import { HeroEpicSelection } from '../../src/domain/entities/HeroEpicSelection'
import { HeroEpicSelectionConflictError } from '../../src/application/errors/ApplicationError'
import { PlayerId } from '../../src/domain/value-objects/identifiers'
import { documentId } from '../../src/adapters/outbound/persistence/hero-epic-selection-mapping'

/**
 * Adaptador de la epica equipada (HU-31) contra un MongoDB REAL, en
 * contenedor. Comprueba lo que un doble no puede: que el validador de
 * `016-hero-epic-selections` exista de verdad y que el bloqueo optimista de
 * `save` sea real.
 */
describe('MongoHeroEpicSelectionRepository', () => {
  let container: StartedMongoDBContainer
  let client: MongoClient
  let db: Db
  let repository: MongoHeroEpicSelectionRepository

  let counter = 0
  const owner = (): PlayerId => {
    counter += 1
    return PlayerId.create(`jugador-${String(counter)}`)
  }

  const AT = new Date('2026-10-03T00:00:00.000Z')

  const selections = (): Collection<Record<string, unknown> & { _id: string }> =>
    db.collection<Record<string, unknown> & { _id: string }>('hero-epic-selections')

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
    repository = new MongoHeroEpicSelectionRepository(db)
  })

  it('la migracion crea la coleccion con validador estricto', async () => {
    const collections = (await db.listCollections({ name: 'hero-epic-selections' }).toArray()) as {
      options?: { validationAction?: string }
    }[]
    expect(collections).toHaveLength(1)
    expect(collections[0]?.options?.validationAction).toBe('error')
  })

  it('guarda una seleccion nueva y la recupera con la version incrementada', async () => {
    const player = owner()
    const selection = HeroEpicSelection.createEmpty(player.value, 'heroe-1')
    selection.equip({ epicItemId: 'golpe-de-defensa', epicProductId: 'pid-golpe', occurredAt: AT })

    const saved = await repository.save(selection, 0)
    expect(saved.version).toBe(1)

    const found = await repository.findByHero(player, 'heroe-1')
    expect(found?.epicItemId).toBe('golpe-de-defensa')
    expect(found?.epicProductId).toBe('pid-golpe')
    expect(found?.version).toBe(1)
  })

  it('acepta un epicItemId con forma de productId UUID, como el que deja una compra real', async () => {
    const player = owner()
    const selection = HeroEpicSelection.createEmpty(player.value, 'heroe-uuid')
    selection.equip({
      epicItemId: '3f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f',
      epicProductId: 'pid-golpe',
      occurredAt: AT,
    })

    const saved = await repository.save(selection, 0)
    expect(saved.epicItemId).toBe('3f1e2d3c-4b5a-4c6d-8e7f-9a0b1c2d3e4f')
  })

  it('devuelve null cuando el heroe no tiene epica equipada', async () => {
    const player = owner()
    await expect(repository.findByHero(player, 'heroe-sin-epica')).resolves.toBeNull()
  })

  it('actualiza en su sitio y sube la version, sin duplicar el documento', async () => {
    const player = owner()
    const first = HeroEpicSelection.createEmpty(player.value, 'heroe-2')
    first.equip({ epicItemId: 'golpe-de-defensa', epicProductId: 'pid-golpe', occurredAt: AT })
    await repository.save(first, 0)

    const reloaded = await repository.findByHero(player, 'heroe-2')
    reloaded!.equip({ epicItemId: 'segundo-impulso', epicProductId: 'pid-segundo', occurredAt: AT })
    const saved = await repository.save(reloaded!, 1)

    expect(saved.version).toBe(2)
    expect(saved.epicItemId).toBe('segundo-impulso')
    expect(await selections().countDocuments({ _id: documentId(player.value, 'heroe-2') })).toBe(1)
  })

  it('bloqueo optimista: dos escrituras con la misma version esperada, una gana y la otra recibe conflicto', async () => {
    const player = owner()
    const seed = HeroEpicSelection.createEmpty(player.value, 'heroe-3')
    seed.equip({ epicItemId: 'golpe-de-defensa', epicProductId: 'pid-golpe', occurredAt: AT })
    await repository.save(seed, 0)

    const branchA = await repository.findByHero(player, 'heroe-3')
    const branchB = await repository.findByHero(player, 'heroe-3')

    branchA?.equip({ epicItemId: 'segundo-impulso', epicProductId: 'pid-segundo', occurredAt: AT })
    branchB?.equip({ epicItemId: 'luz-cegadora', epicProductId: 'pid-luz', occurredAt: AT })

    const results = await Promise.allSettled([
      repository.save(branchA!, 1),
      repository.save(branchB!, 1),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toBeInstanceOf(HeroEpicSelectionConflictError)

    const found = await repository.findByHero(player, 'heroe-3')
    expect(found?.version).toBe(2)
  })

  it('dos creaciones concurrentes de la misma seleccion: solo una prospera', async () => {
    const player = owner()
    const a = HeroEpicSelection.createEmpty(player.value, 'heroe-4')
    a.equip({ epicItemId: 'golpe-de-defensa', epicProductId: 'pid-golpe', occurredAt: AT })
    const b = HeroEpicSelection.createEmpty(player.value, 'heroe-4')
    b.equip({ epicItemId: 'segundo-impulso', epicProductId: 'pid-segundo', occurredAt: AT })

    const results = await Promise.allSettled([repository.save(a, 0), repository.save(b, 0)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await selections().countDocuments({ _id: documentId(player.value, 'heroe-4') })).toBe(1)
  })

  it('el validador del motor rechaza un documento con una pareja incompleta de referencias', async () => {
    await expect(
      selections().insertOne({
        _id: documentId('jugador-x', 'heroe-x'),
        ownerId: 'jugador-x',
        heroId: 'heroe-x',
        version: 0,
        epicItemId: 'golpe-de-defensa',
        // epicProductId omitido a proposito: el validador exige ambas claves.
      }),
    ).rejects.toThrow()
  })
})
