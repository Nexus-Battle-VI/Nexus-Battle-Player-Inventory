import { InMemoryHeroProgressionRepository } from '../../src/adapters/outbound/persistence/InMemoryHeroProgressionRepository'
import { GetHeroProgression } from '../../src/application/use-cases/GetHeroProgression'
import { HeroProgression } from '../../src/domain/entities/HeroProgression'
import { DomainError } from '../../src/domain/errors/DomainError'
import { PlayerId } from '../../src/domain/value-objects/identifiers'
import type { HeroProgressionRepositoryPort } from '../../src/application/ports/HeroProgressionRepositoryPort'

/**
 * Lectura de la progresion (HU-08, Task #189).
 *
 * El caso que define este caso de uso es la CREACION PEREZOSA: un heroe sin
 * documento no es un error ni obliga a sembrar nada.
 */
describe('GetHeroProgression', () => {
  /**
   * Doble explicito: delega en el repositorio real y cuenta las escrituras. Sin
   * esto, "creacion perezosa" seria una afirmacion del comentario y no una
   * comprobacion.
   */
  const build = (): {
    repository: InMemoryHeroProgressionRepository
    writes: () => number
    useCase: GetHeroProgression
  } => {
    const repository = new InMemoryHeroProgressionRepository()
    let writes = 0
    const counting: HeroProgressionRepositoryPort = {
      findByHero: (ownerId, heroId) => repository.findByHero(ownerId, heroId),
      save: (progression, expectedVersion) => {
        writes += 1
        return repository.save(progression, expectedVersion)
      },
    }

    return { repository, writes: () => writes, useCase: new GetHeroProgression(counting) }
  }

  it('un heroe sin progresion se lee como nivel 1 con 0, sin escribir nada', async () => {
    const { repository, writes, useCase } = build()

    const dto = await useCase.execute('jugador-1', 'heroe-1')

    expect(dto).toEqual({
      heroId: 'heroe-1',
      level: 1,
      currentXp: 0,
      nextLevel: { status: 'AVAILABLE', forNextLevel: 2, amount: 200 },
      maxLevel: 8,
    })
    // Creacion perezosa de verdad: no se creo el documento.
    expect(writes()).toBe(0)
    expect(await repository.findByHero(PlayerId.create('jugador-1'), 'heroe-1')).toBeNull()
  })

  it('normaliza el heroe antes de buscar, para no leer una clave y crear otra', async () => {
    const { repository, useCase } = build()
    await repository.save(HeroProgression.createEmpty('jugador-1', 'heroe-1'), 0)

    const dto = await useCase.execute('jugador-1', '  heroe-1  ')

    expect(dto.heroId).toBe('heroe-1')
    expect(dto.level).toBe(1)
  })

  it('rechaza un heroe vacio en la frontera', async () => {
    const { useCase } = build()

    await expect(useCase.execute('jugador-1', '   ')).rejects.toBeInstanceOf(DomainError)
  })

  it('rechaza un jugador vacio', async () => {
    const { useCase } = build()

    await expect(useCase.execute('', 'heroe-1')).rejects.toBeInstanceOf(DomainError)
  })

  it('deriva el umbral del nivel persistido', async () => {
    const { repository, useCase } = build()
    await repository.save(
      HeroProgression.restore({
        ownerId: 'jugador-1',
        heroId: 'heroe-1',
        level: 5,
        currentXp: 2000,
        version: 0,
      }),
      0,
    )

    const dto = await useCase.execute('jugador-1', 'heroe-1')

    expect(dto.level).toBe(5)
    expect(dto.currentXp).toBe(2000)
    expect(dto.nextLevel).toEqual({
      status: 'AVAILABLE',
      forNextLevel: 6,
      amount: 3200,
    })
  })

  it('devuelve el acumulado tal cual: subir de nivel no lo descuenta', async () => {
    const { repository, useCase } = build()
    await repository.save(
      HeroProgression.restore({
        ownerId: 'jugador-1',
        heroId: 'heroe-1',
        level: 3,
        currentXp: 749,
        version: 0,
      }).awardExperience(100),
      0,
    )

    const dto = await useCase.execute('jugador-1', 'heroe-1')

    // El heroe subio del 3 al 4 y conserva los 849: la experiencia es acumulada
    // y el ascenso no le resta los 800 que costo llegar.
    expect(dto.level).toBe(4)
    expect(dto.currentXp).toBe(849)
    expect(dto.nextLevel).toEqual({ status: 'AVAILABLE', forNextLevel: 5, amount: 1600 })
  })

  it('en nivel maximo devuelve MAX_LEVEL', async () => {
    const { repository, useCase } = build()
    await repository.save(
      HeroProgression.restore({
        ownerId: 'jugador-1',
        heroId: 'heroe-1',
        level: 8,
        currentXp: 13500,
        version: 0,
      }),
      0,
    )

    const dto = await useCase.execute('jugador-1', 'heroe-1')

    expect(dto.nextLevel.status).toBe('MAX_LEVEL')
    expect(dto.nextLevel.forNextLevel).toBeNull()
  })
})
