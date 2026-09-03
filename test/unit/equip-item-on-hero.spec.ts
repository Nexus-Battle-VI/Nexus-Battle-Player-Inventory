import { EquipItemOnHero } from '../../src/application/use-cases/EquipItemOnHero'
import { GetHeroEquipment } from '../../src/application/use-cases/GetHeroEquipment'
import { InMemoryHeroLoadoutRepository } from '../../src/adapters/outbound/persistence/InMemoryHeroLoadoutRepository'
import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import type { CatalogProductView } from '../../src/application/ports/CatalogReadPort'
import type {
  InventoryQueryPort,
  OwnedInventoryItem,
  OwnedInventoryItemsSlice,
} from '../../src/application/ports/InventoryQueryPort'
import type { PlayerId } from '../../src/domain/value-objects/identifiers'
import type { ClockPort } from '../../src/application/ports/ClockPort'
import {
  EquipmentProductNotOwnedError,
  EquipmentSlotMismatchError,
  HeroNotOwnedError,
  InvalidEquipmentTypeError,
} from '../../src/application/errors/ApplicationError'
import { CatalogUnavailableError } from '../../src/application/ports/CatalogReadPort'

const OWNER = 'sujeto-jugador'
const clock: ClockPort = { now: () => new Date('2026-09-03T12:00:00.000Z') }

class FakeInventoryQuery implements InventoryQueryPort {
  constructor(private readonly owned: readonly string[]) {}

  listOwnedItems(): Promise<OwnedInventoryItemsSlice> {
    return Promise.resolve({ items: [], totalItems: 0 })
  }

  findAllOwnedItems(): Promise<readonly OwnedInventoryItem[]> {
    return Promise.resolve(this.owned.map((itemId) => ({ itemId, quantity: 1 })))
  }
}

const hero = (sku: string): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name: 'Guerrero Tanque',
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
      heroSubtype: 'GUERRERO_TANQUE',
      basePower: 5,
      baseHealth: 40,
      baseDefense: 8,
      baseAttack: { mode: 'FIXED', amount: 10 },
      baseDamage: { mode: 'FIXED', amount: 4 },
      abilities: ['a', 'b', 'c'],
    },
  },
})

const equippable = (
  sku: string,
  type: 'ARMA' | 'ARMADURA' | 'ITEM',
  values: Record<string, unknown> = {},
): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name: sku,
  imageUrl: `https://assets.example.test/${sku}.png`,
  description: sku,
  type,
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 10,
  premium: false,
  realMoneyPrice: null,
  attributes: {
    schemaVersion: '1',
    values: {
      kind: type,
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
      ...values,
    },
  },
})

interface Kit {
  readonly equip: EquipItemOnHero
  readonly get: GetHeroEquipment
  readonly loadouts: InMemoryHeroLoadoutRepository
}

const buildKit = (params: {
  owned: readonly string[]
  catalog: readonly CatalogProductView[]
  unavailable?: boolean
}): Kit => {
  const inventories = new FakeInventoryQuery(params.owned)
  const catalog = new InMemoryCatalogReadClient(params.catalog, params.unavailable ?? false)
  const loadouts = new InMemoryHeroLoadoutRepository()

  return {
    equip: new EquipItemOnHero(inventories, catalog, loadouts, clock),
    get: new GetHeroEquipment(inventories, catalog, loadouts),
    loadouts,
  }
}

describe('EquipItemOnHero (RF-28)', () => {
  it('CA-01: equipa un arma propia en un heroe propio, persiste y devuelve el nuevo estado recalculado', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'espada-de-fuego'],
      catalog: [hero('guerrero-tanque'), equippable('espada-de-fuego', 'ARMA')],
    })

    const state = await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      slot: 'WEAPON_1',
      productReference: 'espada-de-fuego',
    })

    expect(state.equipment.weapons.map((w) => w.itemId)).toEqual(['espada-de-fuego'])
    expect(state.baseStats.attack).toBe(10)
    expect(state.effectiveStats.attack).toBe(11)

    const persisted = await kit.get.execute(OWNER, 'guerrero-tanque')
    expect(persisted.equipment.weapons.map((w) => w.itemId)).toEqual(['espada-de-fuego'])
    expect(persisted.effectiveStats.attack).toBe(11)
  })

  it('CA-06: un heroe ajeno responde 404 y NO escribe nada', async () => {
    const kit = buildKit({
      owned: ['espada-de-fuego'],
      catalog: [hero('guerrero-tanque'), equippable('espada-de-fuego', 'ARMA')],
    })

    await expect(
      kit.equip.execute({
        ownerId: OWNER,
        heroReference: 'guerrero-tanque',
        slot: 'WEAPON_1',
        productReference: 'espada-de-fuego',
      }),
    ).rejects.toBeInstanceOf(HeroNotOwnedError)

    await expect(
      kit.loadouts.findByHero({ value: OWNER } as PlayerId, 'pid-guerrero-tanque'),
    ).resolves.toBeNull()
  })

  it('CA-05: un producto que no esta en el inventario responde 404 y NO escribe nada', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque'],
      catalog: [hero('guerrero-tanque'), equippable('espada-de-fuego', 'ARMA')],
    })

    await expect(
      kit.equip.execute({
        ownerId: OWNER,
        heroReference: 'guerrero-tanque',
        slot: 'WEAPON_1',
        productReference: 'espada-de-fuego',
      }),
    ).rejects.toBeInstanceOf(EquipmentProductNotOwnedError)
  })

  it('CA-07: un producto de tipo no equipable se rechaza (422)', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'bola-de-fuego'],
      catalog: [
        hero('guerrero-tanque'),
        { ...equippable('bola-de-fuego', 'ARMA'), type: 'HABILIDAD' },
      ],
    })

    await expect(
      kit.equip.execute({
        ownerId: OWNER,
        heroReference: 'guerrero-tanque',
        slot: 'WEAPON_1',
        productReference: 'bola-de-fuego',
      }),
    ).rejects.toBeInstanceOf(InvalidEquipmentTypeError)
  })

  it('CA-07: un arma en una ranura de casco se rechaza por familia', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'espada-de-fuego'],
      catalog: [hero('guerrero-tanque'), equippable('espada-de-fuego', 'ARMA')],
    })

    await expect(
      kit.equip.execute({
        ownerId: OWNER,
        heroReference: 'guerrero-tanque',
        slot: 'HELMET',
        productReference: 'espada-de-fuego',
      }),
    ).rejects.toThrow(/familia/)
  })

  it('CA-07: una pieza de armadura cuyo slot canonico no casa con la ranura se rechaza (422)', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'peto-de-acero'],
      catalog: [
        hero('guerrero-tanque'),
        equippable('peto-de-acero', 'ARMADURA', { slot: 'CHEST' }),
      ],
    })

    await expect(
      kit.equip.execute({
        ownerId: OWNER,
        heroReference: 'guerrero-tanque',
        slot: 'HELMET',
        productReference: 'peto-de-acero',
      }),
    ).rejects.toBeInstanceOf(EquipmentSlotMismatchError)
  })

  it('CA-03: la armadura correcta entra en su ranura exacta', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'casco-de-acero'],
      catalog: [
        hero('guerrero-tanque'),
        equippable('casco-de-acero', 'ARMADURA', { slot: 'HEAD' }),
      ],
    })

    const state = await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      slot: 'HELMET',
      productReference: 'casco-de-acero',
    })

    expect(state.equipment.armor.HELMET?.itemId).toBe('casco-de-acero')
  })

  it('una ranura ocupada se rechaza con 409 y conserva la pieza anterior', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'espada-de-fuego', 'hacha-de-hielo'],
      catalog: [
        hero('guerrero-tanque'),
        equippable('espada-de-fuego', 'ARMA'),
        equippable('hacha-de-hielo', 'ARMA'),
      ],
    })

    await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      slot: 'WEAPON_1',
      productReference: 'espada-de-fuego',
    })

    await expect(
      kit.equip.execute({
        ownerId: OWNER,
        heroReference: 'guerrero-tanque',
        slot: 'WEAPON_1',
        productReference: 'hacha-de-hielo',
      }),
    ).rejects.toThrow(/ocupada/)

    const state = await kit.get.execute(OWNER, 'guerrero-tanque')
    expect(state.equipment.weapons.map((w) => w.itemId)).toEqual(['espada-de-fuego'])
  })

  it('si Catalog no responde, falla con 503 ANTES de escribir', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'espada-de-fuego'],
      catalog: [],
      unavailable: true,
    })

    await expect(
      kit.equip.execute({
        ownerId: OWNER,
        heroReference: 'guerrero-tanque',
        slot: 'WEAPON_1',
        productReference: 'espada-de-fuego',
      }),
    ).rejects.toBeInstanceOf(CatalogUnavailableError)
  })
})

describe('GetHeroEquipment (RF-28, CA-09)', () => {
  it('un heroe propio sin piezas devuelve las diez ranuras vacias y base == efectiva', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque'],
      catalog: [hero('guerrero-tanque')],
    })

    const state = await kit.get.execute(OWNER, 'guerrero-tanque')
    expect(state.equipment.weapons).toEqual([])
    expect(state.equipment.items).toEqual([])
    expect(Object.values(state.equipment.armor).every((v) => v === null)).toBe(true)
    expect(state.effectiveStats).toEqual(state.baseStats)
    expect(state.deltas).toEqual([])
    expect(state.hero.subtype).toBe('GUERRERO_TANQUE')
  })

  it('un heroe ajeno responde 404', async () => {
    const kit = buildKit({ owned: [], catalog: [hero('guerrero-tanque')] })
    await expect(kit.get.execute(OWNER, 'guerrero-tanque')).rejects.toBeInstanceOf(
      HeroNotOwnedError,
    )
  })

  it('si Catalog no responde, propaga 503', async () => {
    const kit = buildKit({ owned: ['guerrero-tanque'], catalog: [], unavailable: true })
    await expect(kit.get.execute(OWNER, 'guerrero-tanque')).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    )
  })
})
