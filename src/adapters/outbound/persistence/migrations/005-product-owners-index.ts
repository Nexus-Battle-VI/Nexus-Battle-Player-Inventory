import type { Db } from 'mongodb'

/**
 * Indice para resolver propietarios de un producto (HU-38, TASK #175).
 *
 * `slots` es un array embebido, asi que un indice sobre `slots.itemId` es
 * automaticamente multikey: MongoDB crea una entrada por cada elemento del
 * array en lugar de una por documento. `findOwnersOfProduct` filtra
 * exactamente por ese campo (`{ 'slots.itemId': productId }`), asi que la
 * consulta queda cubierta por el indice sin escanear la coleccion completa.
 *
 * Cardinalidad esperada: cientos de miles de inventarios en el peor caso de la
 * demo, con como mucho 200 ranuras cada uno (limite de `CapacityPolicy`); el
 * indice mantiene la busqueda por producto proporcional al numero de
 * propietarios reales, no al total de inventarios.
 */
export const up = async (db: Db): Promise<void> => {
  await db
    .collection('inventories')
    .createIndex({ 'slots.itemId': 1 }, { name: 'owners_by_product' })
}

export const down = async (db: Db): Promise<void> => {
  await db.collection('inventories').dropIndex('owners_by_product')
}
