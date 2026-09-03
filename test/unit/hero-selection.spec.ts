import { HeroSelection } from '../../src/domain/entities/HeroSelection'
import { DomainError } from '../../src/domain/errors/DomainError'
import { assessHeroReadiness } from '../../src/domain/policies/HeroReadinessPolicy'
import {
  HeroSelectionMappingError,
  toDocument,
  toSnapshot,
} from '../../src/adapters/outbound/persistence/hero-selection-mapping'
import { InMemoryHeroSelectionRepository } from '../../src/adapters/outbound/persistence/InMemoryHeroSelectionRepository'
import { HeroSelectionConflictError } from '../../src/application/errors/ApplicationError'
import { PlayerId } from '../../src/domain/value-objects/identifiers'

const AT = new Date('2026-09-03T10:00:00.000Z')
const LATER = new Date('2026-09-03T11:00:00.000Z')

describe('HU-07 — seleccion de heroe (agregado)', () => {
  it('nace en version 0 y recuerda a quien pertenece', () => {
    const selection = HeroSelection.create('jugador-1', 'heroe-a', AT)

    expect(selection.ownerId).toBe('jugador-1')
    expect(selection.heroId).toBe('heroe-a')
    expect(selection.version).toBe(0)
    expect(selection.isFor('heroe-a')).toBe(true)
    expect(selection.isFor('heroe-b')).toBe(false)
  })

  /**
   * La invariante que justifica el diseno: elegir otro heroe SUSTITUYE la
   * seleccion. Si `selectAnother` creara un agregado nuevo con su propia
   * identidad, un jugador podria acabar con dos heroes preparados y nadie
   * sabria cual es el suyo.
   */
  it('elegir otro heroe sustituye la seleccion y conserva la version', () => {
    const primera = HeroSelection.create('jugador-1', 'heroe-a', AT)
    const segunda = primera.selectAnother('heroe-b', LATER)

    expect(segunda.ownerId).toBe('jugador-1')
    expect(segunda.heroId).toBe('heroe-b')
    expect(segunda.selectedAt).toEqual(LATER)
    // La version que se incrementa es la ALMACENADA, y eso lo decide el
    // repositorio al guardar con `expectedVersion`.
    expect(segunda.version).toBe(primera.version)
  })

  it('rechaza una seleccion sin jugador, sin heroe o con version invalida', () => {
    expect(() => HeroSelection.create('   ', 'heroe-a', AT)).toThrow(DomainError)
    expect(() => HeroSelection.create('jugador-1', '  ', AT)).toThrow(DomainError)
    expect(() =>
      HeroSelection.restore({ ownerId: 'j', heroId: 'h', selectedAt: AT, version: -1 }),
    ).toThrow(DomainError)
    expect(() =>
      HeroSelection.restore({
        ownerId: 'j',
        heroId: 'h',
        selectedAt: new Date('no-es-fecha'),
        version: 0,
      }),
    ).toThrow(DomainError)
  })
})

describe('HU-07 — disponibilidad del heroe preparado (CA-10)', () => {
  const base = {
    heroReference: 'guerrero-tanque',
    heroName: 'Guerrero Tanque',
    heroLifecycleStatus: 'ACTIVE',
    equipped: [],
    ownedReferences: new Set<string>(),
  }

  /**
   * La HU dice "hasta dos armas", "hasta seis piezas", "hasta dos items": son
   * techos, no minimos. Exigir el equipamiento completo inventaria una regla
   * que nadie escribio.
   */
  it('un heroe activo SIN equipamiento esta listo', () => {
    expect(assessHeroReadiness(base)).toEqual({ ready: true, blockers: [] })
  })

  it('un heroe suspendido no esta listo, y lo dice', () => {
    const resultado = assessHeroReadiness({ ...base, heroLifecycleStatus: 'SUSPENDED' })

    expect(resultado.ready).toBe(false)
    expect(resultado.blockers).toHaveLength(1)
    expect(resultado.blockers[0]?.code).toBe('HERO_NOT_ACTIVE')
    expect(resultado.blockers[0]?.slot).toBeNull()
  })

  /** CA-06: solo pueden utilizarse productos del inventario del jugador. */
  it('una pieza que ya no esta en el inventario impide jugar', () => {
    const resultado = assessHeroReadiness({
      ...base,
      equipped: [
        { slot: 'WEAPON_1', itemId: 'espada-vendida', name: 'Espada', lifecycleStatus: 'ACTIVE' },
      ],
      ownedReferences: new Set<string>(),
    })

    expect(resultado.ready).toBe(false)
    expect(resultado.blockers[0]).toMatchObject({
      code: 'EQUIPPED_PRODUCT_NOT_OWNED',
      slot: 'WEAPON_1',
      reference: 'espada-vendida',
    })
  })

  it('una pieza suspendida en el catalogo impide jugar', () => {
    const resultado = assessHeroReadiness({
      ...base,
      equipped: [{ slot: 'CHEST', itemId: 'peto', name: 'Peto', lifecycleStatus: 'SUSPENDED' }],
      ownedReferences: new Set(['peto']),
    })

    expect(resultado.ready).toBe(false)
    expect(resultado.blockers[0]?.code).toBe('EQUIPPED_PRODUCT_NOT_ACTIVE')
  })

  /**
   * CONTROL: una pieza que Catalog no devolvio llega con `UNKNOWN`. No se
   * supone activa. Suponerlo diria que el heroe esta listo apoyandose en un
   * producto del que no se sabe nada.
   */
  it('una pieza cuyo estado se desconoce NO se supone activa', () => {
    const resultado = assessHeroReadiness({
      ...base,
      equipped: [{ slot: 'ITEM_1', itemId: 'pocion', name: 'pocion', lifecycleStatus: 'UNKNOWN' }],
      ownedReferences: new Set(['pocion']),
    })

    expect(resultado.ready).toBe(false)
    expect(resultado.blockers[0]?.code).toBe('EQUIPPED_PRODUCT_NOT_ACTIVE')
  })

  /** Un solo mensaje por problema: no se acumulan dos sobre la misma pieza. */
  it('una pieza ni poseida ni activa produce UN impedimento, no dos', () => {
    const resultado = assessHeroReadiness({
      ...base,
      equipped: [
        { slot: 'ITEM_1', itemId: 'pocion', name: 'pocion', lifecycleStatus: 'SUSPENDED' },
      ],
      ownedReferences: new Set<string>(),
    })

    expect(resultado.blockers).toHaveLength(1)
    expect(resultado.blockers[0]?.code).toBe('EQUIPPED_PRODUCT_NOT_OWNED')
  })
})

describe('HU-07 — traduccion del documento', () => {
  it('ida y vuelta conserva la seleccion', () => {
    const snapshot = { ownerId: 'jugador-1', heroId: 'heroe-a', selectedAt: AT, version: 3 }

    expect(toSnapshot(toDocument(snapshot))).toEqual(snapshot)
  })

  it('el jugador es el _id del documento', () => {
    expect(toDocument({ ownerId: 'j-1', heroId: 'h', selectedAt: AT, version: 0 })._id).toBe('j-1')
  })

  it('rechaza una version que no es un entero no negativo', () => {
    expect(() => toSnapshot({ _id: 'j', heroId: 'h', selectedAt: AT, version: -2 })).toThrow(
      HeroSelectionMappingError,
    )
  })

  it('rechaza una fecha invalida en el documento', () => {
    expect(() =>
      toSnapshot({ _id: 'j', heroId: 'h', selectedAt: new Date('x'), version: 0 }),
    ).toThrow(HeroSelectionMappingError)
  })
})

describe('HU-07 — repositorio en memoria', () => {
  const owner = PlayerId.create('jugador-1')

  it('sin seleccion devuelve null', async () => {
    const repositorio = new InMemoryHeroSelectionRepository()

    await expect(repositorio.findByOwner(owner)).resolves.toBeNull()
  })

  it('guarda, incrementa la version y la recupera', async () => {
    const repositorio = new InMemoryHeroSelectionRepository()
    const guardada = await repositorio.save(HeroSelection.create(owner.value, 'heroe-a', AT), 0)

    expect(guardada.version).toBe(1)
    await expect(repositorio.findByOwner(owner)).resolves.toMatchObject({
      heroId: 'heroe-a',
      version: 1,
    })
  })

  /**
   * CONTROL del bloqueo optimista: dos peticiones simultaneas con la misma
   * version esperada no pueden dejar dos heroes preparados. La segunda choca.
   */
  it('una segunda escritura con la version antigua recibe conflicto', async () => {
    const repositorio = new InMemoryHeroSelectionRepository()
    await repositorio.save(HeroSelection.create(owner.value, 'heroe-a', AT), 0)

    await expect(
      repositorio.save(HeroSelection.create(owner.value, 'heroe-b', LATER), 0),
    ).rejects.toBeInstanceOf(HeroSelectionConflictError)

    await expect(repositorio.findByOwner(owner)).resolves.toMatchObject({ heroId: 'heroe-a' })
  })
})
