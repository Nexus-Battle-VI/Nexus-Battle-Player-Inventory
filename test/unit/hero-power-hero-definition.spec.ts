import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import { InMemoryHeroLoadoutRepository } from '../../src/adapters/outbound/persistence/InMemoryHeroLoadoutRepository'
import { InMemoryHeroSelectionRepository } from '../../src/adapters/outbound/persistence/InMemoryHeroSelectionRepository'
import type { CatalogProductView } from '../../src/application/ports/CatalogReadPort'
import type { ClockPort } from '../../src/application/ports/ClockPort'
import type {
  InventoryQueryPort,
  OwnedInventoryItem,
  OwnedInventoryItemsSlice,
} from '../../src/application/ports/InventoryQueryPort'
import { EquipItemOnHero } from '../../src/application/use-cases/EquipItemOnHero'
import { GetEquippedHeroForCombat } from '../../src/application/use-cases/GetEquippedHeroForCombat'
import { GetHeroSelection } from '../../src/application/use-cases/GetHeroSelection'
import { SelectHero } from '../../src/application/use-cases/SelectHero'
import {
  createHeroPower,
  getMaxPower,
  getPower,
  regenPower,
  spendPower,
  type HeroPowerCost,
} from '../../src/domain/policies/HeroPowerPolicy'
import type { PlayerId } from '../../src/domain/value-objects/identifiers'

/**
 * HU-11 no inventa el Poder máximo: lo toma de la definición aprobada del héroe.
 * Estas pruebas recorren el camino real —Catalog → HU-28 (estadísticas efectivas)
 * → HU-15 (lo que recibe Combat)— y solo entonces crean el estado de Poder.
 *
 * Los `basePower` de los héroes son los de la Tabla 6 del documento oficial
 * (Guerrero Tanque 10, Mago Fuego 8), servidos aquí como datos de Catalog.
 */

const clock: ClockPort = { now: () => new Date('2026-09-20T12:00:00.000Z') }

const fixed = (amount: number): HeroPowerCost => ({ mode: 'FIXED', amount })

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

const hero = (
  sku: string,
  subtype: string,
  name: string,
  basePower: number,
): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name,
  imageUrl: `https://assets.example.test/${sku}.png`,
  description: name,
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
      basePower,
      baseHealth: 40,
      baseDefense: 8,
      baseAttack: { mode: 'FIXED', amount: 10 },
      baseDamage: { mode: 'DICE', count: 1, sides: 4 },
      abilities: [`hab-${sku}`],
    },
  },
})

/** Ítem con un modificador PERMANENTE de Poder sobre el propio héroe (HU-28). */
const powerItem = (sku: string, amount: number): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name: sku,
  imageUrl: '',
  description: sku,
  type: 'ITEM',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 10,
  premium: false,
  realMoneyPrice: null,
  attributes: {
    schemaVersion: '1',
    values: {
      kind: 'ITEM',
      compatibilityScope: 'ALL_HEROES',
      effects: [
        {
          kind: 'STAT_MODIFIER',
          target: 'SELF',
          statistic: 'POWER',
          operation: 'INCREASE',
          magnitude: { mode: 'FIXED', amount },
        },
      ],
    },
  },
})

const escenario = (
  catalogo: readonly CatalogProductView[],
  inventarios: Readonly<Record<string, readonly string[]>>,
): {
  readonly select: SelectHero
  readonly equip: EquipItemOnHero
  readonly forCombat: GetEquippedHeroForCombat
} => {
  const inventories = new FakeInventoryQuery(inventarios)
  const catalog = new InMemoryCatalogReadClient([...catalogo])
  const loadouts = new InMemoryHeroLoadoutRepository()
  const selections = new InMemoryHeroSelectionRepository()

  return {
    select: new SelectHero(inventories, catalog, loadouts, selections, clock),
    equip: new EquipItemOnHero(inventories, catalog, loadouts, clock),
    forCombat: new GetEquippedHeroForCombat(
      new GetHeroSelection(inventories, catalog, loadouts, selections),
      loadouts,
    ),
  }
}

const tanque = hero('guerrero-tanque', 'GUERRERO_TANQUE', 'Guerrero Tanque', 10)
const fuego = hero('mago-fuego', 'MAGO_FUEGO', 'Mago Fuego', 8)

describe('HU-11 — el máximo de Poder sale de la definición del héroe (HU-28 / HU-15)', () => {
  it('cada héroe del jugador arranca con el máximo que Catalog declara para él', async () => {
    const { select, forCombat } = escenario([tanque, fuego], {
      'jugador-1': ['guerrero-tanque', 'mago-fuego'],
    })

    await select.execute('jugador-1', 'guerrero-tanque')
    const paraTanque = await forCombat.execute('jugador-1')
    await select.execute('jugador-1', 'mago-fuego')
    const paraFuego = await forCombat.execute('jugador-1')

    expect(createHeroPower(paraTanque.heroId, paraTanque.effectiveStats.power)).toEqual({
      heroId: 'pid-guerrero-tanque',
      current: 10,
      max: 10,
    })
    expect(createHeroPower(paraFuego.heroId, paraFuego.effectiveStats.power)).toEqual({
      heroId: 'pid-mago-fuego',
      current: 8,
      max: 8,
    })
  })

  it('dos héroes reales del mismo jugador: gastar 4 en uno deja 6/10 y el otro sigue en 8/8', async () => {
    const { select, forCombat } = escenario([tanque, fuego], {
      'jugador-1': ['guerrero-tanque', 'mago-fuego'],
    })

    await select.execute('jugador-1', 'guerrero-tanque')
    const paraTanque = await forCombat.execute('jugador-1')
    await select.execute('jugador-1', 'mago-fuego')
    const paraFuego = await forCombat.execute('jugador-1')

    const poderTanque = createHeroPower(paraTanque.heroId, paraTanque.effectiveStats.power)
    const poderFuego = createHeroPower(paraFuego.heroId, paraFuego.effectiveStats.power)

    const despuesDeGastar = spendPower(poderTanque, fixed(4)).state

    expect(paraTanque.playerId).toBe(paraFuego.playerId)
    expect(paraTanque.heroId).not.toBe(paraFuego.heroId)
    expect(despuesDeGastar).toEqual({ heroId: 'pid-guerrero-tanque', current: 6, max: 10 })
    expect(poderFuego).toEqual({ heroId: 'pid-mago-fuego', current: 8, max: 8 })
  })

  it('un ítem que sube el Poder de forma permanente sube el máximo y el tope de regeneración', async () => {
    const { select, equip, forCombat } = escenario([tanque, powerItem('amuleto', 2)], {
      'jugador-1': ['guerrero-tanque', 'amuleto'],
    })
    await select.execute('jugador-1', 'guerrero-tanque')
    await equip.execute({
      ownerId: 'jugador-1',
      heroReference: 'guerrero-tanque',
      slot: 'ITEM_1',
      productReference: 'amuleto',
    })

    const paraCombate = await forCombat.execute('jugador-1')
    const inicial = createHeroPower(paraCombate.heroId, paraCombate.effectiveStats.power)

    expect(paraCombate.baseStats.power).toBe(10)
    expect(paraCombate.effectiveStats.power).toBe(12)
    expect(getMaxPower(inicial)).toBe(12)
    expect(getPower(inicial)).toBe(12)

    // El tope de +2 por turno es el máximo efectivo (12), no la base (10) ni 13.
    const conUnPuntoMenos = spendPower(inicial, fixed(1)).state
    expect(regenPower(conUnPuntoMenos).current).toBe(12)
  })

  it('control: sin el ítem el mismo héroe queda en 10, así que la prueba distingue de dónde sale el máximo', async () => {
    const { select, forCombat } = escenario([tanque, powerItem('amuleto', 2)], {
      'jugador-1': ['guerrero-tanque', 'amuleto'],
    })
    await select.execute('jugador-1', 'guerrero-tanque')

    const paraCombate = await forCombat.execute('jugador-1')

    expect(getMaxPower(createHeroPower(paraCombate.heroId, paraCombate.effectiveStats.power))).toBe(
      10,
    )
  })

  it('un héroe cuyo basePower es 0 arranca en 0/0 y siempre cae al ataque básico', async () => {
    const sinPoder = hero('sin-poder', 'CHAMAN', 'Sin poder', 0)
    const { select, forCombat } = escenario([sinPoder], { 'jugador-1': ['sin-poder'] })
    await select.execute('jugador-1', 'sin-poder')

    const paraCombate = await forCombat.execute('jugador-1')
    const inicial = createHeroPower(paraCombate.heroId, paraCombate.effectiveStats.power)

    expect(inicial).toEqual({ heroId: 'pid-sin-poder', current: 0, max: 0 })
    expect(spendPower(inicial, fixed(2))).toMatchObject({
      ok: false,
      fallbackAction: 'basic_attack',
    })
  })
})
