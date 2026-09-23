import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import { InMemoryHeroLoadoutRepository } from '../../src/adapters/outbound/persistence/InMemoryHeroLoadoutRepository'
import {
  CatalogUnavailableError,
  type CatalogProductView,
} from '../../src/application/ports/CatalogReadPort'
import type { ClockPort } from '../../src/application/ports/ClockPort'
import type {
  InventoryQueryPort,
  OwnedInventoryItem,
  OwnedInventoryItemsSlice,
} from '../../src/application/ports/InventoryQueryPort'
import { EquipItemOnHero } from '../../src/application/use-cases/EquipItemOnHero'
import { GetHeroProfileForMission } from '../../src/application/use-cases/GetHeroProfileForMission'
import { DomainError } from '../../src/domain/errors/DomainError'
import { HeroNotOwnedError } from '../../src/application/errors/ApplicationError'
import type { PlayerId } from '../../src/domain/value-objects/identifiers'

/**
 * HU-71 (Management#56/#370): perfil de un heroe CONCRETO del jugador para
 * Missions, que lo necesita para validar las habilidades de una estrategia de
 * rotaciones y para congelar el perfil que enviara a Combat en HU-72.
 *
 * El hilo conductor de la suite es que esta ruta NO es la del heroe seleccionado:
 * sirve a cualquier heroe del jugador, resuelve la pertenencia con la misma regla
 * que la consulta publica de equipamiento y no publica nada que dependa de la
 * seleccion.
 */
const clock: ClockPort = { now: () => new Date('2026-09-24T10:00:00.000Z') }

/** Inventario por jugador: permite comprobar la pertenencia sin base de datos. */
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

const envelope = (values: Record<string, unknown>): unknown => ({ schemaVersion: '1', values })

const hero = (
  sku: string,
  subtype: string,
  name: string,
  overrides: Partial<CatalogProductView> = {},
  abilities: readonly string[] = [`hab-${sku}`],
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
  attributes: envelope({
    kind: 'HEROE',
    heroSubtype: subtype,
    basePower: 5,
    baseHealth: 40,
    baseDefense: 8,
    baseAttack: { mode: 'FIXED', amount: 10 },
    baseDamage: { mode: 'DICE', count: 1, sides: 4 },
    abilities: [...abilities],
  }),
  ...overrides,
})

const ability = (sku: string): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name: `Habilidad ${sku}`,
  imageUrl: '',
  description: sku,
  type: 'HABILIDAD',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 0,
  premium: false,
  realMoneyPrice: null,
  attributes: envelope({
    kind: 'HABILIDAD',
    compatibleHeroSubtypes: ['GUERRERO_TANQUE'],
    powerCostMode: 'FIXED',
    powerCost: 2,
    chargeTurns: 1,
    effects: [
      {
        kind: 'STAT_MODIFIER',
        target: 'SELF',
        statistic: 'ATTACK',
        operation: 'INCREASE',
        magnitude: { mode: 'FIXED', amount: 2 },
      },
    ],
  }),
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
  attributes: envelope({
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
  }),
})

interface Escenario {
  readonly profile: GetHeroProfileForMission
  readonly equip: EquipItemOnHero
}

const escenario = (
  catalogo: readonly CatalogProductView[],
  inventarios: Readonly<Record<string, readonly string[]>>,
  catalogDown = false,
): Escenario => {
  const inventories = new FakeInventoryQuery(inventarios)
  const catalog = new InMemoryCatalogReadClient([...catalogo], catalogDown)
  const loadouts = new InMemoryHeroLoadoutRepository()

  return {
    profile: new GetHeroProfileForMission(inventories, catalog, loadouts),
    equip: new EquipItemOnHero(inventories, catalog, loadouts, clock),
  }
}

const catalogoDeGuerrero = (): readonly CatalogProductView[] => [
  hero('guerrero-tanque', 'GUERRERO_TANQUE', 'Guerrero Tanque'),
  ability('hab-guerrero-tanque'),
]

describe('HU-71 — perfil de un heroe concreto para Missions (servicio a servicio)', () => {
  it('devuelve el perfil del heroe que el jugador posee, sin exigir que este seleccionado', async () => {
    const { profile } = escenario(catalogoDeGuerrero(), {
      'jugador-1': ['guerrero-tanque'],
    })

    const resultado = await profile.execute('jugador-1', 'pid-guerrero-tanque')

    expect(resultado).toMatchObject({
      playerId: 'jugador-1',
      heroId: 'pid-guerrero-tanque',
      reference: 'guerrero-tanque',
      subtype: 'GUERRERO_TANQUE',
      name: 'Guerrero Tanque',
      loadoutVersion: 0,
    })
    expect(resultado.baseStats).toMatchObject({ power: 5, health: 40, defense: 8, attack: 10 })
    expect(resultado.effectiveStats).toEqual(resultado.baseStats)
  })

  it('el `heroId` de la respuesta es el `productId` canonico TAMBIEN si se pidio por `sku`', async () => {
    const { profile } = escenario(catalogoDeGuerrero(), {
      'jugador-1': ['guerrero-tanque'],
    })

    const porSku = await profile.execute('jugador-1', 'guerrero-tanque')

    // El consumidor compara este campo con el heroId que envio: devolver la
    // referencia de entrada romperia su comprobacion.
    expect(porSku.heroId).toBe('pid-guerrero-tanque')
    expect(porSku.reference).toBe('guerrero-tanque')
  })

  it('funciona con un heroe que el jugador NUNCA selecciono (es la razon de existir de la ruta)', async () => {
    const catalogo = [
      hero('guerrero-tanque', 'GUERRERO_TANQUE', 'Guerrero Tanque'),
      hero('mago-fuego', 'MAGO_FUEGO', 'Mago Fuego'),
      ability('hab-mago-fuego'),
    ]
    const { profile } = escenario(catalogo, {
      'jugador-1': ['guerrero-tanque', 'mago-fuego'],
    })

    const resultado = await profile.execute('jugador-1', 'pid-mago-fuego')

    expect(resultado).toMatchObject({ heroId: 'pid-mago-fuego', subtype: 'MAGO_FUEGO' })
  })

  it('no publica `ready`, `blockers` ni `selectedAt`: son de la seleccion, no del heroe', async () => {
    const { profile } = escenario(catalogoDeGuerrero(), {
      'jugador-1': ['guerrero-tanque'],
    })

    const resultado = await profile.execute('jugador-1', 'pid-guerrero-tanque')

    expect(Object.keys(resultado).sort()).toEqual([
      'abilities',
      'activeEffects',
      'baseStats',
      'effectiveStats',
      'heroId',
      'loadoutVersion',
      'name',
      'playerId',
      'reference',
      'subtype',
    ])
  })

  it('resuelve las habilidades del heroe desde Catalog, con su `abilityId`', async () => {
    const { profile } = escenario(catalogoDeGuerrero(), {
      'jugador-1': ['guerrero-tanque'],
    })

    const resultado = await profile.execute('jugador-1', 'pid-guerrero-tanque')

    expect(resultado.abilities).toHaveLength(1)
    expect(resultado.abilities[0]).toMatchObject({
      abilityId: 'pid-hab-guerrero-tanque',
      reference: 'hab-guerrero-tanque',
      powerCost: { mode: 'FIXED', amount: 2 },
      chargeTurns: 1,
    })
  })

  it('respeta el orden en que el heroe declara sus habilidades', async () => {
    const catalogo = [
      hero('guerrero-tanque', 'GUERRERO_TANQUE', 'Guerrero Tanque', {}, ['hab-b', 'hab-a']),
      ability('hab-a'),
      ability('hab-b'),
    ]
    const { profile } = escenario(catalogo, { 'jugador-1': ['guerrero-tanque'] })

    const resultado = await profile.execute('jugador-1', 'pid-guerrero-tanque')

    expect(resultado.abilities.map((item) => item.reference)).toEqual(['hab-b', 'hab-a'])
  })

  it('CONTROL: una habilidad declarada que Catalog no resuelve se omite, no se inventa', async () => {
    const catalogo = [
      // El heroe declara dos habilidades, pero solo una existe en Catalog.
      hero('guerrero-tanque', 'GUERRERO_TANQUE', 'Guerrero Tanque', {}, [
        'hab-real',
        'hab-fantasma',
      ]),
      ability('hab-real'),
    ]
    const { profile } = escenario(catalogo, { 'jugador-1': ['guerrero-tanque'] })

    const resultado = await profile.execute('jugador-1', 'pid-guerrero-tanque')

    expect(resultado.abilities.map((item) => item.reference)).toEqual(['hab-real'])
  })

  it('incorpora el equipamiento y su version de loadout cuando el heroe tiene loadout', async () => {
    const catalogo = [...catalogoDeGuerrero(), weapon('espada')]
    const { profile, equip } = escenario(catalogo, {
      'jugador-1': ['guerrero-tanque', 'espada'],
    })
    await equip.execute({
      ownerId: 'jugador-1',
      heroReference: 'guerrero-tanque',
      slot: 'WEAPON_1',
      productReference: 'espada',
    })

    const resultado = await profile.execute('jugador-1', 'pid-guerrero-tanque')

    expect(resultado.loadoutVersion).toBe(1)
    expect(resultado.effectiveStats.attack).toBe(13)
    expect(resultado.baseStats.attack).toBe(10)
    expect(resultado.activeEffects).toHaveLength(1)
    expect(resultado.activeEffects[0]).toMatchObject({
      kind: 'STAT_MODIFIER',
      statistic: 'ATTACK',
      magnitude: { mode: 'FIXED', amount: 3 },
      appliedToStats: true,
    })
  })

  it('un heroe sin loadout se lee como loadout vacio y NO crea estado', async () => {
    const catalogo = [...catalogoDeGuerrero(), weapon('espada')]
    const { profile } = escenario(catalogo, { 'jugador-1': ['guerrero-tanque', 'espada'] })

    const resultado = await profile.execute('jugador-1', 'pid-guerrero-tanque')

    expect(resultado.loadoutVersion).toBe(0)
    expect(resultado.activeEffects).toEqual([])
    // Y una segunda lectura sigue igual: leer no escribe.
    expect((await profile.execute('jugador-1', 'pid-guerrero-tanque')).loadoutVersion).toBe(0)
  })

  it.each([
    ['no esta en su inventario', { 'jugador-1': ['otro-heroe'] }, 'pid-guerrero-tanque'],
    ['Catalog no lo conoce', { 'jugador-1': ['inventado'] }, 'inventado'],
    ['el producto no es un HEROE', { 'jugador-1': ['espada'] }, 'pid-espada'],
  ])('responde heroe ajeno si %s', async (_label, inventarios, heroId) => {
    const catalogo = [...catalogoDeGuerrero(), weapon('espada')]
    const { profile } = escenario(catalogo, inventarios)

    await expect(profile.execute('jugador-1', heroId)).rejects.toBeInstanceOf(HeroNotOwnedError)
  })

  it('el heroe de OTRO jugador no se puede leer', async () => {
    const { profile } = escenario(catalogoDeGuerrero(), {
      'jugador-1': ['guerrero-tanque'],
    })

    await expect(profile.execute('jugador-2', 'pid-guerrero-tanque')).rejects.toBeInstanceOf(
      HeroNotOwnedError,
    )
  })

  it('un `heroId` vacio es 400 y no consulta Catalog', async () => {
    const { profile } = escenario(catalogoDeGuerrero(), {
      'jugador-1': ['guerrero-tanque'],
    })

    await expect(profile.execute('jugador-1', '   ')).rejects.toBeInstanceOf(DomainError)
  })

  it('un `playerId` vacio es 400', async () => {
    const { profile } = escenario(catalogoDeGuerrero(), {
      'jugador-1': ['guerrero-tanque'],
    })

    await expect(profile.execute('', 'pid-guerrero-tanque')).rejects.toThrow()
  })

  it('si Catalog no responde, el error se propaga (503) y no se inventa el perfil', async () => {
    const { profile } = escenario(catalogoDeGuerrero(), { 'jugador-1': ['guerrero-tanque'] }, true)

    await expect(profile.execute('jugador-1', 'pid-guerrero-tanque')).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    )
  })
})
