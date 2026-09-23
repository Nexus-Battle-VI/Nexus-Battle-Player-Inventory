import { Test } from '@nestjs/testing'

import {
  GET_HERO_PROGRESSION,
  QUERY_EXPERIENCE_THRESHOLD,
} from '../../src/adapters/inbound/http/tokens'
import { InMemoryHeroProgressionRepository } from '../../src/adapters/outbound/persistence/InMemoryHeroProgressionRepository'
import { GetHeroProgression } from '../../src/application/use-cases/GetHeroProgression'
import { QueryExperienceThreshold } from '../../src/application/use-cases/QueryExperienceThreshold'
import {
  HERO_PROGRESSION_REPOSITORY,
  type HeroProgressionRepositoryPort,
} from '../../src/application/ports/HeroProgressionRepositoryPort'

/**
 * Cableado de HU-08 (Task #189).
 *
 * Un proveedor mal registrado no falla al compilar: falla al arrancar, y solo
 * cuando alguien pide el token. Esta suite resuelve los tres proveedores nuevos
 * con las MISMAS fabricas que usa `app.module.ts` —repositorio en memoria, que
 * es la rama de `PERSISTENCE_DRIVER=memory`— para que un error de registro se
 * vea aqui y no en produccion.
 *
 * Se replica la fabrica en lugar de importar `AppModule` a proposito: importarlo
 * obligaria a tener configuracion y Mongo reales, y esta comprobacion debe poder
 * correr en la suite unitaria.
 */
describe('Cableado de la progresion del heroe (HU-08)', () => {
  const buildModule = async () =>
    Test.createTestingModule({
      providers: [
        {
          provide: HERO_PROGRESSION_REPOSITORY,
          useFactory: (): HeroProgressionRepositoryPort => new InMemoryHeroProgressionRepository(),
        },
        {
          provide: QUERY_EXPERIENCE_THRESHOLD,
          useFactory: (): QueryExperienceThreshold => new QueryExperienceThreshold(),
        },
        {
          provide: GET_HERO_PROGRESSION,
          useFactory: (progressions: HeroProgressionRepositoryPort): GetHeroProgression =>
            new GetHeroProgression(progressions),
          inject: [HERO_PROGRESSION_REPOSITORY],
        },
      ],
    }).compile()

  it('resuelve el repositorio de progresion', async () => {
    const moduleRef = await buildModule()

    const repository = moduleRef.get<HeroProgressionRepositoryPort>(HERO_PROGRESSION_REPOSITORY)

    expect(repository).toBeInstanceOf(InMemoryHeroProgressionRepository)
  })

  it('resuelve la operacion reutilizable del umbral y calcula sin conocer la tabla', async () => {
    const moduleRef = await buildModule()

    const threshold = moduleRef.get<QueryExperienceThreshold>(QUERY_EXPERIENCE_THRESHOLD)

    expect(threshold).toBeInstanceOf(QueryExperienceThreshold)
    // Es el punto por el que HU-09 y HU-10 pediran el umbral: devuelve el valor
    // de la tabla sin que el consumidor sepa como se obtiene.
    expect(threshold.execute(4)).toEqual({
      status: 'AVAILABLE',
      forNextLevel: 5,
      amount: 1600,
    })
    expect(threshold.execute(8).status).toBe('MAX_LEVEL')
    // Y la otra direccion, que es la que hace falta despues de acreditar una
    // recompensa: en que nivel queda el heroe con este acumulado.
    expect(threshold.resolveLevel(749)).toBe(3)
    expect(threshold.resolveLevel(890)).toBe(4)
  })

  it('resuelve el caso de uso de lectura con el repositorio inyectado', async () => {
    const moduleRef = await buildModule()

    const useCase = moduleRef.get<GetHeroProgression>(GET_HERO_PROGRESSION)

    expect(useCase).toBeInstanceOf(GetHeroProgression)
    await expect(useCase.execute('jugador-1', 'heroe-1')).resolves.toMatchObject({
      heroId: 'heroe-1',
      level: 1,
      currentXp: 0,
      maxLevel: 8,
    })
  })
})
