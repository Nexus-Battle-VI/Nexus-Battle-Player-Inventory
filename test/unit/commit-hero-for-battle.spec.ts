import type { CatalogProductView } from '../../src/application/ports/CatalogReadPort'
import type { ClockPort } from '../../src/application/ports/ClockPort'
import type {
  OwnedInventoryItem,
  OwnedInventoryItemsSlice,
} from '../../src/application/ports/InventoryQueryPort'
import type { InventoryQueryPort } from '../../src/application/ports/InventoryQueryPort'
import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import { InMemoryBattleHeroCommitmentRepository } from '../../src/adapters/outbound/persistence/InMemoryBattleHeroCommitmentRepository'
import {
  BattleCommitmentConflictError,
  BattleHeroCommittedError,
} from '../../src/application/ports/BattleHeroCommitmentPort'
import {
  BattleCommitmentRejectionError,
  CommitHeroForBattle,
} from '../../src/application/use-cases/CommitHeroForBattle'

/**
 * Compromiso de batalla: las invariantes del caso de uso (HU-29, Task HU-29.2).
 *
 * Aqui vive lo que la frontera HTTP no puede afirmar con precision: que un
 * reintento con la MISMA clave devuelve el mismo compromiso, que con OTRO
 * contenido es un conflicto, y que un compromiso ya liberado o vencido tampoco
 * se puede reutilizar.
 */
const OWNER = 'sujeto-jugador'
const HERO = 'pid-guerrero-tanque'
const NOW = new Date('2026-09-24T12:00:00.000Z')
const clock: ClockPort = { now: () => NOW }

class FakeInventoryQuery implements InventoryQueryPort {
  constructor(private readonly owned: readonly string[]) {}

  listOwnedItems(): Promise<OwnedInventoryItemsSlice> {
    return Promise.resolve({ items: [], totalItems: 0 })
  }

  findAllOwnedItems(): Promise<readonly OwnedInventoryItem[]> {
    return Promise.resolve(this.owned.map((itemId) => ({ itemId, quantity: 1 })))
  }

  findOwnersOfProduct(): Promise<readonly string[]> {
    return Promise.resolve([])
  }
}

const heroProduct: CatalogProductView = {
  productId: HERO,
  sku: 'guerrero-tanque',
  name: 'Guerrero Tanque',
  imageUrl: '',
  description: '',
  type: 'HEROE',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 0,
  premium: false,
  realMoneyPrice: null,
  attributes: {
    schemaVersion: '1',
    values: {
      kind: 'HEROE',
      heroSubtype: 'GUERRERO_TANQUE',
      basePower: 5,
      baseHealth: 40,
      baseDefense: 8,
      baseAttack: { mode: 'FIXED', amount: 10 },
      baseDamage: { mode: 'FIXED', amount: 4 },
      abilities: [],
    },
  },
}

const operationIds = {
  first: '11111111-1111-4111-8111-111111111111',
  second: '22222222-2222-4222-8222-222222222222',
  third: '33333333-3333-4333-8333-333333333333',
}

const buildKit = (owned: readonly string[] = ['guerrero-tanque']) => {
  const commitments = new InMemoryBattleHeroCommitmentRepository()

  return {
    commitments,
    useCase: new CommitHeroForBattle(
      new FakeInventoryQuery(owned),
      new InMemoryCatalogReadClient([heroProduct]),
      commitments,
      clock,
    ),
  }
}

const input = (operationId: string, overrides: Record<string, unknown> = {}) => ({
  operationId,
  playerId: OWNER,
  heroId: HERO,
  reference: 'room_1',
  expiresAt: new Date(NOW.getTime() + 3_600_000),
  ...overrides,
})

describe('CommitHeroForBattle (HU-29)', () => {
  it('compromete al heroe propio y el guard lo ve en batalla', async () => {
    const kit = buildKit()

    const commitment = await kit.useCase.execute(input(operationIds.first))

    expect(commitment).toMatchObject({ status: 'ACTIVE', heroId: HERO, reference: 'room_1' })
    await expect(kit.commitments.hasActiveForHero(OWNER, HERO, NOW)).resolves.toBe(true)
  })

  it('repetir la misma clave con el mismo contenido devuelve el mismo compromiso', async () => {
    const kit = buildKit()
    const body = input(operationIds.first)

    const first = await kit.useCase.execute(body)
    const second = await kit.useCase.execute(body)

    expect(second.commitmentId).toBe(first.commitmentId)
  })

  it('la misma clave con otro contenido es un conflicto', async () => {
    const kit = buildKit()

    await kit.useCase.execute(input(operationIds.first))

    await expect(
      kit.useCase.execute(input(operationIds.first, { reference: 'room_otra' })),
    ).rejects.toBeInstanceOf(BattleCommitmentConflictError)
  })

  it('una clave ya liberada no se puede reutilizar', async () => {
    const kit = buildKit()

    await kit.useCase.execute(input(operationIds.first))
    await kit.useCase.release(operationIds.first)

    await expect(kit.useCase.execute(input(operationIds.first))).rejects.toBeInstanceOf(
      BattleCommitmentConflictError,
    )
  })

  it('una clave vencida no se puede reutilizar', async () => {
    const kit = buildKit()

    await kit.useCase.execute(
      input(operationIds.first, { expiresAt: new Date(NOW.getTime() + 1_000) }),
    )

    const later = new CommitHeroForBattle(
      new FakeInventoryQuery(['guerrero-tanque']),
      new InMemoryCatalogReadClient([heroProduct]),
      kit.commitments,
      { now: () => new Date(NOW.getTime() + 60_000) },
    )

    await expect(later.execute(input(operationIds.first))).rejects.toBeInstanceOf(
      BattleCommitmentConflictError,
    )
  })

  it('un heroe no puede estar en dos batallas activas', async () => {
    const kit = buildKit()

    await kit.useCase.execute(input(operationIds.first))

    await expect(kit.useCase.execute(input(operationIds.second))).rejects.toBeInstanceOf(
      BattleHeroCommittedError,
    )
  })

  it('un compromiso vencido deja de bloquear al comprometer uno nuevo', async () => {
    const kit = buildKit()

    await kit.useCase.execute(
      input(operationIds.first, { expiresAt: new Date(NOW.getTime() + 1_000) }),
    )

    const later = new CommitHeroForBattle(
      new FakeInventoryQuery(['guerrero-tanque']),
      new InMemoryCatalogReadClient([heroProduct]),
      kit.commitments,
      { now: () => new Date(NOW.getTime() + 60_000) },
    )

    await expect(
      later.execute(input(operationIds.second, { expiresAt: new Date(NOW.getTime() + 7_200_000) })),
    ).resolves.toMatchObject({ status: 'ACTIVE' })
  })

  it('rechaza una caducidad que no es futura', async () => {
    const kit = buildKit()

    await expect(
      kit.useCase.execute(
        input(operationIds.first, { expiresAt: new Date(NOW.getTime() - 1_000) }),
      ),
    ).rejects.toMatchObject({ name: 'BattleCommitmentRejectionError', code: 'INVALID_EXPIRY' })
  })

  it('rechaza un heroe que no es del jugador', async () => {
    const kit = buildKit([])

    await expect(kit.useCase.execute(input(operationIds.first))).rejects.toMatchObject({
      name: 'BattleCommitmentRejectionError',
      code: 'HERO_NOT_OWNED',
    })
  })

  it('rechaza una referencia de heroe que no corresponde al producto resuelto', async () => {
    const kit = buildKit()

    await expect(
      kit.useCase.execute(input(operationIds.first, { heroId: 'pid-otro-heroe' })),
    ).rejects.toMatchObject({ code: 'HERO_NOT_OWNED' })
  })

  it('liberar no es un error aunque no exista', async () => {
    const kit = buildKit()

    await expect(kit.useCase.release(operationIds.third)).resolves.toBeUndefined()
  })

  it('el error de rechazo lleva su codigo y su mensaje', () => {
    const rejection = new BattleCommitmentRejectionError('INVALID_EXPIRY')

    expect(rejection.message).toMatch(/caducidad futura/)
    expect(rejection.name).toBe('BattleCommitmentRejectionError')
  })
})
