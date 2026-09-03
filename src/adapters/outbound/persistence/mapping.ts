import { Int32 } from 'mongodb'

import { CapacityPolicy } from '../../../domain/policies/CapacityPolicy'
import { Quantity } from '../../../domain/value-objects/identifiers'
import type { InventorySnapshot } from '../../../domain/entities/Inventory'

/**
 * Traduccion entre documentos de MongoDB y la instantanea del agregado.
 *
 * Vive aparte del repositorio y es **puro** a proposito: es la parte del
 * adaptador donde de verdad se puede equivocar uno, y sacarla del repositorio
 * permite probarla sin base de datos ni contenedor.
 */

export class PersistenceMappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PersistenceMappingError'
  }
}

export interface SlotDocument {
  readonly itemId: string
  readonly quantity: Int32 | number
}

/**
 * Documento tal y como se guarda.
 *
 * `_id` es el identificador del propietario y no un identificador generado. Un
 * jugador tiene exactamente un inventario, asi que usarlo como clave hace que
 * MongoDB garantice esa unicidad sin un indice adicional: un segundo inventario
 * del mismo jugador no se puede ni escribir.
 *
 * Las ranuras van **embebidas** y no en otra coleccion. No tienen sentido fuera
 * de su inventario, estan acotadas por la capacidad y se leen y escriben
 * siempre con el, que es exactamente para lo que sirve un documento. Separarlas
 * obligaria a dos consultas y a una transaccion para algo que aqui es una sola
 * escritura atomica.
 */
export interface InventoryDocument {
  readonly _id: string
  readonly revision?: Int32 | number
  readonly capacity: Int32 | number
  readonly slots: readonly SlotDocument[]
}

/**
 * Convierte un entero de 32 bits a numero de JavaScript.
 *
 * A diferencia del importe de Commerce y Catalog, aqui NO hace falta comprobar
 * la exactitud: un `int32` siempre cabe en el numero de JavaScript. Lo que si se
 * comprueba es que sea un entero, porque un `double` guardado por descuido
 * llegaria como numero fraccionario y el dominio lo rechazaria despues, con un
 * mensaje que no senala donde esta el problema.
 */
const toInteger = (raw: Int32 | number, contexto: string): number => {
  const value = typeof raw === 'number' ? raw : raw.valueOf()

  if (!Number.isInteger(value)) {
    throw new PersistenceMappingError(`${contexto} no es un entero: ${String(value)}.`)
  }

  return value
}

/**
 * Construye la instantanea a partir del documento.
 *
 * Valida lo que lee en lugar de confiar en el documento. En MongoDB esto pesa
 * mas que en un motor relacional: una coleccion admite documentos de cualquier
 * forma salvo que se declare un validador, y aun con validador uno escrito antes
 * de declararlo sigue ahi.
 */
export const toSnapshot = (document: InventoryDocument): InventorySnapshot => {
  const capacity = toInteger(document.capacity, `La capacidad del inventario ${document._id}`)

  if (capacity < 1 || capacity > CapacityPolicy.MAX_CAPACITY) {
    throw new PersistenceMappingError(
      `El inventario ${document._id} tiene una capacidad fuera de rango: ${String(capacity)}.`,
    )
  }

  const vistos = new Set<string>()

  for (const slot of document.slots) {
    if (vistos.has(slot.itemId)) {
      // El agregado guarda las ranuras en un mapa, asi que no puede producir
      // esto. Un documento si: `$jsonSchema` no sabe expresar "sin repetidos
      // por una propiedad", de modo que esta es la unica linea que lo detecta.
      throw new PersistenceMappingError(
        `El inventario ${document._id} repite el objeto "${slot.itemId}".`,
      )
    }

    vistos.add(slot.itemId)
  }

  if (document.slots.length > capacity) {
    // Tampoco es expresable en el validador: seria comparar dos campos entre si.
    throw new PersistenceMappingError(
      `El inventario ${document._id} tiene ${String(document.slots.length)} ranuras y una capacidad de ${String(capacity)}.`,
    )
  }

  return {
    ownerId: document._id,
    capacity,
    slots: [...document.slots]
      .sort((a, b) => a.itemId.localeCompare(b.itemId))
      .map((slot) => ({
        itemId: slot.itemId,
        quantity: toInteger(
          slot.quantity,
          `La cantidad de "${slot.itemId}" en el inventario ${document._id}`,
        ),
      })),
  }
}

/**
 * Descompone la instantanea en el documento que se guarda.
 *
 * La cantidad y la capacidad se escriben como `Int32` y no como numero de
 * JavaScript: el driver guardaria un numero como `double` de BSON, y un doble no
 * es el tipo de un recuento. Es el mismo criterio que Commerce y Catalog aplican
 * al dinero, con el tipo que corresponde a este rango.
 */
export const toDocument = (snapshot: InventorySnapshot): InventoryDocument => {
  for (const slot of snapshot.slots) {
    if (!Number.isInteger(slot.quantity) || slot.quantity < 1 || slot.quantity > Quantity.MAX) {
      throw new PersistenceMappingError(
        `El inventario ${snapshot.ownerId} tiene una cantidad fuera de rango para "${slot.itemId}": ${String(slot.quantity)}.`,
      )
    }
  }

  return {
    _id: snapshot.ownerId,
    capacity: new Int32(snapshot.capacity),
    slots: snapshot.slots.map((slot) => ({
      itemId: slot.itemId,
      quantity: new Int32(slot.quantity),
    })),
  }
}
