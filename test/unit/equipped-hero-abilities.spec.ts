import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import { InMemoryHeroLoadoutRepository } from '../../src/adapters/outbound/persistence/InMemoryHeroLoadoutRepository'
import { InMemoryHeroSelectionRepository } from '../../src/adapters/outbound/persistence/InMemoryHeroSelectionRepository'
import {
  CatalogUnavailableError,
  type CatalogLookupQuery,
  type CatalogProductView,
} from '../../src/application/ports/CatalogReadPort'
import type { ClockPort } from '../../src/application/ports/ClockPort'
import type {
  InventoryQueryPort,
  OwnedInventoryItem,
  OwnedInventoryItemsSlice,
} from '../../src/application/ports/InventoryQueryPort'
import { GetEquippedHeroForCombat } from '../../src/application/use-cases/GetEquippedHeroForCombat'
import { GetHeroSelection } from '../../src/application/use-cases/GetHeroSelection'
import { SelectHero } from '../../src/application/use-cases/SelectHero'
import { DomainError } from '../../src/domain/errors/DomainError'
import { parseAbilityAttributes } from '../../src/domain/value-objects/equipment-effects'
import type { PlayerId } from '../../src/domain/value-objects/identifiers'

/**
 * HU-19 (Management#63): las habilidades especiales del heroe llegan a Combat en
 * `equipped-hero.abilities`. Player-Inventory las RESUELVE desde Catalog y las
 * normaliza; no las ejecuta ni decide que efecto es soportado.
 */
const clock: ClockPort = { now: () => new Date('2026-09-21T12:00:00.000Z') }

const envelope = (values: Record<string, unknown>): unknown => ({ schemaVersion: '1', values })

const abilityValues = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
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
  ...overrides,
})

describe('HU-19 — parseAbilityAttributes (Catalog v1 HABILIDAD)', () => {
  it('normaliza un costo FIXED, la recarga y los efectos', () => {
    const view = parseAbilityAttributes(envelope(abilityValues()))

    expect(view).toMatchObject({
      kind: 'HABILIDAD',
      compatibleHeroSubtypes: ['GUERRERO_TANQUE'],
      powerCost: { mode: 'FIXED', amount: 2 },
      chargeTurns: 1,
    })
    expect(view.effects).toHaveLength(1)
    expect(view.effects[0]).toMatchObject({
      kind: 'STAT_MODIFIER',
      target: 'SELF',
      statistic: 'ATTACK',
      operation: 'INCREASE',
      magnitude: { mode: 'FIXED', amount: 2 },
      hasActivationCondition: false,
    })
  })

  it('admite ALL_AVAILABLE sin monto (Reanimacion: «todos los puntos de poder»)', () => {
    const view = parseAbilityAttributes(
      envelope(abilityValues({ powerCostMode: 'ALL_AVAILABLE', powerCost: undefined })),
    )

    expect(view.powerCost).toEqual({ mode: 'ALL_AVAILABLE' })
  })

  it('conserva dados y marca la condicion de activacion solo como indicador', () => {
    const view = parseAbilityAttributes(
      envelope(
        abilityValues({
          effects: [
            {
              kind: 'STAT_MODIFIER',
              target: 'SELF',
              statistic: 'DAMAGE',
              operation: 'INCREASE',
              magnitude: { mode: 'DICE', count: 3, sides: 9 },
              durationTurns: 2,
              activationCondition: { kind: 'PREVIOUS_TURN_DAMAGE_RECEIVED' },
            },
          ],
        }),
      ),
    )

    expect(view.effects[0]).toMatchObject({
      magnitude: { mode: 'DICE', count: 3, sides: 9 },
      durationTurns: 2,
      hasActivationCondition: true,
    })
  })

  it.each([
    ['sin sobre', undefined],
    ['sin values', { schemaVersion: '1' }],
    ['de otro tipo', envelope({ ...abilityValues(), kind: 'ARMA' })],
    ['sin recarga', envelope({ ...abilityValues(), chargeTurns: undefined })],
    ['con recarga 0', envelope(abilityValues({ chargeTurns: 0 }))],
    ['con recarga decimal', envelope(abilityValues({ chargeTurns: 1.5 }))],
    ['sin modo de costo', envelope(abilityValues({ powerCostMode: undefined }))],
    ['con modo de costo desconocido', envelope(abilityValues({ powerCostMode: 'PERCENT' }))],
    ['FIXED sin monto', envelope(abilityValues({ powerCost: undefined }))],
    ['FIXED con monto 0', envelope(abilityValues({ powerCost: 0 }))],
    ['FIXED con monto decimal', envelope(abilityValues({ powerCost: 2.5 }))],
    ['FIXED con monto negativo', envelope(abilityValues({ powerCost: -1 }))],
  ])('rechaza (DomainError) una habilidad %s: no se corrige en silencio', (_label, attributes) => {
    expect(() => parseAbilityAttributes(attributes)).toThrow(DomainError)
  })

  it('unos efectos que no son una lista se leen como ninguno (no se inventan)', () => {
    expect(
      parseAbilityAttributes(envelope(abilityValues({ effects: 'no-lista' }))).effects,
    ).toEqual([])
  })
})

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

/** Cuenta las `lookup` de habilidades y puede fallar solo en ellas (Catalog cae a mitad de camino). */
class AbilityAwareCatalog extends InMemoryCatalogReadClient {
  abilityLookups = 0
  failOnAbilities = false

  override lookup(query: CatalogLookupQuery): Promise<readonly CatalogProductView[]> {
    if (query.type === 'HABILIDAD') {
      this.abilityLookups += 1

      if (this.failOnAbilities) {
        return Promise.reject(new CatalogUnavailableError('cayo justo al resolver habilidades'))
      }
    }

    return super.lookup(query)
  }
}

const hero = (abilities: readonly string[]): CatalogProductView => ({
  productId: 'pid-guerrero-tanque',
  sku: 'guerrero-tanque',
  name: 'Guerrero Tanque',
  imageUrl: '',
  description: 'Guerrero Tanque',
  type: 'HEROE',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 0,
  premium: false,
  realMoneyPrice: null,
  attributes: envelope({
    kind: 'HEROE',
    heroSubtype: 'GUERRERO_TANQUE',
    basePower: 10,
    baseHealth: 44,
    baseDefense: 11,
    baseAttack: { mode: 'FIXED', amount: 10 },
    baseDamage: { mode: 'DICE', count: 1, sides: 4 },
    abilities,
  }),
})

const ability = (
  sku: string,
  name: string,
  attributes: unknown,
  type = 'HABILIDAD',
): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name,
  imageUrl: '',
  description: name,
  type,
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 0,
  premium: false,
  realMoneyPrice: null,
  attributes,
})

const escenario = async (
  catalogo: readonly CatalogProductView[],
): Promise<{
  readonly forCombat: GetEquippedHeroForCombat
  readonly catalog: AbilityAwareCatalog
}> => {
  const inventories = new FakeInventoryQuery({ 'jugador-1': ['guerrero-tanque'] })
  const catalog = new AbilityAwareCatalog([...catalogo])
  const loadouts = new InMemoryHeroLoadoutRepository()
  const selections = new InMemoryHeroSelectionRepository()
  const select = new SelectHero(inventories, catalog, loadouts, selections, clock)

  await select.execute('jugador-1', 'guerrero-tanque')

  return {
    forCombat: new GetEquippedHeroForCombat(
      new GetHeroSelection(inventories, catalog, loadouts, selections),
      loadouts,
      catalog,
    ),
    catalog,
  }
}

describe('HU-19 — GetEquippedHeroForCombat resuelve las habilidades del heroe', () => {
  const GOLPE = ability('golpe-con-escudo', 'Golpe con escudo', envelope(abilityValues()))
  const MANO = ability(
    'mano-de-piedra',
    'Mano de piedra',
    envelope(abilityValues({ powerCost: 4 })),
  )

  it('las devuelve en el orden en que Catalog las declara en el heroe, con costo, recarga y efectos', async () => {
    // Catalog las devuelve por nombre (Golpe antes que Mano); el heroe las declara al reves.
    const { forCombat } = await escenario([
      hero(['pid-mano-de-piedra', 'pid-golpe-con-escudo']),
      GOLPE,
      MANO,
    ])

    const resultado = await forCombat.execute('jugador-1')

    expect(resultado.abilities.map((entry) => entry.name)).toEqual([
      'Mano de piedra',
      'Golpe con escudo',
    ])
    expect(resultado.abilities[1]).toEqual({
      abilityId: 'pid-golpe-con-escudo',
      reference: 'golpe-con-escudo',
      name: 'Golpe con escudo',
      powerCost: { mode: 'FIXED', amount: 2 },
      chargeTurns: 1,
      effects: [
        {
          kind: 'STAT_MODIFIER',
          target: 'SELF',
          statistic: 'ATTACK',
          operation: 'INCREASE',
          magnitude: { mode: 'FIXED', amount: 2 },
          hasActivationCondition: false,
        },
      ],
    })
  })

  it('resuelve todas las habilidades con UNA sola lookup, nunca una por habilidad', async () => {
    const { forCombat, catalog } = await escenario([
      hero(['pid-golpe-con-escudo', 'pid-mano-de-piedra']),
      GOLPE,
      MANO,
    ])

    await forCombat.execute('jugador-1')

    expect(catalog.abilityLookups).toBe(1)
  })

  it('un heroe sin habilidades declaradas responde [] y no consulta a Catalog por ellas', async () => {
    const { forCombat, catalog } = await escenario([hero([]), GOLPE])

    const resultado = await forCombat.execute('jugador-1')

    expect(resultado.abilities).toEqual([])
    expect(catalog.abilityLookups).toBe(0)
  })

  it('una referencia que Catalog no resuelve se omite: el heroe simplemente no la tiene', async () => {
    const { forCombat } = await escenario([hero(['pid-no-existe', 'pid-golpe-con-escudo']), GOLPE])

    const resultado = await forCombat.execute('jugador-1')

    expect(resultado.abilities.map((entry) => entry.abilityId)).toEqual(['pid-golpe-con-escudo'])
  })

  it('una habilidad mal formada se omite sin tumbar la respuesta ni afectar a las demas', async () => {
    const malCosto = ability('rota', 'Rota', envelope(abilityValues({ powerCost: 0 })))
    const { forCombat } = await escenario([
      hero(['pid-rota', 'pid-golpe-con-escudo']),
      malCosto,
      GOLPE,
    ])

    const resultado = await forCombat.execute('jugador-1')

    expect(resultado.abilities.map((entry) => entry.abilityId)).toEqual(['pid-golpe-con-escudo'])
  })

  it('un producto que NO es HABILIDAD no se acepta como habilidad aunque el heroe lo referencie', async () => {
    const arma = ability('espada', 'Espada', envelope({ kind: 'ARMA', effects: [] }), 'ARMA')
    const { forCombat } = await escenario([
      hero(['pid-espada', 'pid-golpe-con-escudo']),
      arma,
      GOLPE,
    ])

    const resultado = await forCombat.execute('jugador-1')

    expect(resultado.abilities.map((entry) => entry.abilityId)).toEqual(['pid-golpe-con-escudo'])
  })

  it('una referencia repetida en el heroe no duplica la habilidad', async () => {
    const { forCombat } = await escenario([
      hero(['pid-golpe-con-escudo', 'pid-golpe-con-escudo']),
      GOLPE,
    ])

    expect((await forCombat.execute('jugador-1')).abilities).toHaveLength(1)
  })

  it('si Catalog cae al resolver las habilidades, propaga el fallo en vez de inventarlas', async () => {
    const { forCombat, catalog } = await escenario([hero(['pid-golpe-con-escudo']), GOLPE])

    catalog.failOnAbilities = true

    await expect(forCombat.execute('jugador-1')).rejects.toBeInstanceOf(CatalogUnavailableError)
  })

  it('la lista blanca: sin raw, sin la condicion de activacion y sin el codigo de inmunidad', async () => {
    const inmune = ability(
      'defensa-feroz',
      'Defensa feroz',
      envelope(
        abilityValues({
          powerCostMode: 'ALL_AVAILABLE',
          powerCost: undefined,
          effects: [
            {
              kind: 'IMMUNITY',
              target: 'SELF',
              immunityCode: 'DANIO_FISICO',
              activationCondition: { kind: 'PREVIOUS_TURN_DAMAGE_RECEIVED' },
            },
          ],
        }),
      ),
    )
    const { forCombat } = await escenario([hero(['pid-defensa-feroz']), inmune])

    const resultado = await forCombat.execute('jugador-1')

    expect(resultado.abilities[0]?.effects).toEqual([
      { kind: 'IMMUNITY', target: 'SELF', hasActivationCondition: true },
    ])
    expect(JSON.stringify(resultado.abilities)).not.toMatch(
      /raw|immunityCode|DANIO_FISICO|PREVIOUS/,
    )
  })

  it('no altera el resto del contrato: activeEffects, estadisticas y readiness siguen igual', async () => {
    const { forCombat } = await escenario([hero(['pid-golpe-con-escudo']), GOLPE])

    const resultado = await forCombat.execute('jugador-1')

    expect(resultado).toMatchObject({
      playerId: 'jugador-1',
      heroId: 'pid-guerrero-tanque',
      subtype: 'GUERRERO_TANQUE',
      effectiveStats: { power: 10, health: 44, defense: 11 },
      activeEffects: [],
      ready: true,
      loadoutVersion: 0,
    })
  })
})
