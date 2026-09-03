import { GetHeroSelection } from '../../src/application/use-cases/GetHeroSelection'
import { ListAvailableHeroes } from '../../src/application/use-cases/ListAvailableHeroes'
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
import {
  HeroNotOwnedError,
  HeroNotSelectableError,
  NoHeroSelectedError,
} from '../../src/application/errors/ApplicationError'

const clock: ClockPort = { now: () => new Date('2026-09-03T12:00:00.000Z') }

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
}

const hero = (
  sku: string,
  subtype: string,
  name: string,
  overrides: Partial<CatalogProductView> = {},
  values: Record<string, unknown> = {},
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
      ...values,
    },
  },
  ...overrides,
})

const ability = (sku: string, name: string): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name,
  imageUrl: '',
  description: name,
  type: 'HABILIDAD',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 0,
  premium: false,
  realMoneyPrice: null,
  attributes: {
    schemaVersion: '1',
    values: {
      kind: 'HABILIDAD',
      compatibleHeroSubtypes: [],
      powerCostMode: 'FIXED',
      powerCost: 2,
      chargeTurns: 1,
      effects: [],
    },
  },
})

const weapon = (sku: string, overrides: Partial<CatalogProductView> = {}): CatalogProductView => ({
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
  ...overrides,
})

interface Escenario {
  readonly list: ListAvailableHeroes
  readonly select: SelectHero
  readonly current: GetHeroSelection
  readonly equip: EquipItemOnHero
  readonly loadouts: InMemoryHeroLoadoutRepository
}

const escenario = (
  catalogo: readonly CatalogProductView[],
  inventarios: Readonly<Record<string, readonly string[]>>,
): Escenario => {
  const inventories = new FakeInventoryQuery(inventarios)
  const catalog = new InMemoryCatalogReadClient([...catalogo])
  const loadouts = new InMemoryHeroLoadoutRepository()
  const selections = new InMemoryHeroSelectionRepository()

  return {
    list: new ListAvailableHeroes(inventories, catalog, selections),
    select: new SelectHero(inventories, catalog, loadouts, selections, clock),
    current: new GetHeroSelection(inventories, catalog, loadouts, selections),
    equip: new EquipItemOnHero(inventories, catalog, loadouts, clock),
    loadouts,
  }
}

const OCHO = [
  hero('guerrero-tanque', 'GUERRERO_TANQUE', 'Guerrero Tanque'),
  hero('guerrero-armas', 'GUERRERO_ARMAS', 'Guerrero Armas'),
  hero('mago-fuego', 'MAGO_FUEGO', 'Mago Fuego'),
  hero('mago-hielo', 'MAGO_HIELO', 'Mago Hielo'),
  hero('picaro-veneno', 'PICARO_VENENO', 'Picaro Veneno'),
  hero('picaro-machete', 'PICARO_MACHETE', 'Picaro Machete'),
  hero('chaman', 'CHAMAN', 'Chaman'),
  hero('medico', 'MEDICO', 'Medico'),
]

const REFERENCIAS_OCHO = OCHO.map((product) => product.sku)

describe('HU-07 — heroes disponibles (CA-02, CA-06, CA-11)', () => {
  it('lista los heroes que el jugador posee, ordenados por nombre', async () => {
    const { list } = escenario(OCHO, { 'jugador-1': REFERENCIAS_OCHO })

    const heroes = await list.execute('jugador-1')

    expect(heroes.map((entry) => entry.subtype)).toEqual([
      'CHAMAN',
      'GUERRERO_ARMAS',
      'GUERRERO_TANQUE',
      'MAGO_FUEGO',
      'MAGO_HIELO',
      'MEDICO',
      'PICARO_MACHETE',
      'PICARO_VENENO',
    ])
  })

  /** CA-06: la lista sale del inventario, no del catalogo entero. */
  it('no ofrece heroes que el jugador no posee', async () => {
    const { list } = escenario(OCHO, { 'jugador-1': ['mago-fuego'] })

    const heroes = await list.execute('jugador-1')

    expect(heroes).toHaveLength(1)
    expect(heroes[0]?.reference).toBe('mago-fuego')
  })

  it('un jugador sin inventario no recibe heroes ni consulta el catalogo', async () => {
    const { list } = escenario(OCHO, {})

    await expect(list.execute('jugador-sin-nada')).resolves.toEqual([])
  })

  /**
   * CONTROL DE CA-11, y la razon de que este caso exista: un NOVENO heroe
   * aprobado por administracion aparece por la ruta sin anadir una sola rama
   * de codigo. Si en algun sitio quedara una lista de ocho, esta prueba
   * fallaria.
   */
  it('un heroe nuevo del catalogo se ofrece sin tocar codigo', async () => {
    const noveno = hero('druida-bosque', 'GUERRERO_TANQUE', 'Druida del Bosque')
    const { list } = escenario([...OCHO, noveno], {
      'jugador-1': [...REFERENCIAS_OCHO, 'druida-bosque'],
    })

    const heroes = await list.execute('jugador-1')

    expect(heroes).toHaveLength(9)
    expect(heroes.map((entry) => entry.name)).toContain('Druida del Bosque')
  })

  it('resuelve el nombre de las habilidades y deja null lo que Catalog no conoce', async () => {
    const { list } = escenario([...OCHO, ability('hab-mago-fuego', 'Bola de fuego')], {
      'jugador-1': ['mago-fuego', 'chaman'],
    })

    const heroes = await list.execute('jugador-1')
    const mago = heroes.find((entry) => entry.subtype === 'MAGO_FUEGO')
    const chaman = heroes.find((entry) => entry.subtype === 'CHAMAN')

    expect(mago?.abilities).toEqual([{ reference: 'hab-mago-fuego', name: 'Bola de fuego' }])
    // No se inventa un nombre para la habilidad que Catalog no devolvio.
    expect(chaman?.abilities).toEqual([{ reference: 'hab-chaman', name: null }])
  })

  /**
   * Un producto que Catalog declara HEROE pero cuyos atributos no cumplen el
   * contrato se omite: un solo producto mal formado no deja al jugador sin
   * poder elegir ninguno de los demas.
   */
  it('omite un heroe con atributos incompletos sin tumbar la lista', async () => {
    const roto = hero('heroe-roto', 'CHAMAN', 'Roto')
    const catalogo = [
      OCHO[0]!,
      { ...roto, attributes: { schemaVersion: '1', values: { kind: 'HEROE' } } },
    ]
    const { list } = escenario(catalogo, { 'jugador-1': ['guerrero-tanque', 'heroe-roto'] })

    const heroes = await list.execute('jugador-1')

    expect(heroes.map((entry) => entry.reference)).toEqual(['guerrero-tanque'])
  })

  it('marca cual esta preparado', async () => {
    const { list, select } = escenario(OCHO, { 'jugador-1': REFERENCIAS_OCHO })
    await select.execute('jugador-1', 'mago-hielo')

    const heroes = await list.execute('jugador-1')

    expect(heroes.filter((entry) => entry.selected).map((entry) => entry.reference)).toEqual([
      'mago-hielo',
    ])
  })
})

describe('HU-07 — preparar un heroe (CA-01, CA-02, CA-11)', () => {
  it('prepara un heroe propio y devuelve su configuracion con estadisticas base', async () => {
    const { select } = escenario(OCHO, { 'jugador-1': ['guerrero-tanque'] })

    const resultado = await select.execute('jugador-1', 'guerrero-tanque')

    expect(resultado.configuration.hero.subtype).toBe('GUERRERO_TANQUE')
    expect(resultado.configuration.baseStats).toMatchObject({ power: 5, health: 40, defense: 8 })
    expect(resultado.readiness.ready).toBe(true)
    expect(resultado.capacity).toEqual({
      weapons: { used: 0, max: 2 },
      armor: { used: 0, max: 6 },
      items: { used: 0, max: 2 },
    })
  })

  it('rechaza un heroe inexistente', async () => {
    const { select } = escenario(OCHO, { 'jugador-1': ['guerrero-tanque'] })

    await expect(select.execute('jugador-1', 'heroe-que-no-existe')).rejects.toBeInstanceOf(
      HeroNotOwnedError,
    )
  })

  it('rechaza un heroe que existe pero no es del jugador', async () => {
    const { select } = escenario(OCHO, {
      'jugador-1': ['guerrero-tanque'],
      'jugador-2': ['chaman'],
    })

    await expect(select.execute('jugador-1', 'chaman')).rejects.toBeInstanceOf(HeroNotOwnedError)
  })

  it('rechaza una referencia que no es un HEROE', async () => {
    const { select } = escenario([...OCHO, weapon('espada')], { 'jugador-1': ['espada'] })

    await expect(select.execute('jugador-1', 'espada')).rejects.toBeInstanceOf(HeroNotOwnedError)
  })

  /**
   * CA-11 habla del catalogo VIGENTE. Un heroe suspendido no lo esta. Se
   * distingue de "no lo tienes" a proposito: el jugador SI lo tiene, y decirle
   * lo contrario le mandaria a buscar donde no es.
   */
  it('rechaza un heroe suspendido con un error distinto de "no lo tienes"', async () => {
    const suspendido = hero('mago-fuego', 'MAGO_FUEGO', 'Mago Fuego', {
      lifecycleStatus: 'SUSPENDED',
    })
    const { select } = escenario([suspendido], { 'jugador-1': ['mago-fuego'] })

    await expect(select.execute('jugador-1', 'mago-fuego')).rejects.toBeInstanceOf(
      HeroNotSelectableError,
    )
  })

  it('preparar dos veces el mismo heroe no mueve la fecha', async () => {
    const { select } = escenario(OCHO, { 'jugador-1': ['guerrero-tanque'] })

    const primera = await select.execute('jugador-1', 'guerrero-tanque')
    const segunda = await select.execute('jugador-1', 'guerrero-tanque')

    expect(segunda.selectedAt).toBe(primera.selectedAt)
  })

  /**
   * Cambiar de heroe NO borra el equipamiento del anterior: volver a el
   * recupera su configuracion intacta. Perderla seria destruir trabajo del
   * jugador sin que ninguna regla de HU-07 lo pida.
   */
  it('cambiar de heroe conserva el equipamiento de cada uno', async () => {
    const { select, equip, current } = escenario([...OCHO, weapon('espada')], {
      'jugador-1': ['guerrero-tanque', 'mago-fuego', 'espada'],
    })

    await select.execute('jugador-1', 'guerrero-tanque')
    await equip.execute({
      ownerId: 'jugador-1',
      heroReference: 'guerrero-tanque',
      slot: 'WEAPON_1',
      productReference: 'espada',
    })

    await select.execute('jugador-1', 'mago-fuego')
    const mago = await current.execute('jugador-1')
    expect(mago.configuration.equipment.weapons).toHaveLength(0)

    await select.execute('jugador-1', 'guerrero-tanque')
    const guerrero = await current.execute('jugador-1')
    expect(guerrero.configuration.equipment.weapons.map((entry) => entry.itemId)).toEqual([
      'espada',
    ])
  })
})

describe('HU-07 — configuracion preparada (CA-01, CA-08, CA-10)', () => {
  it('sin seleccion previa no hay configuracion', async () => {
    const { current } = escenario(OCHO, { 'jugador-1': REFERENCIAS_OCHO })

    await expect(current.execute('jugador-1')).rejects.toBeInstanceOf(NoHeroSelectedError)
  })

  /**
   * CA-08: las estadisticas del heroe preparado son las que devuelve el calculo
   * de HU-28 despues de equipar. HU-07 no las recalcula; este caso comprueba
   * justamente que las REFLEJA.
   */
  it('refleja las estadisticas efectivas despues de equipar (HU-28)', async () => {
    const { select, equip, current } = escenario([...OCHO, weapon('espada')], {
      'jugador-1': ['guerrero-tanque', 'espada'],
    })

    await select.execute('jugador-1', 'guerrero-tanque')
    const antes = await current.execute('jugador-1')
    expect(antes.configuration.effectiveStats.attack).toBe(10)
    expect(antes.capacity.weapons).toEqual({ used: 0, max: 2 })

    await equip.execute({
      ownerId: 'jugador-1',
      heroReference: 'guerrero-tanque',
      slot: 'WEAPON_1',
      productReference: 'espada',
    })

    const despues = await current.execute('jugador-1')
    expect(despues.configuration.effectiveStats.attack).toBe(13)
    expect(despues.configuration.baseStats.attack).toBe(10)
    expect(despues.capacity.weapons).toEqual({ used: 1, max: 2 })
    expect(despues.readiness.ready).toBe(true)
  })

  /**
   * Aislamiento entre jugadores: la configuracion se resuelve SIEMPRE con el
   * sujeto que llega, y no hay parametro con el que pedir la de otra persona.
   */
  it('cada jugador ve su propia configuracion', async () => {
    const { select, current } = escenario(OCHO, {
      'jugador-1': ['guerrero-tanque'],
      'jugador-2': ['chaman'],
    })

    await select.execute('jugador-1', 'guerrero-tanque')
    await select.execute('jugador-2', 'chaman')

    await expect(current.execute('jugador-1')).resolves.toMatchObject({
      configuration: { hero: { subtype: 'GUERRERO_TANQUE' } },
    })
    await expect(current.execute('jugador-2')).resolves.toMatchObject({
      configuration: { hero: { subtype: 'CHAMAN' } },
    })
  })

  it('un heroe que sale del inventario deja de resolverse', async () => {
    const inventarios: Record<string, readonly string[]> = { 'jugador-1': ['guerrero-tanque'] }
    const inventories = new FakeInventoryQuery(inventarios)
    const catalog = new InMemoryCatalogReadClient([...OCHO])
    const loadouts = new InMemoryHeroLoadoutRepository()
    const selections = new InMemoryHeroSelectionRepository()
    const select = new SelectHero(inventories, catalog, loadouts, selections, clock)
    const current = new GetHeroSelection(inventories, catalog, loadouts, selections)

    await select.execute('jugador-1', 'guerrero-tanque')
    inventarios['jugador-1'] = []

    await expect(current.execute('jugador-1')).rejects.toBeInstanceOf(HeroNotOwnedError)
  })

  it('propaga la indisponibilidad de Catalog en vez de inventar estadisticas', async () => {
    const inventories = new FakeInventoryQuery({ 'jugador-1': ['guerrero-tanque'] })
    const catalog = new InMemoryCatalogReadClient([], true)
    const selections = new InMemoryHeroSelectionRepository()
    const list = new ListAvailableHeroes(inventories, catalog, selections)

    await expect(list.execute('jugador-1')).rejects.toBeInstanceOf(CatalogUnavailableError)
  })
})
