import { InMemoryBattleHeroCommitmentRepository } from '../../src/adapters/outbound/persistence/InMemoryBattleHeroCommitmentRepository'
import {
  BattleCommitmentConflictError,
  BattleHeroCommittedError,
} from '../../src/application/ports/BattleHeroCommitmentPort'

/**
 * Invariantes del doble en memoria (HU-29, Task HU-29.2), ejercitadas DIRECTAMENTE.
 *
 * POR QUE DIRECTAMENTE Y NO A TRAVES DEL CASO DE USO: el caso de uso consulta
 * `findByOperation` antes de escribir y corta ahi la mayoria de los conflictos,
 * asi que sus pruebas nunca llegan al `replay` del repositorio. Ese camino si
 * ocurre en produccion, cuando dos peticiones con la misma clave coinciden, y es
 * justo el que no puede quedar sin probar: es el que decide entre «idempotente» y
 * «conflicto».
 */
const OWNER = 'sujeto-jugador'
const HERO = 'pid-guerrero-tanque'
const OTHER_HERO = 'pid-guerrero-mago'
const NOW = new Date('2026-09-24T12:00:00.000Z')

const OP_A = '11111111-1111-4111-8111-111111111111'
const OP_B = '22222222-2222-4222-8222-222222222222'

const input = (operationId: string, overrides: Record<string, unknown> = {}) => ({
  operationId,
  playerId: OWNER,
  heroId: HERO,
  reference: 'room_1',
  expiresAt: new Date(NOW.getTime() + 3_600_000),
  ...overrides,
})

describe('InMemoryBattleHeroCommitmentRepository (HU-29)', () => {
  let repository: InMemoryBattleHeroCommitmentRepository

  beforeEach(() => {
    repository = new InMemoryBattleHeroCommitmentRepository()
  })

  it('compromete y responde que hay batalla activa', async () => {
    await repository.commit(input(OP_A), NOW)

    await expect(repository.hasActiveForHero(OWNER, HERO, NOW)).resolves.toBe(true)
    await expect(repository.hasActiveForHero(OWNER, OTHER_HERO, NOW)).resolves.toBe(false)
    await expect(repository.hasActiveForHero('otro-jugador', HERO, NOW)).resolves.toBe(false)
  })

  it('la misma clave con el mismo cuerpo devuelve el mismo compromiso', async () => {
    const first = await repository.commit(input(OP_A), NOW)
    const second = await repository.commit(input(OP_A), NOW)

    expect(second).toEqual(first)
  })

  it('la misma clave con otro cuerpo es un conflicto', async () => {
    await repository.commit(input(OP_A), NOW)

    await expect(
      repository.commit(input(OP_A, { reference: 'room_otra' }), NOW),
    ).rejects.toBeInstanceOf(BattleCommitmentConflictError)
  })

  it('una clave ya liberada es un conflicto', async () => {
    await repository.commit(input(OP_A), NOW)
    await repository.release(OP_A)

    await expect(repository.commit(input(OP_A), NOW)).rejects.toBeInstanceOf(
      BattleCommitmentConflictError,
    )
  })

  it('una clave vencida es un conflicto', async () => {
    await repository.commit(input(OP_A), NOW)

    const later = new Date(NOW.getTime() + 7_200_000)

    await expect(repository.commit(input(OP_A), later)).rejects.toBeInstanceOf(
      BattleCommitmentConflictError,
    )
  })

  it('un heroe no puede tener dos compromisos activos', async () => {
    await repository.commit(input(OP_A), NOW)

    await expect(repository.commit(input(OP_B), NOW)).rejects.toBeInstanceOf(
      BattleHeroCommittedError,
    )
  })

  it('RECHAZA, no lanza de forma sincrona: el puerto promete una promesa', async () => {
    await repository.commit(input(OP_A), NOW)

    // Si `commit` lanzara al construir la llamada, esta linea reventaria antes de
    // llegar a `expect`: quien encadene `.catch()` en lugar de `await` se quedaria
    // sin capturar el fallo, y el doble no se comportaria como el adaptador real.
    const pending = repository.commit(input(OP_B), NOW)

    expect(pending).toBeInstanceOf(Promise)
    await expect(pending).rejects.toBeInstanceOf(BattleHeroCommittedError)
  })

  it('un compromiso vencido se libera de forma perezosa al comprometer otro', async () => {
    await repository.commit(input(OP_A, { expiresAt: new Date(NOW.getTime() + 1_000) }), NOW)

    const later = new Date(NOW.getTime() + 60_000)

    await expect(
      repository.commit(input(OP_B, { expiresAt: new Date(later.getTime() + 3_600_000) }), later),
    ).resolves.toMatchObject({ status: 'ACTIVE' })

    const stale = await repository.findByOperation(OP_A)

    expect(stale?.status).toBe('RELEASED')
  })

  it('un compromiso vencido no cuenta como batalla activa', async () => {
    await repository.commit(input(OP_A, { expiresAt: new Date(NOW.getTime() + 1_000) }), NOW)

    await expect(repository.hasActiveForHero(OWNER, HERO, NOW)).resolves.toBe(true)
    await expect(
      repository.hasActiveForHero(OWNER, HERO, new Date(NOW.getTime() + 60_000)),
    ).resolves.toBe(false)
  })

  it('liberar suelta al heroe y repetirlo no es un error', async () => {
    await repository.commit(input(OP_A), NOW)
    await repository.release(OP_A)

    await expect(repository.hasActiveForHero(OWNER, HERO, NOW)).resolves.toBe(false)
    await expect(repository.release(OP_A)).resolves.toBeUndefined()
    await expect(repository.release('clave-que-no-existe')).resolves.toBeUndefined()

    // Y el heroe queda libre para otra batalla.
    await expect(repository.commit(input(OP_B), NOW)).resolves.toMatchObject({
      status: 'ACTIVE',
    })
  })
})
