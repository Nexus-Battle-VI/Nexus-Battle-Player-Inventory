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
        'activeEffects',
        'ready',
        'selectedAt',
      ].sort(),
    )
    // Ni el detalle de equipamiento (itemId/productId/imageUrl/lifecycleStatus
    // de cada ranura), ni la capacidad viajan aqui. `activeEffects` (HU-25) si,
    // pero normalizado: se comprueba campo a campo en el bloque siguiente.
    expect(resultado).not.toHaveProperty('equipment')
    expect(resultado).not.toHaveProperty('capacity')
    expect(resultado).not.toHaveProperty('imageUrl')
    expect(resultado).not.toHaveProperty('lifecycleStatus')
    expect(resultado).not.toHaveProperty('level')
  })
})

/** Efecto canonico de Catalog tal como llega en `attributes.values.effects`. */
type CatalogEffect = Readonly<Record<string, unknown>>

const statModifier = (
  statistic: string,
  operation: string,
  magnitude: unknown,
  extra: CatalogEffect = {},
): CatalogEffect => ({
  kind: 'STAT_MODIFIER',
  target: 'SELF',
  statistic,
  operation,
  magnitude,
  // Campo que SOLO existe en el objeto crudo de Catalog: si aparece en la
  // respuesta, `raw` (o un spread del efecto) se filtro.
  stackable: false,
  ...extra,
})

const equipable = (
  sku: string,
  type: 'ARMA' | 'ARMADURA' | 'ITEM',
  effects: readonly CatalogEffect[],
  extraValues: CatalogEffect = {},
): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name: sku,
  imageUrl: `https://assets.example.test/${sku}.png`,
  description: sku,
  type,
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 5,
  premium: false,
  realMoneyPrice: null,
  attributes: {
    schemaVersion: '1',
    values: { kind: type, compatibilityScope: 'ALL_HEROES', effects, ...extraValues },
  },
})

/** Catalog con contadores: prueba que el contrato no consulta mas de lo que ya consulta HU-07. */
class CountingCatalog extends InMemoryCatalogReadClient {
  calls = 0

  override getByReference(reference: string): Promise<CatalogProductView | null> {
    this.calls += 1
    return super.getByReference(reference)
  }

  override lookup(
    query: Parameters<InMemoryCatalogReadClient['lookup']>[0],
  ): Promise<readonly CatalogProductView[]> {
    this.calls += 1
    return super.lookup(query)
  }
}

interface Preparado extends Escenario {
  readonly current: GetHeroSelection
  readonly catalog: CountingCatalog
}

const preparado = (
  catalogo: readonly CatalogProductView[],
  inventarios: Readonly<Record<string, readonly string[]>>,
): Preparado => {
  const inventories = new FakeInventoryQuery(inventarios)
  const catalog = new CountingCatalog([...catalogo])
  const loadouts = new InMemoryHeroLoadoutRepository()
  const selections = new InMemoryHeroSelectionRepository()
  const current = new GetHeroSelection(inventories, catalog, loadouts, selections)

  return {
    select: new SelectHero(inventories, catalog, loadouts, selections, clock),
    equip: new EquipItemOnHero(inventories, catalog, loadouts, clock),
    forCombat: new GetEquippedHeroForCombat(current),
    current,
    catalog,
  }
}

describe('HU-25 — activeEffects del heroe equipado (contrato interno, Management#72/#75/#152)', () => {
  const HEROE = hero('guerrero-armas', 'GUERRERO_ARMAS', 'Guerrero Armas')

  const equipar = async (
    e: Escenario,
    slot: string,
    productReference: string,
    jugador = 'jugador-1',
  ): Promise<void> => {
    await e.equip.execute({
      ownerId: jugador,
      heroReference: 'guerrero-armas',
      slot,
      productReference,
    })
  }

  it('heroe sin productos que modulen nada: activeEffects es una lista vacia, no ausente', async () => {
    const e = preparado([HEROE], { 'jugador-1': ['guerrero-armas'] })
    await e.select.execute('jugador-1', 'guerrero-armas')

    const resultado = await e.forCombat.execute('jugador-1')

    expect(resultado.activeEffects).toEqual([])
    expect(Array.isArray(resultado.activeEffects)).toBe(true)
  })

  it('un producto equipado sin efectos declarados tampoco aporta nada', async () => {
    const e = preparado([HEROE, equipable('escudo-liso', 'ARMA', [])], {
      'jugador-1': ['guerrero-armas', 'escudo-liso'],
    })
    await e.select.execute('jugador-1', 'guerrero-armas')
    await equipar(e, 'WEAPON_1', 'escudo-liso')

    expect((await e.forCombat.execute('jugador-1')).activeEffects).toEqual([])
  })

  it('arma con un modificador permanente de ataque (FIXED): viaja normalizado y appliedToStats=true', async () => {
    const e = preparado(
      [
        HEROE,
        equipable('espada', 'ARMA', [
          statModifier('ATTACK', 'INCREASE', { mode: 'FIXED', amount: 3 }),
        ]),
      ],
      { 'jugador-1': ['guerrero-armas', 'espada'] },
    )
    await e.select.execute('jugador-1', 'guerrero-armas')
    await equipar(e, 'WEAPON_1', 'espada')

    const resultado = await e.forCombat.execute('jugador-1')

    expect(resultado.activeEffects).toEqual([
      {
        sourceProductId: 'pid-espada',
        sourceProductReference: 'espada',
        kind: 'STAT_MODIFIER',
        target: 'SELF',
        statistic: 'ATTACK',
        operation: 'INCREASE',
        magnitude: { mode: 'FIXED', amount: 3 },
        hasActivationCondition: false,
        appliedToStats: true,
      },
    ])
    // Control de doble aplicacion: el +3 YA esta en effectiveStats. Si viaja
    // como appliedToStats=true es para que nadie lo sume otra vez.
    expect(resultado.baseStats.attack).toBe(10)
    expect(resultado.effectiveStats.attack).toBe(13)
  })

  it('CRITICAL_CHANCE PERCENTAGE 300: se transporta tal cual, appliedToStats=false y sin interpretar la unidad', async () => {
    const e = preparado(
      [
        HEROE,
        equipable('espada-critica', 'ARMA', [
          statModifier('CRITICAL_CHANCE', 'INCREASE', { mode: 'PERCENTAGE', basisPoints: 300 }),
        ]),
      ],
      { 'jugador-1': ['guerrero-armas', 'espada-critica'] },
    )
    await e.select.execute('jugador-1', 'guerrero-armas')
    await equipar(e, 'WEAPON_1', 'espada-critica')

    const resultado = await e.forCombat.execute('jugador-1')

    expect(resultado.activeEffects).toEqual([
      {
        sourceProductId: 'pid-espada-critica',
        sourceProductReference: 'espada-critica',
        kind: 'STAT_MODIFIER',
        target: 'SELF',
        statistic: 'CRITICAL_CHANCE',
        operation: 'INCREASE',
        // 300 pb, sin convertir a puntos porcentuales ni a filas: la unidad
        // (absoluta vs relativa) NO esta definida y este contrato no la decide.
        magnitude: { mode: 'PERCENTAGE', basisPoints: 300 },
        hasActivationCondition: false,
        appliedToStats: false,
      },
    ])
    // El critico no se colapsa a ninguna estadistica numerica.
    expect(resultado.effectiveStats).toEqual(resultado.baseStats)
  })

  it('un modificador PERCENTAGE sobre una estadistica numerica se conserva como PERCENTAGE y esta aplicado', async () => {
    const e = preparado(
      [
        HEROE,
        equipable(
          'casco-firme',
          'ARMADURA',
          [statModifier('DEFENSE', 'INCREASE', { mode: 'PERCENTAGE', basisPoints: 5000 })],
          { slot: 'HEAD' },
        ),
      ],
      { 'jugador-1': ['guerrero-armas', 'casco-firme'] },
    )
    await e.select.execute('jugador-1', 'guerrero-armas')
    await equipar(e, 'HELMET', 'casco-firme')

    const resultado = await e.forCombat.execute('jugador-1')

    expect(resultado.activeEffects).toHaveLength(1)
    expect(resultado.activeEffects[0]).toMatchObject({
      statistic: 'DEFENSE',
      magnitude: { mode: 'PERCENTAGE', basisPoints: 5000 },
      appliedToStats: true,
    })
    expect(resultado.baseStats.defense).toBe(8)
    expect(resultado.effectiveStats.defense).toBe(12)
  })

  it('magnitud DICE: se conserva sin colapsar; sin statistic ni operation no se inventan', async () => {
    const e = preparado(
      [
        HEROE,
        equipable('daga-envenenada', 'ARMA', [
          { kind: 'DAMAGE', target: 'OPPONENT', magnitude: { mode: 'DICE', count: 1, sides: 6 } },
        ]),
      ],
      { 'jugador-1': ['guerrero-armas', 'daga-envenenada'] },
    )
    await e.select.execute('jugador-1', 'guerrero-armas')
    await equipar(e, 'WEAPON_1', 'daga-envenenada')

    const [efecto] = (await e.forCombat.execute('jugador-1')).activeEffects

    expect(efecto).toEqual({
      sourceProductId: 'pid-daga-envenenada',
      sourceProductReference: 'daga-envenenada',
      kind: 'DAMAGE',
      target: 'OPPONENT',
      magnitude: { mode: 'DICE', count: 1, sides: 6 },
      hasActivationCondition: false,
      appliedToStats: false,
    })
    expect(efecto).not.toHaveProperty('statistic')
    expect(efecto).not.toHaveProperty('operation')
    expect(efecto).not.toHaveProperty('durationTurns')
  })

  it('efecto con condicion de activacion: hasActivationCondition=true, appliedToStats=false y la condicion NO viaja', async () => {
    const condicion = { kind: 'EVERY_N_TURNS', intervalTurns: 2 }
    const e = preparado(
      [
        HEROE,
        equipable('amuleto', 'ITEM', [
          statModifier(
            'DEFENSE',
            'INCREASE',
            { mode: 'FIXED', amount: 2 },
            { activationCondition: condicion },
          ),
        ]),
      ],
      { 'jugador-1': ['guerrero-armas', 'amuleto'] },
    )
    await e.select.execute('jugador-1', 'guerrero-armas')
    await equipar(e, 'ITEM_1', 'amuleto')

    const resultado = await e.forCombat.execute('jugador-1')

    expect(resultado.activeEffects).toHaveLength(1)
    expect(resultado.activeEffects[0]).toMatchObject({
      hasActivationCondition: true,
      appliedToStats: false,
    })
    // La condicion impide la aplicacion permanente: la defensa efectiva no se
    // mueve. La prueba siguiente es el control (mismo efecto sin condicion).
    expect(resultado.effectiveStats.defense).toBe(resultado.baseStats.defense)
    expect(JSON.stringify(resultado)).not.toContain('EVERY_N_TURNS')
    expect(JSON.stringify(resultado)).not.toContain('intervalTurns')
  })

  it('control de la prueba anterior: sin condicion, el mismo efecto SI queda aplicado', async () => {
    const e = preparado(
      [
        HEROE,
        equipable('amuleto-sin-condicion', 'ITEM', [
          statModifier('DEFENSE', 'INCREASE', { mode: 'FIXED', amount: 2 }),
        ]),
      ],
      { 'jugador-1': ['guerrero-armas', 'amuleto-sin-condicion'] },
    )
    await e.select.execute('jugador-1', 'guerrero-armas')
    await equipar(e, 'ITEM_1', 'amuleto-sin-condicion')

    const resultado = await e.forCombat.execute('jugador-1')

    expect(resultado.activeEffects[0]).toMatchObject({
      hasActivationCondition: false,
      appliedToStats: true,
    })
    expect(resultado.effectiveStats.defense).toBe(resultado.baseStats.defense + 2)
  })

  it('efecto temporal: durationTurns viaja y el efecto no se aplica a las estadisticas', async () => {
    const e = preparado(
      [
        HEROE,
        equipable(
          'brazalete',
          'ARMADURA',
          [statModifier('ATTACK', 'INCREASE', { mode: 'FIXED', amount: 2 }, { durationTurns: 3 })],
          { slot: 'BRACERS' },
        ),
      ],
      { 'jugador-1': ['guerrero-armas', 'brazalete'] },
    )
    await e.select.execute('jugador-1', 'guerrero-armas')
    await equipar(e, 'BRACERS', 'brazalete')

    const resultado = await e.forCombat.execute('jugador-1')

    expect(resultado.activeEffects[0]).toMatchObject({
      durationTurns: 3,
      appliedToStats: false,
    })
    expect(resultado.effectiveStats.attack).toBe(resultado.baseStats.attack)
  })

  it('efecto dirigido a otro objetivo conserva su target: no se presenta como propio', async () => {
    const e = preparado(
      [
        HEROE,
        equipable('lanza-debilitante', 'ARMA', [
          statModifier('DEFENSE', 'DECREASE', { mode: 'FIXED', amount: 2 }, { target: 'OPPONENT' }),
        ]),
      ],
      { 'jugador-1': ['guerrero-armas', 'lanza-debilitante'] },
    )
    await e.select.execute('jugador-1', 'guerrero-armas')
    await equipar(e, 'WEAPON_1', 'lanza-debilitante')

    const resultado = await e.forCombat.execute('jugador-1')

    expect(resultado.activeEffects[0]).toMatchObject({ target: 'OPPONENT', appliedToStats: false })
    expect(resultado.effectiveStats.defense).toBe(resultado.baseStats.defense)
  })

  it('varios efectos de varias piezas: todos viajan, con su procedencia, en el orden estable de las ranuras', async () => {
    const e = preparado(
      [
        HEROE,
        equipable('espada', 'ARMA', [
          statModifier('ATTACK', 'INCREASE', { mode: 'FIXED', amount: 3 }),
          statModifier('CRITICAL_CHANCE', 'INCREASE', { mode: 'PERCENTAGE', basisPoints: 300 }),
        ]),
        equipable(
          'casco',
          'ARMADURA',
          [statModifier('DEFENSE', 'INCREASE', { mode: 'FIXED', amount: 1 })],
          { slot: 'HEAD' },
        ),
        equipable('anillo', 'ITEM', [
          statModifier('CRITICAL_CHANCE', 'INCREASE', { mode: 'PERCENTAGE', basisPoints: 100 }),
        ]),
      ],
      { 'jugador-1': ['guerrero-armas', 'espada', 'casco', 'anillo'] },
    )
    await e.select.execute('jugador-1', 'guerrero-armas')
    // Se equipan en orden inverso al de las ranuras: el orden de la respuesta
    // NO depende del orden en que se equipo.
    await equipar(e, 'ITEM_1', 'anillo')
    await equipar(e, 'HELMET', 'casco')
    await equipar(e, 'WEAPON_1', 'espada')

    const resultado = await e.forCombat.execute('jugador-1')

    expect(
      resultado.activeEffects.map((efecto) => [
        efecto.sourceProductReference,
        efecto.statistic,
        efecto.appliedToStats,
      ]),
    ).toEqual([
      ['espada', 'ATTACK', true],
      ['espada', 'CRITICAL_CHANCE', false],
      ['casco', 'DEFENSE', true],
      ['anillo', 'CRITICAL_CHANCE', false],
    ])
    // Dos piezas distintas aportan critico: viajan como dos efectos, sin sumarlos.
    // Como se apilan NO esta definido y este contrato no lo decide.
    expect(
      resultado.activeEffects.filter((efecto) => efecto.statistic === 'CRITICAL_CHANCE'),
    ).toHaveLength(2)
  })

  it('el subtipo, las estadisticas base y las efectivas quedan intactos con equipamiento', async () => {
    const e = preparado(
      [
        HEROE,
        equipable('espada', 'ARMA', [
          statModifier('ATTACK', 'INCREASE', { mode: 'FIXED', amount: 3 }),
          statModifier('CRITICAL_CHANCE', 'INCREASE', { mode: 'PERCENTAGE', basisPoints: 300 }),
        ]),
      ],
      { 'jugador-1': ['guerrero-armas', 'espada'] },
    )
    await e.select.execute('jugador-1', 'guerrero-armas')
    await equipar(e, 'WEAPON_1', 'espada')

    const resultado = await e.forCombat.execute('jugador-1')

    expect(resultado.subtype).toBe('GUERRERO_ARMAS')
    expect(resultado.baseStats).toEqual({
      power: 5,
      health: 40,
      defense: 8,
      attack: 10,
      damage: { mode: 'DICE', count: 1, sides: 4 },
      healing: null,
    })
    expect(resultado.effectiveStats).toEqual({
      power: 5,
      health: 40,
      defense: 8,
      attack: 13,
      damage: { mode: 'DICE', count: 1, sides: 4 },
      healing: null,
    })
  })

  it('NO se filtra el objeto crudo de Catalog ni la ranura: solo la lista blanca de campos', async () => {
    const e = preparado(
      [
        HEROE,
        equipable('espada', 'ARMA', [
          statModifier(
            'ATTACK',
            'INCREASE',
            { mode: 'FIXED', amount: 3 },
            { durationTurns: 2, activationCondition: { kind: 'EVERY_N_TURNS', intervalTurns: 2 } },
          ),
        ]),
      ],
      { 'jugador-1': ['guerrero-armas', 'espada'] },
    )
    await e.select.execute('jugador-1', 'guerrero-armas')
    await equipar(e, 'WEAPON_1', 'espada')

    const [efecto] = (await e.forCombat.execute('jugador-1')).activeEffects

    // Efecto con TODOS los opcionales presentes: la lista de claves es exacta.
    expect(Object.keys(efecto ?? {}).sort()).toEqual(
      [
        'sourceProductId',
        'sourceProductReference',
        'kind',
        'target',
        'statistic',
        'operation',
        'magnitude',
        'durationTurns',
        'hasActivationCondition',
        'appliedToStats',
      ].sort(),
    )
    expect(efecto).not.toHaveProperty('raw')
    expect(efecto).not.toHaveProperty('sourceSlot')
    // `stackable` solo existe dentro de `raw`: si aparece, el crudo cruzo la frontera.
    expect(JSON.stringify(efecto)).not.toContain('stackable')
    expect(JSON.stringify(efecto)).not.toContain('WEAPON_1')
  })

  it('misma fuente que HU-07/HU-28: los efectos son la proyeccion exacta de configuration.activeEffects', async () => {
    const e = preparado(
      [
        HEROE,
        equipable('espada', 'ARMA', [
          statModifier('ATTACK', 'INCREASE', { mode: 'FIXED', amount: 3 }),
          statModifier('CRITICAL_CHANCE', 'INCREASE', { mode: 'PERCENTAGE', basisPoints: 300 }),
        ]),
        equipable('amuleto', 'ITEM', [
          statModifier(
            'DEFENSE',
            'INCREASE',
            { mode: 'FIXED', amount: 2 },
            { activationCondition: { kind: 'EVERY_N_TURNS', intervalTurns: 2 } },
          ),
        ]),
      ],
      { 'jugador-1': ['guerrero-armas', 'espada', 'amuleto'] },
    )
    await e.select.execute('jugador-1', 'guerrero-armas')
    await equipar(e, 'WEAPON_1', 'espada')
    await equipar(e, 'ITEM_1', 'amuleto')

    const publico = (await e.current.execute('jugador-1')).configuration.activeEffects
    const interno = (await e.forCombat.execute('jugador-1')).activeEffects

    expect(publico).toHaveLength(3)
    // Lo unico que se quita del efecto publico es lo que el contrato interno
    // excluye a proposito; todo lo demas coincide valor por valor.
    const esperado = publico.map((efecto) => {
      const proyectado: Record<string, unknown> = { ...efecto }
      delete proyectado.raw
      delete proyectado.sourceSlot
      return proyectado
    })
    expect(interno).toEqual(esperado)
  })

  it('no hay un segundo calculo ni una segunda consulta a Catalog: mismas llamadas que HU-07', async () => {
    const e = preparado(
      [
        HEROE,
        equipable('espada', 'ARMA', [
          statModifier('ATTACK', 'INCREASE', { mode: 'FIXED', amount: 3 }),
        ]),
      ],
      { 'jugador-1': ['guerrero-armas', 'espada'] },
    )
    await e.select.execute('jugador-1', 'guerrero-armas')
    await equipar(e, 'WEAPON_1', 'espada')

    e.catalog.calls = 0
    await e.current.execute('jugador-1')
    const llamadasDeHu07 = e.catalog.calls

    e.catalog.calls = 0
    await e.forCombat.execute('jugador-1')
    const llamadasParaCombat = e.catalog.calls

    expect(llamadasDeHu07).toBeGreaterThan(0)
    expect(llamadasParaCombat).toBe(llamadasDeHu07)
  })

  it('aislamiento: los efectos de un jugador no aparecen en el heroe de otro', async () => {
    const e = preparado(
      [
        HEROE,
        equipable('espada', 'ARMA', [
          statModifier('ATTACK', 'INCREASE', { mode: 'FIXED', amount: 3 }),
        ]),
      ],
      { 'jugador-1': ['guerrero-armas', 'espada'], 'jugador-2': ['guerrero-armas'] },
    )
    await e.select.execute('jugador-1', 'guerrero-armas')
    await e.select.execute('jugador-2', 'guerrero-armas')
    await equipar(e, 'WEAPON_1', 'espada', 'jugador-1')

    expect((await e.forCombat.execute('jugador-1')).activeEffects).toHaveLength(1)
    expect((await e.forCombat.execute('jugador-2')).activeEffects).toEqual([])
  })

  it('un jugador sin heroe preparado sigue siendo NoHeroSelectedError, con o sin efectos', async () => {
    const e = preparado([HEROE, equipable('espada', 'ARMA', [])], {
      'jugador-1': ['guerrero-armas', 'espada'],
    })

    await expect(e.forCombat.execute('jugador-1')).rejects.toBeInstanceOf(NoHeroSelectedError)
  })
})
