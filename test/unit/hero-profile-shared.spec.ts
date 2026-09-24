import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import {
  CatalogUnavailableError,
  type CatalogLookupQuery,
  type CatalogProductView,
  type CatalogReadPort,
} from '../../src/application/ports/CatalogReadPort'
import {
  resolveHeroAbilities,
  toEquippedHeroEffect,
} from '../../src/application/use-cases/hero-profile-shared'
import type { EquippedEffect } from '../../src/domain/value-objects/equipment-effects'

/**
 * Proyecciones compartidas por las dos lecturas internas de un heroe (HU-19 para
 * `equipped-hero` y HU-71 para `heroes/{heroId}`).
 *
 * Se prueban aqui, en su propio modulo, porque ahora son la UNICA
 * implementacion: si esta regla se rompe, se rompen las dos rutas a la vez.
 */
const envelope = (values: Record<string, unknown>): unknown => ({ schemaVersion: '1', values })

const heroProduct = (abilities: readonly string[]): CatalogProductView => ({
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
    basePower: 5,
    baseHealth: 40,
    baseDefense: 8,
    baseAttack: { mode: 'FIXED', amount: 10 },
    baseDamage: { mode: 'DICE', count: 1, sides: 4 },
    abilities: [...abilities],
  }),
})

const abilityProduct = (sku: string, attributes?: unknown): CatalogProductView => ({
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
  attributes:
    attributes ??
    envelope({
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

/** Espia del puerto para poder afirmar CUANTAS llamadas se hacen. */
class CountingCatalog implements CatalogReadPort {
  readonly lookups: CatalogLookupQuery[] = []

  constructor(private readonly inner: CatalogReadPort) {}

  getByReference(reference: string): Promise<CatalogProductView | null> {
    return this.inner.getByReference(reference)
  }

  lookup(query: CatalogLookupQuery): Promise<readonly CatalogProductView[]> {
    this.lookups.push(query)

    return this.inner.lookup(query)
  }
}

const catalogWith = (
  products: readonly CatalogProductView[],
  catalogDown = false,
): CountingCatalog => new CountingCatalog(new InMemoryCatalogReadClient([...products], catalogDown))

describe('resolveHeroAbilities (HU-19 / HU-71)', () => {
  it('resuelve todas las habilidades en UNA sola llamada `lookup`', async () => {
    const catalog = catalogWith([
      heroProduct(['hab-a', 'hab-b', 'hab-c']),
      abilityProduct('hab-a'),
      abilityProduct('hab-b'),
      abilityProduct('hab-c'),
    ])

    const abilities = await resolveHeroAbilities(catalog, 'pid-guerrero-tanque')

    expect(abilities).toHaveLength(3)
    expect(catalog.lookups).toHaveLength(1)
    expect(catalog.lookups[0]).toMatchObject({
      references: ['hab-a', 'hab-b', 'hab-c'],
      type: 'HABILIDAD',
    })
  })

  it('devuelve `abilityId` = productId y `reference` = sku', async () => {
    const catalog = catalogWith([heroProduct(['hab-a']), abilityProduct('hab-a')])

    const [ability] = await resolveHeroAbilities(catalog, 'pid-guerrero-tanque')

    expect(ability).toMatchObject({
      abilityId: 'pid-hab-a',
      reference: 'hab-a',
      powerCost: { mode: 'FIXED', amount: 2 },
      chargeTurns: 1,
    })
    expect(ability?.effects).toHaveLength(1)
  })

  it('respeta el orden en que el heroe declara sus habilidades', async () => {
    const catalog = catalogWith([
      heroProduct(['hab-z', 'hab-a']),
      abilityProduct('hab-a'),
      abilityProduct('hab-z'),
    ])

    const abilities = await resolveHeroAbilities(catalog, 'pid-guerrero-tanque')

    expect(abilities.map((item) => item.reference)).toEqual(['hab-z', 'hab-a'])
  })

  it('si Catalog no conoce al heroe devuelve vacio y NO llama a `lookup`', async () => {
    const catalog = catalogWith([])

    expect(await resolveHeroAbilities(catalog, 'pid-inventado')).toEqual([])
    expect(catalog.lookups).toEqual([])
  })

  it('un heroe sin habilidades declaradas devuelve vacio y NO llama a `lookup`', async () => {
    const catalog = catalogWith([heroProduct([])])

    expect(await resolveHeroAbilities(catalog, 'pid-guerrero-tanque')).toEqual([])
    expect(catalog.lookups).toEqual([])
  })

  it.each([
    ['no lo devuelve Catalog', [heroProduct(['hab-a'])]],
    [
      'sus atributos no cumplen el contrato canonico',
      [heroProduct(['hab-a']), abilityProduct('hab-a', envelope({ kind: 'ARMA' }))],
    ],
  ])('omite la habilidad si %s, sin inventarla', async (_label, products) => {
    const catalog = catalogWith(products)

    expect(await resolveHeroAbilities(catalog, 'pid-guerrero-tanque')).toEqual([])
  })

  it('si Catalog no responde, el error se propaga: sin sus datos no hay habilidades', async () => {
    const catalog = catalogWith([heroProduct(['hab-a'])], true)

    await expect(resolveHeroAbilities(catalog, 'pid-guerrero-tanque')).rejects.toBeInstanceOf(
      CatalogUnavailableError,
    )
  })

  it('un heroe sin atributos de heroe canonico devuelve vacio', async () => {
    const broken: CatalogProductView = {
      ...heroProduct([]),
      attributes: envelope({ kind: 'ARMA' }),
    }
    const catalog = catalogWith([broken])

    expect(await resolveHeroAbilities(catalog, 'pid-guerrero-tanque')).toEqual([])
  })
})

describe('toEquippedHeroEffect', () => {
  const minimal: EquippedEffect = {
    sourceSlot: 'WEAPON_1',
    sourceProductId: 'pid-espada',
    sourceProductReference: 'espada',
    kind: 'STAT_MODIFIER',
    target: 'SELF',
    hasActivationCondition: false,
    appliedToStats: true,
    raw: { secreto: 'de Catalog' },
  }

  it('lista BLANCA campo a campo: `raw` y `sourceSlot` NO cruzan la frontera', () => {
    const dto = toEquippedHeroEffect(minimal)

    expect(Object.keys(dto).sort()).toEqual([
      'appliedToStats',
      'hasActivationCondition',
      'kind',
      'sourceProductId',
      'sourceProductReference',
      'target',
    ])
  })

  it('los opcionales solo aparecen cuando existen', () => {
    expect(toEquippedHeroEffect(minimal)).not.toHaveProperty('statistic')
    expect(toEquippedHeroEffect(minimal)).not.toHaveProperty('durationTurns')

    const completo = toEquippedHeroEffect({
      ...minimal,
      statistic: 'ATTACK',
      operation: 'INCREASE',
      magnitude: { mode: 'FIXED', amount: 3 },
      durationTurns: 2,
    })

    expect(completo).toMatchObject({
      statistic: 'ATTACK',
      operation: 'INCREASE',
      magnitude: { mode: 'FIXED', amount: 3 },
      durationTurns: 2,
    })
  })
})
