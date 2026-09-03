import { HeroLoadout } from '../../src/domain/entities/HeroLoadout'
import { DomainError } from '../../src/domain/errors/DomainError'
import {
  ALL_EQUIPMENT_SLOTS,
  EQUIPMENT_CAPACITY,
  categoryOfSlot,
  equipmentCategoryOfProductType,
  parseEquipmentSlot,
  slotsOfCategory,
} from '../../src/domain/value-objects/equipment'

const AT = new Date('2026-09-03T00:00:00.000Z')

const empty = (): HeroLoadout => HeroLoadout.createEmpty('jugador-1', 'heroe-1')

const equip = (
  loadout: HeroLoadout,
  slot: Parameters<HeroLoadout['equip']>[0]['slot'],
  itemId: string,
  category: Parameters<HeroLoadout['equip']>[0]['category'],
): void => {
  loadout.equip({ slot, itemId, productId: `pid-${itemId}`, category, occurredAt: AT })
}

describe('value objects de equipamiento (RF-28)', () => {
  it('define exactamente diez ranuras: 2 armas + 6 armaduras + 2 items', () => {
    expect(ALL_EQUIPMENT_SLOTS).toHaveLength(10)
    expect(slotsOfCategory('WEAPON')).toEqual(['WEAPON_1', 'WEAPON_2'])
    expect(slotsOfCategory('ITEM')).toEqual(['ITEM_1', 'ITEM_2'])
    expect(slotsOfCategory('ARMOR')).toEqual([
      'HELMET',
      'CHEST',
      'GLOVES',
      'BRACERS',
      'PANTS',
      'SHOES',
    ])
  })

  it('fija las capacidades 2/6/2 y no las parametriza', () => {
    expect(EQUIPMENT_CAPACITY).toEqual({ WEAPON: 2, ARMOR: 6, ITEM: 2 })
  })

  it('mapea el tipo canonico de Catalog a la familia equipable', () => {
    expect(equipmentCategoryOfProductType('ARMA')).toBe('WEAPON')
    expect(equipmentCategoryOfProductType('ARMADURA')).toBe('ARMOR')
    expect(equipmentCategoryOfProductType('ITEM')).toBe('ITEM')
    expect(equipmentCategoryOfProductType('HEROE')).toBeNull()
    expect(equipmentCategoryOfProductType('HABILIDAD')).toBeNull()
    expect(equipmentCategoryOfProductType('EPICA')).toBeNull()
  })

  it('normaliza y valida una ranura recibida de la interfaz', () => {
    expect(parseEquipmentSlot('weapon_1')).toBe('WEAPON_1')
    expect(parseEquipmentSlot('  HELMET ')).toBe('HELMET')
    expect(() => parseEquipmentSlot('BOTAS')).toThrow(DomainError)
  })

  it('asocia cada ranura a su familia', () => {
    expect(categoryOfSlot('WEAPON_2')).toBe('WEAPON')
    expect(categoryOfSlot('BRACERS')).toBe('ARMOR')
    expect(categoryOfSlot('ITEM_1')).toBe('ITEM')
  })
})

describe('HeroLoadout — invariantes 2/6/2 y sin reemplazo silencioso', () => {
  it('CA-01: equipa un arma, una armadura y un item y los conserva', () => {
    const loadout = empty()
    equip(loadout, 'WEAPON_1', 'espada', 'WEAPON')
    equip(loadout, 'HELMET', 'casco', 'ARMOR')
    equip(loadout, 'ITEM_1', 'pocion', 'ITEM')

    const entries = loadout.toSnapshot().entries
    expect(entries.map((e) => e.slot)).toEqual(['WEAPON_1', 'HELMET', 'ITEM_1'])
    expect(loadout.filledCount('WEAPON')).toBe(1)
    expect(loadout.filledCount('ARMOR')).toBe(1)
    expect(loadout.filledCount('ITEM')).toBe(1)
  })

  it('CA-02: 0 -> 1 -> 2 armas es valido; una tercera arma no cabe porque no hay ranura', () => {
    const loadout = empty()
    equip(loadout, 'WEAPON_1', 'espada', 'WEAPON')
    equip(loadout, 'WEAPON_2', 'hacha', 'WEAPON')

    expect(loadout.filledCount('WEAPON')).toBe(2)
    // No hay una tercera ranura de arma que pedir.
    expect(() => parseEquipmentSlot('WEAPON_3')).toThrow(DomainError)
  })

  it('CA-02: reintentar sobre una ranura de arma ocupada se rechaza y NO cambia el estado', () => {
    const loadout = empty()
    equip(loadout, 'WEAPON_1', 'espada', 'WEAPON')

    expect(() => {
      equip(loadout, 'WEAPON_1', 'hacha', 'WEAPON')
    }).toThrow(/ocupada/)
    expect(loadout.entry('WEAPON_1')?.itemId).toBe('espada')
    expect(loadout.filledCount('WEAPON')).toBe(1)
  })

  it('CA-03: seis piezas de armadura, una por ranura exacta; un segundo casco se rechaza', () => {
    const loadout = empty()
    for (const slot of slotsOfCategory('ARMOR')) {
      equip(loadout, slot, `pieza-${slot.toLowerCase()}`, 'ARMOR')
    }
    expect(loadout.filledCount('ARMOR')).toBe(6)

    const otro = empty()
    equip(otro, 'HELMET', 'casco-a', 'ARMOR')
    expect(() => {
      equip(otro, 'HELMET', 'casco-b', 'ARMOR')
    }).toThrow(/ocupada/)
  })

  it('CA-04: 0 -> 1 -> 2 items es valido; ITEM_1 ocupado no se reemplaza', () => {
    const loadout = empty()
    equip(loadout, 'ITEM_1', 'pocion', 'ITEM')
    equip(loadout, 'ITEM_2', 'amuleto', 'ITEM')
    expect(loadout.filledCount('ITEM')).toBe(2)

    expect(() => {
      equip(loadout, 'ITEM_1', 'elixir', 'ITEM')
    }).toThrow(/ocupada/)
  })

  it('CA-07: la familia del producto debe casar con la ranura', () => {
    const loadout = empty()
    expect(() => {
      equip(loadout, 'HELMET', 'espada', 'WEAPON')
    }).toThrow(/familia/)
    expect(() => {
      equip(loadout, 'WEAPON_1', 'casco', 'ARMOR')
    }).toThrow(/familia/)
    expect(loadout.isEmpty()).toBe(true)
  })

  it('rechaza montar el mismo objeto del inventario en dos ranuras', () => {
    const loadout = empty()
    equip(loadout, 'WEAPON_1', 'espada', 'WEAPON')
    expect(() => {
      equip(loadout, 'WEAPON_2', 'espada', 'WEAPON')
    }).toThrow(/ya esta equipado/)
  })

  it('emite un evento hero.item.equipped por cada pieza equipada', () => {
    const loadout = empty()
    equip(loadout, 'WEAPON_1', 'espada', 'WEAPON')
    const events = loadout.pullEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      name: 'hero.item.equipped',
      heroId: 'heroe-1',
      slot: 'WEAPON_1',
      itemId: 'espada',
    })
    expect(loadout.pullEvents()).toHaveLength(0)
  })

  it('restore rechaza una version negativa, una ranura desconocida y objetos repetidos', () => {
    expect(() =>
      HeroLoadout.restore({ ownerId: 'j', heroId: 'h', version: -1, entries: [] }),
    ).toThrow(DomainError)

    expect(() =>
      HeroLoadout.restore({
        ownerId: 'j',
        heroId: 'h',
        version: 0,
        entries: [{ slot: 'ANILLO' as never, itemId: 'x', productId: 'p' }],
      }),
    ).toThrow(DomainError)

    expect(() =>
      HeroLoadout.restore({
        ownerId: 'j',
        heroId: 'h',
        version: 0,
        entries: [
          { slot: 'WEAPON_1', itemId: 'espada', productId: 'p1' },
          { slot: 'WEAPON_2', itemId: 'espada', productId: 'p2' },
        ],
      }),
    ).toThrow(/repite el objeto/)
  })

  it('toSnapshot devuelve las entradas en el orden canonico de ranuras', () => {
    const loadout = empty()
    equip(loadout, 'ITEM_1', 'pocion', 'ITEM')
    equip(loadout, 'WEAPON_1', 'espada', 'WEAPON')
    equip(loadout, 'CHEST', 'peto', 'ARMOR')

    expect(loadout.toSnapshot().entries.map((e) => e.slot)).toEqual(['WEAPON_1', 'CHEST', 'ITEM_1'])
  })
})
