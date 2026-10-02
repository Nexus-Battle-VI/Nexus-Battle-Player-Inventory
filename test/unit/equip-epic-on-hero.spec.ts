import { InMemoryHeroEpicSelectionRepository } from '../../src/adapters/outbound/persistence/InMemoryHeroEpicSelectionRepository'
import { EquipEpicOnHero } from '../../src/application/use-cases/EquipEpicOnHero'
import { GetHeroEpic } from '../../src/application/use-cases/GetHeroEpic'
import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import type { CatalogProductView } from '../../src/application/ports/CatalogReadPort'
import { CatalogUnavailableError } from '../../src/application/ports/CatalogReadPort'
import type {
  InventoryQueryPort,
  OwnedInventoryItem,
  OwnedInventoryItemsSlice,
} from '../../src/application/ports/InventoryQueryPort'
import type { PlayerId } from '../../src/domain/value-objects/identifiers'
import type { ClockPort } from '../../src/application/ports/ClockPort'
import {
  EpicProductInvalidTypeError,
  EpicProductNotOwnedError,
  HeroNotOwnedError,
} from '../../src/application/errors/ApplicationError'
import { DomainError } from '../../src/domain/errors/DomainError'
import { battleStateKit, type BattleStateKit } from '../fixtures/battle-state'

const OWNER = 'sujeto-jugador'
const OTHER_OWNER = 'sujeto-otro'
const clock: ClockPort = { now: () => new Date('2026-10-03T12:00:00.000Z') }

class FakeInventoryQuery implements InventoryQueryPort {
  constructor(private readonly byOwner: Readonly<Record<string, readonly string[]>>) {}

  listOwnedItems(): Promise<OwnedInventoryItemsSlice> {
    return Promise.resolve({ items: [], totalItems: 0 })
  }

  findAllOwnedItems(ownerId: PlayerId): Promise<readonly OwnedInventoryItem[]> {
    const owned = this.byOwner[ownerId.value] ?? []
    return Promise.resolve(owned.map((itemId) => ({ itemId, quantity: 1 })))
  }

  findOwnersOfProduct(): Promise<readonly string[]> {
    return Promise.resolve([])
  }
}

const hero = (sku: string, subtype: string): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name: 'Heroe',
  imageUrl: `https://assets.example.test/${sku}.png`,
  description: 'Heroe',
  type: 'HEROE',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 0,
  premium: false,
  realMoneyPrice: null,
  attributes: {
    schemaVersion: '1',
    values: {
      kind: 'HEROE',
      heroSubtype: subtype,
      basePower: 5,
      baseHealth: 40,
      baseDefense: 8,
      baseAttack: { mode: 'FIXED', amount: 10 },
      baseDamage: { mode: 'FIXED', amount: 4 },
      abilities: [],
    },
  },
})

const epic = (
  sku: string,
  compatibleHeroSubtype: string,
  overrides: Record<string, unknown> = {},
): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name: sku,
  imageUrl: `https://assets.example.test/${sku}.png`,
  description: sku,
  type: 'EPICA',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 0,
  premium: false,
  realMoneyPrice: null,
  attributes: {
    schemaVersion: '1',
    values: {
      kind: 'EPICA',
      compatibleHeroSubtype,
      generalEffect: {
        kind: 'STAT_MODIFIER',
        target: 'SELF',
        statistic: 'DEFENSE',
        operation: 'INCREASE',
        magnitude: { mode: 'FIXED', amount: 4 },
        stackable: false,
      },
      specificEffect: {
        kind: 'STAT_MODIFIER',
        target: 'SELF',
        statistic: 'ATTACK',
        operation: 'INCREASE',
        magnitude: { mode: 'FIXED', amount: 2 },
        stackable: false,
      },
      ...overrides,
    },
  },
})

interface Kit {
  readonly equip: EquipEpicOnHero
  readonly get: GetHeroEpic
  readonly epicSelections: InMemoryHeroEpicSelectionRepository
  readonly battles: BattleStateKit
}

const buildKit = (params: {
  owned: readonly string[]
  catalog: readonly CatalogProductView[]
  unavailable?: boolean
}): Kit => {
  const inventories = new FakeInventoryQuery({
    [OWNER]: params.owned,
    [OTHER_OWNER]: [],
  })
  const catalog = new InMemoryCatalogReadClient(params.catalog, params.unavailable ?? false)
  const epicSelections = new InMemoryHeroEpicSelectionRepository()
  const battles = battleStateKit(clock)

  return {
    equip: new EquipEpicOnHero(inventories, catalog, epicSelections, clock, battles.state),
    get: new GetHeroEpic(inventories, catalog, epicSelections, battles.state),
    epicSelections,
    battles,
  }
}

describe('EquipEpicOnHero (HU-31, contrato hu-31-equipped-epic-v1)', () => {
  it('T-PI-01: heroe propio + epica propia -> se puede equipar, persiste y la lectura posterior conserva la seleccion', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'golpe-de-defensa'],
      catalog: [
        hero('guerrero-tanque', 'GUERRERO_TANQUE'),
        epic('golpe-de-defensa', 'GUERRERO_TANQUE'),
      ],
    })

    const state = await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      productReference: 'golpe-de-defensa',
    })

    expect(state.epic?.epicReference).toBe('golpe-de-defensa')
    expect(state.version).toBe(1)

    // T-PI-08: nueva consulta independiente conserva la misma seleccion.
    const read = await kit.get.execute(OWNER, 'guerrero-tanque')
    expect(read.epic?.epicReference).toBe('golpe-de-defensa')
    expect(read.version).toBe(1)
  })

  it('T-PI-02: una epica no poseida se rechaza (404) y no escribe nada', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque'],
      catalog: [
        hero('guerrero-tanque', 'GUERRERO_TANQUE'),
        epic('golpe-de-defensa', 'GUERRERO_TANQUE'),
      ],
    })

    await expect(
      kit.equip.execute({
        ownerId: OWNER,
        heroReference: 'guerrero-tanque',
        productReference: 'golpe-de-defensa',
      }),
    ).rejects.toBeInstanceOf(EpicProductNotOwnedError)

    const read = await kit.get.execute(OWNER, 'guerrero-tanque')
    expect(read.epic).toBeNull()
  })

  it('T-PI-03: un heroe no poseido se rechaza (404)', async () => {
    const kit = buildKit({
      owned: ['golpe-de-defensa'],
      catalog: [
        hero('guerrero-tanque', 'GUERRERO_TANQUE'),
        epic('golpe-de-defensa', 'GUERRERO_TANQUE'),
      ],
    })

    await expect(
      kit.equip.execute({
        ownerId: OWNER,
        heroReference: 'guerrero-tanque',
        productReference: 'golpe-de-defensa',
      }),
    ).rejects.toBeInstanceOf(HeroNotOwnedError)
  })

  it('T-PI-04: un producto que no es EPICA se rechaza (422) y no escribe nada', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'espada-de-fuego'],
      catalog: [
        hero('guerrero-tanque', 'GUERRERO_TANQUE'),
        {
          productId: 'pid-espada-de-fuego',
          sku: 'espada-de-fuego',
          name: 'Espada de fuego',
          imageUrl: '',
          description: '',
          type: 'ARMA',
          lifecycleStatus: 'ACTIVE',
          creditsPrice: 10,
          premium: false,
          realMoneyPrice: null,
          attributes: {
            schemaVersion: '1',
            values: {
              kind: 'ARMA',
              compatibilityScope: 'ALL_HEROES',
              effects: [
                {
                  kind: 'STAT_MODIFIER',
                  target: 'SELF',
                  statistic: 'ATTACK',
                  operation: 'INCREASE',
                  magnitude: { mode: 'FIXED', amount: 1 },
                },
              ],
            },
          },
        },
      ],
    })

    await expect(
      kit.equip.execute({
        ownerId: OWNER,
        heroReference: 'guerrero-tanque',
        productReference: 'espada-de-fuego',
      }),
    ).rejects.toBeInstanceOf(EpicProductInvalidTypeError)

    const read = await kit.get.execute(OWNER, 'guerrero-tanque')
    expect(read.epic).toBeNull()
  })

  it('T-PI-05: subtipo coincidente -> base + especifico aplicados', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'golpe-de-defensa'],
      catalog: [
        hero('guerrero-tanque', 'GUERRERO_TANQUE'),
        epic('golpe-de-defensa', 'GUERRERO_TANQUE'),
      ],
    })

    const state = await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      productReference: 'golpe-de-defensa',
    })

    expect(state.epic?.applied.baseApplied).not.toBeNull()
    expect(state.epic?.applied.additionalApplied).not.toBeNull()
  })

  it('T-PI-06: subtipo NO coincidente -> solo base, sin rechazar el equipamiento', async () => {
    const kit = buildKit({
      owned: ['medico', 'golpe-de-defensa'],
      catalog: [hero('medico', 'MEDICO'), epic('golpe-de-defensa', 'GUERRERO_TANQUE')],
    })

    const state = await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'medico',
      productReference: 'golpe-de-defensa',
    })

    expect(state.epic?.applied.baseApplied).not.toBeNull()
    expect(state.epic?.applied.additionalApplied).toBeNull()
  })

  it('T-PI-07: generalEffect ausente ("No aplica") se preserva: baseApplied null con match', async () => {
    const reanimador: CatalogProductView = {
      productId: 'pid-reanimador-3000',
      sku: 'reanimador-3000',
      name: 'Reanimador 3000',
      imageUrl: '',
      description: '',
      type: 'EPICA',
      lifecycleStatus: 'ACTIVE',
      creditsPrice: 0,
      premium: false,
      realMoneyPrice: null,
      attributes: {
        schemaVersion: '1',
        values: {
          kind: 'EPICA',
          compatibleHeroSubtype: 'MEDICO',
          // generalEffect ausente a proposito: "No aplica" (Tabla 20, Medico/Chaman).
          specificEffect: { kind: 'REVIVE', target: 'ALLY', stackable: false },
        },
      },
    }
    const kit = buildKit({
      owned: ['medico', 'reanimador-3000'],
      catalog: [hero('medico', 'MEDICO'), reanimador],
    })

    const state = await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'medico',
      productReference: 'reanimador-3000',
    })

    expect(state.epic?.baseEffect).toBeNull()
    expect(state.epic?.applied.baseApplied).toBeNull()
    expect(state.epic?.applied.additionalApplied).not.toBeNull()
  })

  it('T-PI-09: con compromiso de batalla activo, equipar se rechaza (409 battle_lock) y no cambia la seleccion', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'golpe-de-defensa', 'segundo-impulso'],
      catalog: [
        hero('guerrero-tanque', 'GUERRERO_TANQUE'),
        epic('golpe-de-defensa', 'GUERRERO_TANQUE'),
        epic('segundo-impulso', 'GUERRERO_TANQUE'),
      ],
    })

    await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      productReference: 'golpe-de-defensa',
    })

    await kit.battles.startBattle(OWNER, 'pid-guerrero-tanque')

    await expect(
      kit.equip.execute({
        ownerId: OWNER,
        heroReference: 'guerrero-tanque',
        productReference: 'segundo-impulso',
      }),
    ).rejects.toMatchObject({ name: 'EquipmentLockedDuringBattleError', reason: 'battle_lock' })

    const read = await kit.get.execute(OWNER, 'guerrero-tanque')
    expect(read.epic?.epicReference).toBe('golpe-de-defensa')

    await kit.battles.finishBattle(OWNER, 'pid-guerrero-tanque')

    const state = await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      productReference: 'segundo-impulso',
    })
    expect(state.epic?.epicReference).toBe('segundo-impulso')
  })

  it('T-PI-10: dos escrituras concurrentes sobre la misma seleccion dejan exactamente una ganadora', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'golpe-de-defensa', 'segundo-impulso'],
      catalog: [
        hero('guerrero-tanque', 'GUERRERO_TANQUE'),
        epic('golpe-de-defensa', 'GUERRERO_TANQUE'),
        epic('segundo-impulso', 'GUERRERO_TANQUE'),
      ],
    })

    const outcomes = await Promise.allSettled([
      kit.equip.execute({
        ownerId: OWNER,
        heroReference: 'guerrero-tanque',
        productReference: 'golpe-de-defensa',
      }),
      kit.equip.execute({
        ownerId: OWNER,
        heroReference: 'guerrero-tanque',
        productReference: 'segundo-impulso',
      }),
    ])

    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled')
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({
      status: 'rejected',
      reason: { name: 'HeroEpicSelectionConflictError' },
    })

    const read = await kit.get.execute(OWNER, 'guerrero-tanque')
    expect(read.version).toBe(1)
    expect(read.epic).not.toBeNull()
  })

  it('reemplazar la epica equipada sustituye directamente la seleccion anterior', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'golpe-de-defensa', 'segundo-impulso'],
      catalog: [
        hero('guerrero-tanque', 'GUERRERO_TANQUE'),
        epic('golpe-de-defensa', 'GUERRERO_TANQUE'),
        epic('segundo-impulso', 'GUERRERO_TANQUE'),
      ],
    })

    await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      productReference: 'golpe-de-defensa',
    })
    const state = await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      productReference: 'segundo-impulso',
    })

    expect(state.epic?.epicReference).toBe('segundo-impulso')
    expect(state.version).toBe(2)
  })

  it('una definicion de epica que no cumple el contrato canonico se rechaza (400) y no escribe nada', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'epica-rota'],
      catalog: [
        hero('guerrero-tanque', 'GUERRERO_TANQUE'),
        {
          productId: 'pid-epica-rota',
          sku: 'epica-rota',
          name: 'Epica rota',
          imageUrl: '',
          description: '',
          type: 'EPICA',
          lifecycleStatus: 'ACTIVE',
          creditsPrice: 0,
          premium: false,
          realMoneyPrice: null,
          attributes: { schemaVersion: '1', values: { kind: 'EPICA' } },
        },
      ],
    })

    await expect(
      kit.equip.execute({
        ownerId: OWNER,
        heroReference: 'guerrero-tanque',
        productReference: 'epica-rota',
      }),
    ).rejects.toBeInstanceOf(DomainError)

    const read = await kit.get.execute(OWNER, 'guerrero-tanque')
    expect(read.epic).toBeNull()
  })

  it('si Catalog no responde, falla con 503 ANTES de escribir', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'golpe-de-defensa'],
      catalog: [],
      unavailable: true,
    })

    await expect(
      kit.equip.execute({
        ownerId: OWNER,
        heroReference: 'guerrero-tanque',
        productReference: 'golpe-de-defensa',
      }),
    ).rejects.toBeInstanceOf(CatalogUnavailableError)
  })
})

describe('GetHeroEpic (HU-31)', () => {
  it('un heroe propio sin epica equipada devuelve epic null y version 0', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque'],
      catalog: [hero('guerrero-tanque', 'GUERRERO_TANQUE')],
    })

    const state = await kit.get.execute(OWNER, 'guerrero-tanque')
    expect(state.epic).toBeNull()
    expect(state.version).toBe(0)
    expect(state.locked).toBe(false)
  })

  it('un heroe ajeno responde 404', async () => {
    const kit = buildKit({ owned: [], catalog: [hero('guerrero-tanque', 'GUERRERO_TANQUE')] })
    await expect(kit.get.execute(OWNER, 'guerrero-tanque')).rejects.toBeInstanceOf(
      HeroNotOwnedError,
    )
  })
})
