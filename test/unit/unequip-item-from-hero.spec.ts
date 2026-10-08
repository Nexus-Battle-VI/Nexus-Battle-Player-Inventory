import { InMemoryHeroProgressionRepository } from '../../src/adapters/outbound/persistence/InMemoryHeroProgressionRepository'
import { EquipItemOnHero } from '../../src/application/use-cases/EquipItemOnHero'
import { UnequipItemFromHero } from '../../src/application/use-cases/UnequipItemFromHero'
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
import { HeroNotOwnedError } from '../../src/application/errors/ApplicationError'
import { EquipmentSlotEmptyError } from '../../src/domain/entities/HeroLoadout'
import { battleStateKit, type BattleStateKit } from '../fixtures/battle-state'

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

  findOwnersOfProduct(): Promise<readonly string[]> {
    return Promise.resolve([])
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
  readonly unequip: UnequipItemFromHero
  readonly get: GetHeroEquipment
  readonly loadouts: InMemoryHeroLoadoutRepository
  readonly battles: BattleStateKit
}

const buildKit = (params: {
  owned: readonly string[]
  catalog: readonly CatalogProductView[]
}): Kit => {
  const inventories = new FakeInventoryQuery(params.owned)
  const catalog = new InMemoryCatalogReadClient(params.catalog, false)
  const loadouts = new InMemoryHeroLoadoutRepository()
  const battles = battleStateKit(clock)
  const progressions = new InMemoryHeroProgressionRepository()

  return {
    equip: new EquipItemOnHero(inventories, catalog, loadouts, clock, battles.state, progressions),
    unequip: new UnequipItemFromHero(
      inventories,
      catalog,
      loadouts,
      clock,
      battles.state,
      progressions,
    ),
    get: new GetHeroEquipment(inventories, catalog, loadouts, battles.state, progressions),
    loadouts,
    battles,
  }
}

describe('UnequipItemFromHero (HU-28.4)', () => {
  it('desequipa un arma: la ranura queda vacia y las estadisticas vuelven a la base', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'espada-de-fuego'],
      catalog: [hero('guerrero-tanque'), equippable('espada-de-fuego', 'ARMA')],
    })
    await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      slot: 'WEAPON_1',
      productReference: 'espada-de-fuego',
    })

    const state = await kit.unequip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      slot: 'WEAPON_1',
    })

    expect(state.equipment.weapons).toEqual([])
    expect(state.effectiveStats.attack).toBe(state.baseStats.attack)
  })

  it('desequipa armadura: la ranura exacta queda null', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'casco-de-acero'],
      catalog: [
        hero('guerrero-tanque'),
        equippable('casco-de-acero', 'ARMADURA', { slot: 'HEAD' }),
      ],
    })
    await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      slot: 'HELMET',
      productReference: 'casco-de-acero',
    })

    const state = await kit.unequip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      slot: 'HELMET',
    })

    expect(state.equipment.armor.HELMET).toBeNull()
  })

  it('desequipa un item', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'pocion-de-vida'],
      catalog: [hero('guerrero-tanque'), equippable('pocion-de-vida', 'ITEM')],
    })
    await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      slot: 'ITEM_1',
      productReference: 'pocion-de-vida',
    })

    const state = await kit.unequip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      slot: 'ITEM_1',
    })

    expect(state.equipment.items).toEqual([])
  })

  it('el efecto de la pieza removida desaparece; otros efectos permanecen', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'espada-de-fuego', 'casco-de-acero'],
      catalog: [
        hero('guerrero-tanque'),
        equippable('espada-de-fuego', 'ARMA'),
        equippable('casco-de-acero', 'ARMADURA', { slot: 'HEAD' }),
      ],
    })
    await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      slot: 'WEAPON_1',
      productReference: 'espada-de-fuego',
    })
    await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      slot: 'HELMET',
      productReference: 'casco-de-acero',
    })

    const state = await kit.unequip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      slot: 'WEAPON_1',
    })

    const sources = state.activeEffects.map((effect) => effect.sourceSlot)
    expect(sources).not.toContain('WEAPON_1')
    expect(sources).toContain('HELMET')
  })

  it('la capacidad decrementa tras desequipar', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'casco-de-acero'],
      catalog: [
        hero('guerrero-tanque'),
        equippable('casco-de-acero', 'ARMADURA', { slot: 'HEAD' }),
      ],
    })
    await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      slot: 'HELMET',
      productReference: 'casco-de-acero',
    })

    const before = await kit.loadouts.findByHero(
      { value: OWNER } as PlayerId,
      'pid-guerrero-tanque',
    )
    expect(before?.filledCount('ARMOR')).toBe(1)

    await kit.unequip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      slot: 'HELMET',
    })

    const after = await kit.loadouts.findByHero({ value: OWNER } as PlayerId, 'pid-guerrero-tanque')
    expect(after?.filledCount('ARMOR')).toBe(0)
  })

  it('el objeto sigue siendo del jugador: solo se borra la asociacion heroe/ranura', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'espada-de-fuego'],
      catalog: [hero('guerrero-tanque'), equippable('espada-de-fuego', 'ARMA')],
    })
    await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      slot: 'WEAPON_1',
      productReference: 'espada-de-fuego',
    })

    await kit.unequip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      slot: 'WEAPON_1',
    })

    // El mismo producto se puede volver a equipar: la prueba definitiva de que
    // "seguia siendo del jugador" es que el flujo normal de Equip lo admite de
    // nuevo sin volver a "otorgarlo".
    const state = await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      slot: 'WEAPON_2',
      productReference: 'espada-de-fuego',
    })
    expect(state.equipment.weapons.map((w) => w.itemId)).toEqual(['espada-de-fuego'])
  })

  it('desequipar una ranura vacia lanza EquipmentSlotEmptyError (409) y no escribe nada', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque'],
      catalog: [hero('guerrero-tanque')],
    })

    await expect(
      kit.unequip.execute({ ownerId: OWNER, heroReference: 'guerrero-tanque', slot: 'WEAPON_1' }),
    ).rejects.toBeInstanceOf(EquipmentSlotEmptyError)
  })

  it('un heroe ajeno responde 404', async () => {
    const kit = buildKit({ owned: [], catalog: [hero('guerrero-tanque')] })

    await expect(
      kit.unequip.execute({ ownerId: OWNER, heroReference: 'guerrero-tanque', slot: 'WEAPON_1' }),
    ).rejects.toBeInstanceOf(HeroNotOwnedError)
  })

  it('una ranura invalida lanza error de dominio', async () => {
    const kit = buildKit({ owned: ['guerrero-tanque'], catalog: [hero('guerrero-tanque')] })

    await expect(
      kit.unequip.execute({ ownerId: OWNER, heroReference: 'guerrero-tanque', slot: 'ANILLO_1' }),
    ).rejects.toThrow()
  })

  it('HU-29: bloquea el desequipado durante batalla activa y no modifica el loadout', async () => {
    const kit = buildKit({
      owned: ['guerrero-tanque', 'espada-de-fuego'],
      catalog: [hero('guerrero-tanque'), equippable('espada-de-fuego', 'ARMA')],
    })
    await kit.equip.execute({
      ownerId: OWNER,
      heroReference: 'guerrero-tanque',
      slot: 'WEAPON_1',
      productReference: 'espada-de-fuego',
    })
    await kit.battles.startBattle(OWNER, 'pid-guerrero-tanque')

    await expect(
      kit.unequip.execute({ ownerId: OWNER, heroReference: 'guerrero-tanque', slot: 'WEAPON_1' }),
    ).rejects.toMatchObject({ name: 'EquipmentLockedDuringBattleError', reason: 'battle_lock' })

    const state = await kit.get.execute(OWNER, 'guerrero-tanque')
    expect(state.equipment.weapons.map((w) => w.itemId)).toEqual(['espada-de-fuego'])
  })

  it('regresion: Equip sigue funcionando tras el cambio', async () => {
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
  })
})
