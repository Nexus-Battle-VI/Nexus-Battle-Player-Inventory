import 'reflect-metadata'

import { Int32 } from 'mongodb'

import {
  PersistenceMappingError,
  toDocument,
  toSnapshot,
  type InventoryDocument,
} from '../../src/adapters/outbound/persistence/mapping'
import { CapacityPolicy } from '../../src/domain/policies/CapacityPolicy'
import { ItemId, Quantity } from '../../src/domain/value-objects/identifiers'
import { up } from '../../src/adapters/outbound/persistence/migrations/001-inventories'
import { describeError } from '../../src/infrastructure/observability/describe-error'
import type { InventorySnapshot } from '../../src/domain/entities/Inventory'

const DOCUMENT: InventoryDocument = {
  _id: 'jugador-1',
  capacity: new Int32(30),
  slots: [
    { itemId: 'pocion-de-vida', quantity: new Int32(5) },
    { itemId: 'espada-corta', quantity: new Int32(1) },
  ],
}

const SNAPSHOT: InventorySnapshot = {
  ownerId: 'jugador-1',
  capacity: 30,
  slots: [
    { itemId: 'espada-corta', quantity: 1 },
    { itemId: 'pocion-de-vida', quantity: 5 },
  ],
}

describe('Traduccion entre documento e instantanea', () => {
  /**
   * Las ranuras se ordenan por objeto, igual que hace `toSnapshot` del agregado.
   * Sin ordenar, dos lecturas del mismo inventario podrian devolverlas en
   * distinto orden y una comparacion de instantaneas fallaria sin que nada
   * hubiera cambiado.
   */
  it('reconstruye la instantanea con las ranuras ordenadas', () => {
    expect(toSnapshot(DOCUMENT)).toEqual(SNAPSHOT)
  })

  it('la traduccion es reversible', () => {
    expect(toSnapshot(toDocument(SNAPSHOT))).toEqual(SNAPSHOT)
  })

  it('usa el identificador del propietario como clave del documento', () => {
    expect(toDocument(SNAPSHOT)._id).toBe(SNAPSHOT.ownerId)
  })

  it('admite un inventario vacio', () => {
    expect(toSnapshot({ ...DOCUMENT, slots: [] }).slots).toEqual([])
  })
})

/**
 * Un recuento no es un numero con decimales. El driver guardaria un numero de
 * JavaScript como `double` de BSON, asi que se escribe `Int32` explicitamente.
 *
 * A diferencia del dinero en Commerce y Catalog, aqui NO hace falta comprobar la
 * exactitud al leer: un `int32` siempre cabe en el numero de JavaScript. Lo que
 * si se comprueba es que sea entero, porque un `double` guardado por descuido
 * llegaria como fraccionario.
 */
describe('Recuentos', () => {
  it('escribe la capacidad y las cantidades como enteros de 32 bits', () => {
    const document = toDocument(SNAPSHOT)

    expect(document.capacity).toBeInstanceOf(Int32)
    expect(document.slots[0]?.quantity).toBeInstanceOf(Int32)
  })

  it('admite tambien un numero al leer, si asi llega', () => {
    expect(toSnapshot({ _id: 'jugador-2', capacity: 10, slots: [] }).capacity).toBe(10)
  })

  it.each([
    ['la capacidad', { _id: 'j', capacity: 1.5, slots: [] }],
    [
      'una cantidad',
      { _id: 'j', capacity: 10, slots: [{ itemId: 'pocion-de-vida', quantity: 2.5 }] },
    ],
  ])('rechaza que %s no sea entera', (_caso, document) => {
    expect(() => toSnapshot(document)).toThrow(PersistenceMappingError)
  })

  it.each([
    ['cero', 0],
    ['negativa', -1],
    ['por encima del maximo', Quantity.MAX + 1],
  ])('rechaza escribir una cantidad %s', (_caso, quantity) => {
    const snapshot = { ...SNAPSHOT, slots: [{ itemId: 'espada-corta', quantity }] }

    expect(() => toDocument(snapshot)).toThrow(PersistenceMappingError)
  })
})

/**
 * Estas dos invariantes NO se pueden expresar en `$jsonSchema`, y por eso las
 * comprueba la traduccion. Decirlo importa: un validador que aparenta cubrirlas
 * seria peor que no tenerlo.
 */
describe('Lo que el validador del motor no puede expresar', () => {
  it('rechaza un inventario que repite el mismo objeto en dos ranuras', () => {
    const document: InventoryDocument = {
      _id: 'jugador-3',
      capacity: new Int32(10),
      slots: [
        { itemId: 'pocion-de-vida', quantity: new Int32(1) },
        { itemId: 'pocion-de-vida', quantity: new Int32(2) },
      ],
    }

    expect(() => toSnapshot(document)).toThrow(/repite el objeto/)
  })

  it('rechaza un inventario con mas ranuras que capacidad', () => {
    const document: InventoryDocument = {
      _id: 'jugador-4',
      capacity: new Int32(1),
      slots: [
        { itemId: 'pocion-de-vida', quantity: new Int32(1) },
        { itemId: 'espada-corta', quantity: new Int32(1) },
      ],
    }

    expect(() => toSnapshot(document)).toThrow(/ranuras y una capacidad/)
  })

  it.each([
    ['cero', 0],
    ['negativa', -1],
    ['por encima del maximo', CapacityPolicy.MAX_CAPACITY + 1],
  ])('rechaza una capacidad %s', (_caso, capacity) => {
    expect(() => toSnapshot({ _id: 'j', capacity, slots: [] })).toThrow(PersistenceMappingError)
  })
})

/**
 * Una migracion NO puede importar el dominio: queda congelada en el tiempo y
 * tiene que seguir siendo ejecutable tal y como se escribio. Eso obliga a
 * repetir los limites en el validador, y estas pruebas evitan que esa
 * duplicacion se convierta en divergencia.
 */
describe('El dominio y la migracion no divergen', () => {
  const fuenteDeLaMigracion = up.toString()

  it('los limites de capacidad coinciden con los del dominio', () => {
    expect(fuenteDeLaMigracion).toContain(`maximum: ${String(CapacityPolicy.MAX_CAPACITY)}`)
    expect(fuenteDeLaMigracion).toContain(`maxItems: ${String(CapacityPolicy.MAX_CAPACITY)}`)
  })

  it('el limite de cantidad coincide con el del dominio', () => {
    expect(fuenteDeLaMigracion).toContain(`maximum: ${String(Quantity.MAX)}`)
  })

  /**
   * Se compara por COMPORTAMIENTO y no por cadenas: lo que importa es que motor
   * y dominio acepten y rechacen exactamente lo mismo, no que el texto del
   * patron coincida.
   */
  it('el patron del objeto acepta y rechaza lo mismo que el dominio', () => {
    const enLaMigracion = /pattern: '([^']+)'/.exec(fuenteDeLaMigracion)?.[1]

    expect(enLaMigracion).toBeDefined()

    const patron = new RegExp(enLaMigracion!)
    const ejemplos = [
      'pocion-de-vida',
      'espada',
      'a1',
      'MAYUSCULAS',
      'con espacio',
      '-guion',
      'guion-',
      '',
    ]

    for (const ejemplo of ejemplos) {
      const loAdmiteElDominio = ((): boolean => {
        try {
          ItemId.create(ejemplo)

          return true
        } catch {
          return false
        }
      })()

      expect({ ejemplo, motor: patron.test(ejemplo.trim().toLowerCase()) }).toEqual({
        ejemplo,
        motor: loAdmiteElDominio,
      })
    }
  })
})

/**
 * Muchas bibliotecas rechazan con `unknown`. Pasar eso por `String()` a secas
 * convierte cualquier objeto en `[object Object]` justo cuando mas falta hace
 * saber que ocurrio.
 */
describe('describeError', () => {
  it('usa el mensaje cuando es un Error', () => {
    expect(describeError(new Error('algo fallo'))).toBe('algo fallo')
  })

  it('serializa un objeto en lugar de producir [object Object]', () => {
    expect(describeError({ code: '121', detail: 'validacion' })).toBe(
      '{"code":"121","detail":"validacion"}',
    )
  })

  it.each([
    [undefined, 'undefined'],
    [null, 'null'],
  ])('describe %s sin romperse', (valor, esperado) => {
    expect(describeError(valor)).toBe(esperado)
  })

  it('no se rompe con una estructura circular', () => {
    const circular: Record<string, unknown> = {}
    circular.yo = circular

    expect(describeError(circular)).toBe('error no serializable')
  })
})
