import { Inventory } from '../../src/domain/entities/Inventory'
import { CapacityPolicy } from '../../src/domain/policies/CapacityPolicy'
import { ItemId, PlayerId, Quantity } from '../../src/domain/value-objects/identifiers'
import { DomainError } from '../../src/domain/errors/DomainError'

const AT = new Date('2026-08-21T10:00:00.000Z')

const owner = (): PlayerId => PlayerId.create('player-42')
const item = (id: string): ItemId => ItemId.create(id)
const qty = (n: number): Quantity => Quantity.create(n)

const emptyInventory = (capacity = 30): Inventory =>
  Inventory.createEmpty(owner(), CapacityPolicy.of(capacity))

describe('PlayerId', () => {
  it('normaliza espacios y compara por valor', () => {
    expect(PlayerId.create('  player-42 ').value).toBe('player-42')
    expect(PlayerId.create('player-42').equals(PlayerId.create('player-42'))).toBe(true)
    expect(PlayerId.create('player-42').equals(PlayerId.create('player-9'))).toBe(false)
    expect(String(PlayerId.create('player-42'))).toBe('player-42')
  })

  it('rechaza un identificador vacio', () => {
    expect(() => PlayerId.create('   ')).toThrow(DomainError)
  })
})

describe('ItemId', () => {
  it('normaliza a kebab-case en minusculas', () => {
    expect(ItemId.create('  Espada-De-Hierro ').value).toBe('espada-de-hierro')
    expect(String(item('pocion'))).toBe('pocion')
    expect(item('pocion').equals(item('pocion'))).toBe(true)
    expect(item('pocion').equals(item('escudo'))).toBe(false)
  })

  it.each([['snake_case'], ['-inicia'], ['termina-'], [''], ['1-numero']])(
    'rechaza "%s"',
    (raw) => {
      expect(() => ItemId.create(raw)).toThrow(DomainError)
    },
  )
})

describe('Quantity', () => {
  it('suma y compara cantidades', () => {
    expect(qty(3).plus(qty(4)).value).toBe(7)
    expect(qty(3).equals(qty(3))).toBe(true)
    expect(qty(3).equals(qty(4))).toBe(false)
  })

  it('resta y devuelve null cuando se agota', () => {
    expect(qty(5).minus(qty(2))?.value).toBe(3)
    expect(qty(5).minus(qty(5))).toBeNull()
  })

  it('rechaza restar mas de lo disponible', () => {
    expect(() => qty(2).minus(qty(3))).toThrow(/No se pueden retirar/)
  })

  it.each([[0], [-1], [1.5], [10_000]])('rechaza la cantidad %s', (raw) => {
    expect(() => Quantity.create(raw)).toThrow(DomainError)
  })

  it('rechaza una suma que supera el maximo', () => {
    expect(() => qty(9_999).plus(qty(1))).toThrow(DomainError)
  })
})

describe('CapacityPolicy', () => {
  it('expone la capacidad por defecto', () => {
    expect(CapacityPolicy.default().capacity).toBe(CapacityPolicy.DEFAULT_CAPACITY)
  })

  it('admite una capacidad explicita dentro del rango', () => {
    expect(CapacityPolicy.of(5).capacity).toBe(5)
  })

  it.each([[0], [-3], [2.5], [CapacityPolicy.MAX_CAPACITY + 1]])(
    'rechaza la capacidad %s',
    (raw) => {
      expect(() => CapacityPolicy.of(raw)).toThrow(DomainError)
    },
  )
})

describe('Inventory', () => {
  it('nace vacio con la capacidad de la politica', () => {
    const inventory = emptyInventory(10)

    expect(inventory.usedSlots).toBe(0)
    expect(inventory.freeSlots).toBe(10)
    expect(inventory.maxSlots).toBe(10)
    expect(inventory.totalUnits).toBe(0)
    expect(inventory.isFull).toBe(false)
  })

  it('ocupa una ranura al anadir un objeto nuevo', () => {
    const inventory = emptyInventory()

    inventory.add(item('espada'), qty(1), AT)

    expect(inventory.usedSlots).toBe(1)
    expect(inventory.quantityOf(item('espada'))).toBe(1)
    expect(inventory.contains(item('espada'))).toBe(true)
    expect(inventory.contains(item('escudo'))).toBe(false)
  })

  it('apila sobre la ranura existente sin consumir capacidad', () => {
    const inventory = emptyInventory(2)

    inventory.add(item('pocion'), qty(3), AT)
    inventory.add(item('pocion'), qty(4), AT)

    expect(inventory.usedSlots).toBe(1)
    expect(inventory.freeSlots).toBe(1)
    expect(inventory.quantityOf(item('pocion'))).toBe(7)
    expect(inventory.totalUnits).toBe(7)
  })

  it('permite apilar aunque el inventario este completo', () => {
    const inventory = emptyInventory(1)
    inventory.add(item('pocion'), qty(1), AT)

    expect(inventory.isFull).toBe(true)

    // Apilar sobre una ranura existente no requiere capacidad libre.
    inventory.add(item('pocion'), qty(5), AT)

    expect(inventory.quantityOf(item('pocion'))).toBe(6)
  })

  it('rechaza un objeto nuevo cuando no queda capacidad', () => {
    const inventory = emptyInventory(1)
    inventory.add(item('pocion'), qty(1), AT)

    expect(() => {
      inventory.add(item('espada'), qty(1), AT)
    }).toThrow(/esta completo/)
  })

  it('emite un evento por cada alta con la cantidad resultante', () => {
    const inventory = emptyInventory()

    inventory.add(item('pocion'), qty(2), AT)
    inventory.add(item('pocion'), qty(3), AT)

    const events = inventory.pullEvents()

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      name: 'inventory.item.added',
      itemId: 'pocion',
      quantity: 2,
      resultingQuantity: 2,
    })
    expect(events[1]).toMatchObject({ quantity: 3, resultingQuantity: 5 })
    expect(inventory.pullEvents()).toHaveLength(0)
  })

  it('retira unidades y conserva la ranura si queda saldo', () => {
    const inventory = emptyInventory()
    inventory.add(item('pocion'), qty(5), AT)
    inventory.pullEvents()

    inventory.remove(item('pocion'), qty(2), AT)

    expect(inventory.quantityOf(item('pocion'))).toBe(3)
    expect(inventory.usedSlots).toBe(1)
    expect(inventory.pullEvents()[0]).toMatchObject({
      name: 'inventory.item.removed',
      resultingQuantity: 3,
    })
  })

  it('libera la ranura al agotar el objeto', () => {
    const inventory = emptyInventory()
    inventory.add(item('pocion'), qty(2), AT)

    inventory.remove(item('pocion'), qty(2), AT)

    expect(inventory.usedSlots).toBe(0)
    expect(inventory.freeSlots).toBe(30)
    expect(inventory.contains(item('pocion'))).toBe(false)
    expect(inventory.quantityOf(item('pocion'))).toBe(0)
  })

  it('rechaza retirar un objeto ausente', () => {
    const inventory = emptyInventory()

    expect(() => {
      inventory.remove(item('espada'), qty(1), AT)
    }).toThrow(/no contiene el objeto/)
  })

  it('rechaza retirar mas unidades de las disponibles', () => {
    const inventory = emptyInventory()
    inventory.add(item('pocion'), qty(2), AT)

    expect(() => {
      inventory.remove(item('pocion'), qty(5), AT)
    }).toThrow(DomainError)
  })

  it('produce una instantanea ordenada de forma estable', () => {
    const inventory = emptyInventory(5)
    inventory.add(item('pocion'), qty(2), AT)
    inventory.add(item('espada'), qty(1), AT)
    inventory.add(item('arco'), qty(3), AT)

    expect(inventory.toSnapshot()).toEqual({
      ownerId: 'player-42',
      capacity: 5,
      slots: [
        { itemId: 'arco', quantity: 3 },
        { itemId: 'espada', quantity: 1 },
        { itemId: 'pocion', quantity: 2 },
      ],
    })
  })

  it('reconstituye un inventario persistido sin emitir eventos', () => {
    const inventory = Inventory.restore({
      ownerId: owner(),
      capacity: 10,
      slots: [
        { itemId: 'pocion', quantity: 4 },
        { itemId: 'espada', quantity: 1 },
      ],
    })

    expect(inventory.pullEvents()).toHaveLength(0)
    expect(inventory.usedSlots).toBe(2)
    expect(inventory.totalUnits).toBe(5)
  })

  it.each([
    ['capacidad no entera', { capacity: 2.5, slots: [] }],
    ['capacidad menor que uno', { capacity: 0, slots: [] }],
    [
      'mas ranuras que capacidad',
      {
        capacity: 1,
        slots: [
          { itemId: 'a', quantity: 1 },
          { itemId: 'b', quantity: 1 },
        ],
      },
    ],
    [
      'objeto repetido',
      {
        capacity: 5,
        slots: [
          { itemId: 'a', quantity: 1 },
          { itemId: 'a', quantity: 2 },
        ],
      },
    ],
    ['cantidad invalida', { capacity: 5, slots: [{ itemId: 'a', quantity: 0 }] }],
  ])('rechaza reconstituir con %s', (_caso, params) => {
    expect(() => Inventory.restore({ ownerId: owner(), ...params })).toThrow(DomainError)
  })
})
