import { GetEquippedHeroForCombat } from '../../src/application/use-cases/GetEquippedHeroForCombat'
import { GetHeroSelection } from '../../src/application/use-cases/GetHeroSelection'
import { SelectHero } from '../../src/application/use-cases/SelectHero'
import { EquipItemOnHero } from '../../src/application/use-cases/EquipItemOnHero'
import { InMemoryHeroLoadoutRepository } from '../../src/adapters/outbound/persistence/InMemoryHeroLoadoutRepository'
import { InMemoryHeroSelectionRepository } from '../../src/adapters/outbound/persistence/InMemoryHeroSelectionRepository'
import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import {
  CatalogUnavailableError,
  type CatalogProductView,
} from '../../src/application/ports/CatalogReadPort'
import type {
  InventoryQueryPort,
  OwnedInventoryItem,
  OwnedInventoryItemsSlice,
} from '../../src/application/ports/InventoryQueryPort'
import type { ClockPort } from '../../src/application/ports/ClockPort'
import type { PlayerId } from '../../src/domain/value-objects/identifiers'
import { DomainError } from '../../src/domain/errors/DomainError'
import {
  HeroNotOwnedError,
  NoHeroSelectedError,
} from '../../src/application/errors/ApplicationError'

const clock: ClockPort = { now: () => new Date('2026-09-19T12:00:00.000Z') }

/** Inventario por jugador: permite comprobar el aislamiento sin base de datos. */
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
  overrides: Partial<CatalogProductView> = {},
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
      basePower: 5,
      baseHealth: 40,
      baseDefense: 8,
      baseAttack: { mode: 'FIXED', amount: 10 },
      baseDamage: { mode: 'DICE', count: 1, sides: 4 },
      abilities: [`hab-${sku}`],
    },
  },
  ...overrides,
})

const weapon = (sku: string): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name: sku,
  imageUrl: '',
  description: sku,
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
          magnitude: { mode: 'FIXED', amount: 3 },
        },
      ],
    },
  },
})

interface Escenario {
  readonly select: SelectHero
  readonly equip: EquipItemOnHero
  readonly forCombat: GetEquippedHeroForCombat
}

const escenario = (
  catalogo: readonly CatalogProductView[],
  inventarios: Readonly<Record<string, readonly string[]>>,
  catalogDown = false,
): Escenario => {
  const inventories = new FakeInventoryQuery(inventarios)
  const catalog = new InMemoryCatalogReadClient([...catalogo], catalogDown)
  const loadouts = new InMemoryHeroLoadoutRepository()
  const selections = new InMemoryHeroSelectionRepository()
  const current = new GetHeroSelection(inventories, catalog, loadouts, selections)

  return {
    select: new SelectHero(inventories, catalog, loadouts, selections, clock),
    equip: new EquipItemOnHero(inventories, catalog, loadouts, clock),
    forCombat: new GetEquippedHeroForCombat(current),
  }
}

describe('HU-15 — heroe preparado para Combat (contrato interno, Management#24/#392)', () => {
  it('devuelve el heroe preparado de un jugador con heroe equipado', async () => {
    const { select, forCombat } = escenario(
      [hero('guerrero-tanque', 'GUERRERO_TANQUE', 'Guerrero Tanque')],
      { 'jugador-1': ['guerrero-tanque'] },
    )
    await select.execute('jugador-1', 'guerrero-tanque')

    const resultado = await forCombat.execute('jugador-1')

    expect(resultado.playerId).toBe('jugador-1')
    expect(resultado.heroId).toBe('pid-guerrero-tanque')
    expect(resultado.reference).toBe('guerrero-tanque')
    expect(resultado.subtype).toBe('GUERRERO_TANQUE')
    expect(resultado.name).toBe('Guerrero Tanque')
    expect(resultado.baseStats).toMatchObject({ power: 5, health: 40, defense: 8 })
    expect(resultado.effectiveStats).toMatchObject({ power: 5, health: 40, defense: 8 })
    expect(resultado.ready).toBe(true)
    expect(resultado.selectedAt).toBe('2026-09-19T12:00:00.000Z')
  })

  it('refleja estadisticas efectivas tras equipar (HU-28), sin recalcularlas', async () => {
    const { select, equip, forCombat } = escenario(
      [hero('guerrero-tanque', 'GUERRERO_TANQUE', 'Guerrero Tanque'), weapon('espada')],
      { 'jugador-1': ['guerrero-tanque', 'espada'] },
    )
    await select.execute('jugador-1', 'guerrero-tanque')
    await equip.execute({
      ownerId: 'jugador-1',
      heroReference: 'guerrero-tanque',
      slot: 'WEAPON_1',
      productReference: 'espada',
    })

    const resultado = await forCombat.execute('jugador-1')

    expect(resultado.baseStats.attack).toBe(10)
    expect(resultado.effectiveStats.attack).toBe(13)
  })

  it('jugador sin heroe equipado: 404 logico (NoHeroSelectedError)', async () => {
    const { forCombat } = escenario(
      [hero('guerrero-tanque', 'GUERRERO_TANQUE', 'Guerrero Tanque')],
      { 'jugador-1': ['guerrero-tanque'] },
    )

    await expect(forCombat.execute('jugador-1')).rejects.toBeInstanceOf(NoHeroSelectedError)
  })

  it('owner inexistente: sin seleccion registrada, mismo NoHeroSelectedError', async () => {
    const { forCombat } = escenario(
      [hero('guerrero-tanque', 'GUERRERO_TANQUE', 'Guerrero Tanque')],
      {},
    )

    await expect(forCombat.execute('jugador-fantasma')).rejects.toBeInstanceOf(NoHeroSelectedError)
  })

  it('un playerId vacio o en blanco es un DomainError controlado, no un 500', async () => {
    const { forCombat } = escenario([], {})

    await expect(forCombat.execute('   ')).rejects.toBeInstanceOf(DomainError)
  })

  it('el heroe salio del inventario tras seleccionarlo: HeroNotOwnedError, no una respuesta vacia', async () => {
    const inventarios: Record<string, readonly string[]> = { 'jugador-1': ['guerrero-tanque'] }
    const inventories = new FakeInventoryQuery(inventarios)
    const catalog = new InMemoryCatalogReadClient([
      hero('guerrero-tanque', 'GUERRERO_TANQUE', 'Guerrero Tanque'),
    ])
    const loadouts = new InMemoryHeroLoadoutRepository()
    const selections = new InMemoryHeroSelectionRepository()
    const select = new SelectHero(inventories, catalog, loadouts, selections, clock)
    const forCombat = new GetEquippedHeroForCombat(
      new GetHeroSelection(inventories, catalog, loadouts, selections),
    )

    await select.execute('jugador-1', 'guerrero-tanque')
    inventarios['jugador-1'] = []

    await expect(forCombat.execute('jugador-1')).rejects.toBeInstanceOf(HeroNotOwnedError)
  })

  it('propaga la indisponibilidad de Catalog en vez de inventar estadisticas', async () => {
    // La seleccion debe existir ya (Catalog arriba) para que el fallo que se
    // observa sea el de Catalog y no un NoHeroSelectedError previo: GetHeroSelection
    // comprueba primero si hay seleccion, y solo despues resuelve contra Catalog.
    const inventories = new FakeInventoryQuery({ 'jugador-1': ['guerrero-tanque'] })
    const catalogArriba = new InMemoryCatalogReadClient([
      hero('guerrero-tanque', 'GUERRERO_TANQUE', 'Guerrero Tanque'),
    ])
    const loadouts = new InMemoryHeroLoadoutRepository()
    const selections = new InMemoryHeroSelectionRepository()
    const select = new SelectHero(inventories, catalogArriba, loadouts, selections, clock)
    await select.execute('jugador-1', 'guerrero-tanque')

    const catalogAbajo = new InMemoryCatalogReadClient([], true)
    const forCombat = new GetEquippedHeroForCombat(
      new GetHeroSelection(inventories, catalogAbajo, loadouts, selections),
    )

    await expect(forCombat.execute('jugador-1')).rejects.toBeInstanceOf(CatalogUnavailableError)
  })

  it('cada jugador ve unicamente su propio heroe preparado (aislamiento)', async () => {
    const { select, forCombat } = escenario(
      [
        hero('guerrero-tanque', 'GUERRERO_TANQUE', 'Guerrero Tanque'),
        hero('chaman', 'CHAMAN', 'Chaman'),
      ],
      { 'jugador-1': ['guerrero-tanque'], 'jugador-2': ['chaman'] },
    )
    await select.execute('jugador-1', 'guerrero-tanque')
    await select.execute('jugador-2', 'chaman')

    await expect(forCombat.execute('jugador-1')).resolves.toMatchObject({
      subtype: 'GUERRERO_TANQUE',
    })
    await expect(forCombat.execute('jugador-2')).resolves.toMatchObject({ subtype: 'CHAMAN' })
  })

  it('el DTO no filtra datos privados del inventario: solo los campos declarados en EquippedHeroDto', async () => {
    const { select, equip, forCombat } = escenario(
      [hero('guerrero-tanque', 'GUERRERO_TANQUE', 'Guerrero Tanque'), weapon('espada')],
      { 'jugador-1': ['guerrero-tanque', 'espada'] },
    )
    await select.execute('jugador-1', 'guerrero-tanque')
    await equip.execute({
      ownerId: 'jugador-1',
      heroReference: 'guerrero-tanque',
      slot: 'WEAPON_1',
      productReference: 'espada',
    })

    const resultado = await forCombat.execute('jugador-1')

    expect(Object.keys(resultado).sort()).toEqual(
      [
        'playerId',
        'heroId',
        'reference',
        'subtype',
        'name',
        'baseStats',
        'effectiveStats',
        'ready',
        'selectedAt',
      ].sort(),
    )
    // Ni el detalle de equipamiento (itemId/productId/imageUrl/lifecycleStatus
    // de cada ranura), ni la capacidad, ni los efectos activos viajan aqui.
    expect(resultado).not.toHaveProperty('equipment')
    expect(resultado).not.toHaveProperty('capacity')
    expect(resultado).not.toHaveProperty('activeEffects')
    expect(resultado).not.toHaveProperty('imageUrl')
    expect(resultado).not.toHaveProperty('lifecycleStatus')
  })
})
