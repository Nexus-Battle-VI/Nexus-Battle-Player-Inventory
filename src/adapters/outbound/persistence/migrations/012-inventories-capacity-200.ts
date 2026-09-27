import type { Db } from 'mongodb'

/**
 * Sube a 200 la capacidad de los inventarios que ya existen.
 *
 * `CapacityPolicy.DEFAULT_CAPACITY` paso de 30 a 200 en codigo, pero eso solo
 * afecta inventarios nuevos (`Inventory.createEmpty`): uno ya creado restaura
 * la capacidad que tiene GRABADA en su propio documento
 * (`Inventory.restore({ capacity: snapshot.capacity, ... })`), no la lee de
 * la constante. Sin esta migracion, cualquier jugador con inventario previo a
 * este cambio seguiria topando en 30 ranuras para siempre, aunque el codigo
 * ya permita hasta 200 -exactamente el sintoma reportado: la entrega de una
 * compra grande seguia rechazandose despues de desplegar el cambio-.
 *
 * Solo sube los que estan por DEBAJO de 200: un inventario con una capacidad
 * mayor a la del viejo default (asignada a mano, a proposito, para un caso
 * especial) no se toca ni se recorta.
 */
export const up = async (db: Db): Promise<void> => {
  await db
    .collection('inventories')
    .updateMany({ capacity: { $lt: 200 } }, { $set: { capacity: 200 } })
}
