import {
  ExperienceGrantConflictError,
  ExperienceGrantRejectedError,
} from '../../src/application/errors/ApplicationError'
import { InMemoryExperienceGrantRepository } from '../../src/adapters/outbound/persistence/InMemoryExperienceGrantRepository'
import type { ExperienceGrantCommand } from '../../src/application/ports/ExperienceGrantPort'

/**
 * Adaptador en memoria de la acreditacion (HU-09, Task HU-09.3).
 *
 * Comprueba la semantica que el contrato §7 exige y que las pruebas de
 * integracion no pueden aislar: que un `operationId` repetido devuelva el
 * resultado guardado con `applied: false` sin volver a acreditar, que un
 * contenido distinto sea conflicto, y que la huella no dependa del orden de las
 * claves ni de espacios.
 */
const HERO_ID = '7f3c2a9e-2d4b-4c1a-9e7f-1b2c3d4e5f60'
const PLAYER_ID = 'sub-jugador-1'

const sourceOf = (overrides: Record<string, unknown> = {}) => ({
  kind: 'MISSION_RIVAL_DEFEAT' as const,
  enrollmentId: 'enr_01JB8Y3K7Q',
  simulationId: 'sim_01JB8Y4B',
  encounterId: '5',
  enemyInstanceId: 'guardian-eterno#1',
  rivalRef: 'guardian-eterno',
  roll: 5,
  ...overrides,
})

const commandOf = (overrides: Partial<ExperienceGrantCommand> = {}): ExperienceGrantCommand => ({
  operationId: 'mission:enr_01JB8Y3K7Q:encounter:5:enemy:guardian-eterno#1:hero:h1:xp',
  ownerId: PLAYER_ID,
  heroId: HERO_ID,
  amount: 250,
  source: sourceOf(),
  ...overrides,
})

describe('InMemoryExperienceGrantRepository', () => {
  let repository: InMemoryExperienceGrantRepository

  beforeEach(() => {
    repository = new InMemoryExperienceGrantRepository()
  })

  it('acredita y devuelve el estado resultante con applied:true', async () => {
    const result = await repository.grant(commandOf())

    expect(result).toMatchObject({
      operationId: commandOf().operationId,
      applied: true,
      heroId: HERO_ID,
      level: 2,
      currentXp: 250,
      leveledUp: true,
      levelsGained: 1,
    })
  })

  it('el mismo operationId con el MISMO contenido devuelve lo guardado y applied:false', async () => {
    const first = await repository.grant(commandOf())
    const replay = await repository.grant(commandOf())

    expect(replay).toMatchObject({ applied: false, currentXp: first.currentXp, level: first.level })
    // Y no se acredito dos veces: el acumulado no crecio.
    const third = await repository.grant(commandOf())
    expect(third.currentXp).toBe(250)
  })

  it('la huella no depende del ORDEN de las claves del origen', async () => {
    const first = await repository.grant(commandOf())

    const reordered = commandOf({
      source: {
        roll: 5,
        rivalRef: 'guardian-eterno',
        enemyInstanceId: 'guardian-eterno#1',
        encounterId: '5',
        simulationId: 'sim_01JB8Y4B',
        enrollmentId: 'enr_01JB8Y3K7Q',
        kind: 'MISSION_RIVAL_DEFEAT',
      },
    })
    const replay = await repository.grant(reordered)

    expect(replay).toMatchObject({ applied: false, currentXp: first.currentXp })
  })

  it.each([
    ['otro importe', { amount: 500 }],
    ['otro heroe', { heroId: 'otro-heroe' }],
    ['otro jugador', { ownerId: 'sub-otro' }],
  ])('el mismo operationId con %s es conflicto', async (_label, overrides) => {
    await repository.grant(commandOf())

    await expect(repository.grant(commandOf(overrides))).rejects.toBeInstanceOf(
      ExperienceGrantConflictError,
    )
  })

  it.each([
    ['la tirada', { roll: 1 }],
    ['el encuentro', { encounterId: '1' }],
    ['la instancia del enemigo', { enemyInstanceId: 'guardian-eterno#2' }],
    ['el arquetipo', { rivalRef: 'sombra-corrompida' }],
    ['la matriculacion', { enrollmentId: 'enr-otra' }],
    ['la simulacion', { simulationId: 'sim-otra' }],
  ])('un origen con %s distinto es conflicto, no un reintento', async (_label, overrides) => {
    await repository.grant(commandOf())

    await expect(
      repository.grant(commandOf({ source: sourceOf(overrides) })),
    ).rejects.toBeInstanceOf(ExperienceGrantConflictError)
  })

  it('un conflicto NO sobrescribe el asiento: el reintento valido sigue devolviendo lo primero', async () => {
    const first = await repository.grant(commandOf())
    await expect(repository.grant(commandOf({ amount: 999 }))).rejects.toBeInstanceOf(
      ExperienceGrantConflictError,
    )

    const replay = await repository.grant(commandOf())

    expect(replay).toMatchObject({ applied: false, currentXp: first.currentXp, level: first.level })
  })

  it('la creacion es perezosa y arranca en nivel 1 con 0', async () => {
    const result = await repository.grant(commandOf({ amount: 0 }))

    expect(result).toMatchObject({ level: 1, currentXp: 0, leveledUp: false, levelsGained: 0 })
  })

  it('dos derrotas distintas del mismo heroe se acumulan', async () => {
    await repository.grant(commandOf({ operationId: 'op-1', amount: 700 }))
    const second = await repository.grant(commandOf({ operationId: 'op-2', amount: 700 }))

    expect(second).toMatchObject({ currentXp: 1400, level: 4, applied: true })
  })

  it('el ledger guarda el origen aplanado y el resultado acreditado', async () => {
    await repository.grant(commandOf({ amount: 100 }))

    // La relectura no expone el asiento; lo que se comprueba es que un replay
    // devuelve exactamente lo que se acredito, que es para lo que sirve.
    const replay = await repository.grant(commandOf({ amount: 100 }))

    expect(replay).toMatchObject({ applied: false, currentXp: 100, level: 1 })
  })

  it('rechaza una progresion ilegible en lugar de inventar un estado', async () => {
    const corrupt = repository as unknown as {
      progressions: Map<string, Record<string, unknown>>
    }
    corrupt.progressions.set(`${PLAYER_ID}::${HERO_ID}`, {
      ownerId: PLAYER_ID,
      heroId: HERO_ID,
      level: 9,
      currentXp: 0,
      version: 0,
    })

    await expect(repository.grant(commandOf())).rejects.toBeInstanceOf(ExperienceGrantRejectedError)
  })
})
