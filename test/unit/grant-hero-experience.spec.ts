import { DomainError } from '../../src/domain/errors/DomainError'
import { ExperienceGrantRejectedError } from '../../src/application/errors/ApplicationError'
import { InMemoryExperienceGrantRepository } from '../../src/adapters/outbound/persistence/InMemoryExperienceGrantRepository'
import type {
  ExperienceGrantCommand,
  ExperienceGrantPort,
} from '../../src/application/ports/ExperienceGrantPort'
import {
  GrantHeroExperience,
  type GrantHeroExperienceCommand,
} from '../../src/application/use-cases/GrantHeroExperience'

/**
 * Caso de uso de la acreditacion de experiencia (HU-09, Task HU-09.3;
 * `hu-09-experience-reward-v1` §7).
 *
 * Lo que se comprueba:
 *   - el importe se ACREDITA con la aritmetica de HU-08 y no se recalcula aqui;
 *   - la experiencia se acumula SIN RESTAR al subir de nivel;
 *   - una sola acreditacion puede cruzar VARIOS niveles;
 *   - el nivel 8 no descarta experiencia;
 *   - `nextLevel` y `maxLevel` se derivan al leer y el nivel maximo no inventa un
 *     nivel 9;
 *   - un importe fraccionario o negativo es `422`, y un cuerpo mal formado es `400`.
 */
const HERO_ID = '7f3c2a9e-2d4b-4c1a-9e7f-1b2c3d4e5f60'
const PLAYER_ID = 'sub-jugador-1'

const sourceWith = (overrides: Record<string, unknown> = {}) => ({
  kind: 'MISSION_RIVAL_DEFEAT',
  enrollmentId: 'enr_01JB8Y3K7Q',
  simulationId: 'sim_01JB8Y4B',
  encounterId: '5',
  enemyInstanceId: 'guardian-eterno#1',
  rivalRef: 'guardian-eterno',
  roll: 5,
  ...overrides,
})

const commandWith = (
  overrides: Partial<GrantHeroExperienceCommand> = {},
): GrantHeroExperienceCommand => ({
  schemaVersion: 1,
  operationId: 'mission:enr_01JB8Y3K7Q:encounter:5:enemy:guardian-eterno#1:hero:h1:xp',
  playerId: PLAYER_ID,
  heroId: HERO_ID,
  amount: 25,
  source: sourceWith(),
  ...overrides,
})

/** Puerto espia: anota el comando ya normalizado que recibio el adaptador. */
class RecordingPort implements ExperienceGrantPort {
  readonly received: ExperienceGrantCommand[] = []

  constructor(private readonly fallback: ExperienceGrantPort) {}

  grant(command: ExperienceGrantCommand) {
    this.received.push(command)

    return this.fallback.grant(command)
  }
}

describe('GrantHeroExperience', () => {
  let adapter: InMemoryExperienceGrantRepository
  let port: RecordingPort
  let useCase: GrantHeroExperience

  beforeEach(() => {
    adapter = new InMemoryExperienceGrantRepository()
    port = new RecordingPort(adapter)
    useCase = new GrantHeroExperience(port)
  })

  it('acredita una recompensa simple y devuelve el estado resultante', async () => {
    const result = await useCase.execute(commandWith({ amount: 25 }))

    expect(result).toMatchObject({
      applied: true,
      heroId: HERO_ID,
      level: 1,
      currentXp: 25,
      leveledUp: false,
      levelsGained: 0,
      maxLevel: 8,
    })
    expect(result.nextLevel).toEqual({ status: 'AVAILABLE', forNextLevel: 2, amount: 200 })
  })

  it('acumula SIN RESTAR: 749 + 100 = 849 y el nivel pasa a 4 conservando todo', async () => {
    const first = await useCase.execute(commandWith({ operationId: 'op-1', amount: 749 }))
    expect(first).toMatchObject({ currentXp: 749, level: 3 })

    const second = await useCase.execute(commandWith({ operationId: 'op-2', amount: 100 }))

    expect(second).toMatchObject({ currentXp: 849, level: 4, leveledUp: true, levelsGained: 1 })
    // El umbral alcanzado NO se descuenta: 849 sigue ahi.
    expect(second.currentXp).toBe(849)
    expect(second.nextLevel).toEqual({ status: 'AVAILABLE', forNextLevel: 5, amount: 1600 })
  })

  it('una sola acreditacion puede cruzar VARIOS niveles: 190 + 700 = 890, nivel 4', async () => {
    // 190 acumulados son nivel 1 (el umbral del nivel 1 es 100 y el del 2, 200);
    // 890 son nivel 4. Una sola acreditacion cruza TRES niveles de golpe.
    await useCase.execute(commandWith({ operationId: 'op-1', amount: 190 }))

    const jump = await useCase.execute(commandWith({ operationId: 'op-2', amount: 700 }))

    expect(jump).toMatchObject({ currentXp: 890, level: 4, leveledUp: true, levelsGained: 3 })
  })

  it('en el nivel 8 NO se descarta experiencia y el umbral dice MAX_LEVEL', async () => {
    // 8 acreditaciones de 1600 llevan el acumulado a 12800, que es el nivel 8.
    for (let index = 0; index < 8; index += 1) {
      await useCase.execute(commandWith({ operationId: `op-${String(index)}`, amount: 1600 }))
    }

    const atMax = await useCase.execute(commandWith({ operationId: 'op-max', amount: 500 }))

    expect(atMax).toMatchObject({
      currentXp: 13300,
      level: 8,
      leveledUp: false,
      levelsGained: 0,
      maxLevel: 8,
    })
    // Sin nivel 9: la union discriminada dice MAX_LEVEL y no calcula umbral.
    expect(atMax.nextLevel).toEqual({
      status: 'MAX_LEVEL',
      currentLevel: 8,
      forNextLevel: null,
      amount: null,
    })
  })

  it('el heroe sin documento de progresion se acredita desde nivel 1 con 0', async () => {
    const result = await useCase.execute(commandWith({ amount: 0 }))

    expect(result).toMatchObject({ currentXp: 0, level: 1, leveledUp: false, levelsGained: 0 })
  })

  it('pasa al adaptador el comando NORMALIZADO, con el jugador y el heroe de la ruta', async () => {
    await useCase.execute(commandWith({ operationId: '  op-con-espacios  ' }))

    expect(port.received).toHaveLength(1)
    expect(port.received[0]).toMatchObject({
      operationId: 'op-con-espacios',
      ownerId: PLAYER_ID,
      heroId: HERO_ID,
      amount: 25,
    })
    expect(port.received[0]?.source).toEqual(sourceWith())
  })

  it('NO pliega el caso del operationId: la clave lleva referencias de arquetipo', async () => {
    await useCase.execute(commandWith({ operationId: 'mission:E:encounter:5:enemy:Sombra#1:xp' }))

    // Si se plegara el caso, dos derrotas distintas podrian acabar en la misma clave.
    expect(port.received[0]?.operationId).toBe('mission:E:encounter:5:enemy:Sombra#1:xp')
  })

  it.each([25.5, -1, 25.0000001])('un importe NO entero o negativo es 422: %s', async (amount) => {
    await expect(useCase.execute(commandWith({ amount }))).rejects.toBeInstanceOf(
      ExperienceGrantRejectedError,
    )

    expect(port.received).toEqual([])
  })

  it.each([undefined, null, '25', {}])('un importe que no es numero es 422: %s', async (amount) => {
    await expect(useCase.execute(commandWith({ amount }))).rejects.toBeInstanceOf(
      ExperienceGrantRejectedError,
    )
  })

  it('acepta el importe 0: la tabla empieza en enteros no negativos', async () => {
    await expect(useCase.execute(commandWith({ amount: 0 }))).resolves.toMatchObject({
      currentXp: 0,
    })
  })

  it.each([0, 2, '1', undefined, null])(
    'una schemaVersion que no es la vigente es 400: %s',
    async (schemaVersion) => {
      await expect(
        useCase.execute(commandWith({ schemaVersion: schemaVersion as number })),
      ).rejects.toBeInstanceOf(DomainError)
    },
  )

  it('rechaza un jugador o un heroe vacios (400, no 422)', async () => {
    await expect(useCase.execute(commandWith({ playerId: '   ' }))).rejects.toBeInstanceOf(
      DomainError,
    )
    await expect(useCase.execute(commandWith({ heroId: '' }))).rejects.toBeInstanceOf(DomainError)
  })

  it('rechaza un operationId vacio', async () => {
    await expect(useCase.execute(commandWith({ operationId: ' ' }))).rejects.toBeInstanceOf(
      DomainError,
    )
  })

  it.each(['enrollmentId', 'simulationId', 'encounterId', 'enemyInstanceId', 'rivalRef'])(
    'rechaza un origen sin %s',
    async (field) => {
      await expect(
        useCase.execute(commandWith({ source: sourceWith({ [field]: '' }) })),
      ).rejects.toBeInstanceOf(DomainError)
    },
  )

  it.each([
    ['kind distinto', { kind: 'MISSION_COMPLETED' }],
    ['roll 0', { roll: 0 }],
    ['roll fraccionario', { roll: 2.5 }],
    ['origen que no es objeto', 'no-es-objeto'],
  ])('rechaza un origen invalido: %s', async (_label, source) => {
    await expect(useCase.execute(commandWith({ source }))).rejects.toBeInstanceOf(DomainError)
  })

  it('no impone techo a la tirada: el dado es de Combat', async () => {
    // `roll` es trazabilidad; el numero de caras no es regla de este servicio.
    await expect(
      useCase.execute(commandWith({ source: sourceWith({ roll: 100 }) })),
    ).resolves.toMatchObject({ applied: true })
  })

  it('un reintento NO vuelve a acreditar y devuelve el mismo resultado', async () => {
    const first = await useCase.execute(commandWith({ amount: 100 }))
    const replay = await useCase.execute(commandWith({ amount: 100 }))

    expect(replay).toMatchObject({
      applied: false,
      currentXp: first.currentXp,
      level: first.level,
      leveledUp: first.leveledUp,
      levelsGained: first.levelsGained,
    })
  })

  it('el mismo operationId con OTRO contenido es conflicto y no se acredita', async () => {
    await useCase.execute(commandWith({ amount: 100 }))

    await expect(useCase.execute(commandWith({ amount: 200 }))).rejects.toThrow(/ya existe/)
  })

  it('el umbral se DERIVA al leer y no se guarda en el asiento', async () => {
    // 1600 acumulados son nivel 5; el siguiente umbral es el del nivel 6.
    const result = await useCase.execute(commandWith({ amount: 1600 }))

    expect(result.nextLevel).toEqual({ status: 'AVAILABLE', forNextLevel: 6, amount: 3200 })
    expect(Object.keys(result)).not.toContain('persistedNextLevel')
  })
})
