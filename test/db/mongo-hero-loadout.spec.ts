import 'reflect-metadata'

import { MongoDBContainer, type StartedMongoDBContainer } from '@testcontainers/mongodb'
import { type Collection, type Db, type MongoClient } from 'mongodb'

import { describeError } from '../../src/infrastructure/observability/describe-error'
import {
  createMongoClient,
  databaseOf,
  migrateToLatest,
} from '../../src/infrastructure/persistence/database'
import { MongoHeroLoadoutRepository } from '../../src/adapters/outbound/persistence/MongoHeroLoadoutRepository'
import { HeroLoadout } from '../../src/domain/entities/HeroLoadout'
import { HeroLoadoutConflictError } from '../../src/application/errors/ApplicationError'
import { PlayerId } from '../../src/domain/value-objects/identifiers'
import { documentId } from '../../src/adapters/outbound/persistence/hero-loadout-mapping'

/**
 * Adaptador del loadout de heroe contra un MongoDB REAL, en contenedor.
 *
 * Comprueba lo que un doble no puede: que el validador de `002-hero-loadouts`
 * exista de verdad, que el documento tenga la forma esperada y que el bloqueo
 * optimista de `save` sea real —dos escrituras con la misma version esperada,
 * una gana y la otra recibe conflicto—.
 */
describe('MongoHeroLoadoutRepository', () => {
  let container: StartedMongoDBContainer
  let client: MongoClient
  let db: Db
  let repository: MongoHeroLoadoutRepository

  let counter = 0
  const owner = (): PlayerId => {
    counter += 1
    return PlayerId.create(`jugador-${String(counter)}`)
  }

  const AT = new Date('2026-09-03T00:00:00.000Z')

  const loadouts = (): Collection<Record<string, unknown> & { _id: string }> =>
    db.collection<Record<string, unknown> & { _id: string }>('hero-loadouts')

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
    repository = new MongoHeroLoadoutRepository(db)
  })

  it('la migracion crea la coleccion con validador estricto', async () => {
    const collections = (await db.listCollections({ name: 'hero-loadouts' }).toArray()) as {
      options?: { validationAction?: string }
    }[]
    expect(collections).toHaveLength(1)
    expect(collections[0]?.options?.validationAction).toBe('error')
  })

  it('vuelve a aplicar la migracion sin cambiar nada (idempotente)', async () => {
    const { applied, error } = await migrateToLatest(db)
    expect(error).toBeUndefined()
    expect(applied).toEqual([])
  })

  it('guarda un loadout nuevo y lo recupera con la version incrementada', async () => {
    const player = owner()
    const loadout = HeroLoadout.createEmpty(player.value, 'heroe-1')
    loadout.equip({
      slot: 'WEAPON_1',
      itemId: 'espada-de-fuego',
      productId: 'pid-espada',
      category: 'WEAPON',
      occurredAt: AT,
    })

    const saved = await repository.save(loadout, 0)
    expect(saved.version).toBe(1)

    const found = await repository.findByHero(player, 'heroe-1')
    expect(found?.version).toBe(1)
    expect(found?.entry('WEAPON_1')?.itemId).toBe('espada-de-fuego')
    expect(await loadouts().countDocuments({ _id: documentId(player.value, 'heroe-1') })).toBe(1)
  })

  it('devuelve null cuando el heroe no tiene loadout', async () => {
    expect(await repository.findByHero(owner(), 'sin-loadout')).toBeNull()
  })

  it('actualiza en su sitio y sube la version, sin duplicar el documento', async () => {
    const player = owner()
    const first = HeroLoadout.createEmpty(player.value, 'heroe-2')
    first.equip({
      slot: 'WEAPON_1',
      itemId: 'espada',
      productId: 'pid-espada',
      category: 'WEAPON',
      occurredAt: AT,
    })
    await repository.save(first, 0)

    const reloaded = await repository.findByHero(player, 'heroe-2')
    reloaded?.equip({
      slot: 'HELMET',
      itemId: 'casco',
      productId: 'pid-casco',
      category: 'ARMOR',
      occurredAt: AT,
    })
    const saved = await repository.save(reloaded!, 1)

    expect(saved.version).toBe(2)
    expect(await loadouts().countDocuments({ _id: documentId(player.value, 'heroe-2') })).toBe(1)
    const found = await repository.findByHero(player, 'heroe-2')
    expect(
      found
        ?.toSnapshot()
        .entries.map((e) => e.slot)
        .sort(),
    ).toEqual(['HELMET', 'WEAPON_1'])
  })

  it('bloqueo optimista: dos escrituras con la misma version esperada, una gana y la otra recibe conflicto', async () => {
    const player = owner()
    const seed = HeroLoadout.createEmpty(player.value, 'heroe-3')
    seed.equip({
      slot: 'WEAPON_1',
      itemId: 'espada',
      productId: 'pid-espada',
      category: 'WEAPON',
      occurredAt: AT,
    })
    await repository.save(seed, 0)

    const branchA = await repository.findByHero(player, 'heroe-3')
    const branchB = await repository.findByHero(player, 'heroe-3')

    branchA?.equip({
      slot: 'WEAPON_2',
      itemId: 'hacha',
      productId: 'pid-hacha',
      category: 'WEAPON',
      occurredAt: AT,
    })
    branchB?.equip({
      slot: 'HELMET',
      itemId: 'casco',
      productId: 'pid-casco',
      category: 'ARMOR',
      occurredAt: AT,
    })

    const results = await Promise.allSettled([
      repository.save(branchA!, 1),
      repository.save(branchB!, 1),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toBeInstanceOf(HeroLoadoutConflictError)

    // El estado persistido es exactamente el de la escritura ganadora: no hay mezcla.
    const found = await repository.findByHero(player, 'heroe-3')
    expect(found?.version).toBe(2)
    expect(found?.toSnapshot().entries).toHaveLength(2)
  })

  it('dos creaciones concurrentes del mismo loadout: solo una prospera', async () => {
    const player = owner()
    const a = HeroLoadout.createEmpty(player.value, 'heroe-4')
    a.equip({
      slot: 'ITEM_1',
      itemId: 'pocion',
      productId: 'pid-pocion',
      category: 'ITEM',
      occurredAt: AT,
    })
    const b = HeroLoadout.createEmpty(player.value, 'heroe-4')
    b.equip({
      slot: 'ITEM_2',
      itemId: 'amuleto',
      productId: 'pid-amuleto',
      category: 'ITEM',
      occurredAt: AT,
    })

    const results = await Promise.allSettled([repository.save(a, 0), repository.save(b, 0)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await loadouts().countDocuments({ _id: documentId(player.value, 'heroe-4') })).toBe(1)
  })

  it('el validador del motor rechaza un documento con una ranura desconocida', async () => {
    await expect(
      loadouts().insertOne({
        _id: documentId('jugador-x', 'heroe-x'),
        ownerId: 'jugador-x',
        heroId: 'heroe-x',
        version: 0,
        entries: [{ slot: 'ANILLO', itemId: 'anillo', productId: 'p' }],
      }),
    ).rejects.toThrow()
  })
})
