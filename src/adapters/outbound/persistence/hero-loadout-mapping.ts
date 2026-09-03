import { Int32 } from 'mongodb'

import { ALL_EQUIPMENT_SLOTS, type EquipmentSlot } from '../../../domain/value-objects/equipment'
import type { HeroLoadoutSnapshot } from '../../../domain/entities/HeroLoadout'

/**
 * Traduccion entre el documento de MongoDB y la instantanea del loadout.
 *
 * Pura y aparte del repositorio, como `mapping.ts` del inventario: es donde se
 * puede uno equivocar de verdad, y sacarla permite probarla sin contenedor.
 */

export class HeroLoadoutMappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HeroLoadoutMappingError'
  }
}

export interface HeroLoadoutEntryDocument {
  readonly slot: string
  readonly itemId: string
  readonly productId: string
}

/**
 * `_id` compuesto por (jugador, heroe): un heroe de un jugador tiene exactamente
 * un loadout, y MongoDB garantiza esa unicidad sin indice adicional. `version`
 * habilita el bloqueo optimista.
 */
export interface HeroLoadoutDocument {
  readonly _id: string
  readonly ownerId: string
  readonly heroId: string
  readonly version: Int32 | number
  readonly entries: readonly HeroLoadoutEntryDocument[]
}

export const documentId = (ownerId: string, heroId: string): string => `${ownerId}::${heroId}`

const toInteger = (raw: Int32 | number, context: string): number => {
  const value = typeof raw === 'number' ? raw : raw.valueOf()

  if (!Number.isInteger(value) || value < 0) {
    throw new HeroLoadoutMappingError(`${context} no es un entero no negativo: ${String(value)}.`)
  }

  return value
}

export const toSnapshot = (document: HeroLoadoutDocument): HeroLoadoutSnapshot => {
  const seenSlots = new Set<string>()
  const seenItems = new Set<string>()

  for (const entry of document.entries) {
    if (!(ALL_EQUIPMENT_SLOTS as readonly string[]).includes(entry.slot)) {
      throw new HeroLoadoutMappingError(
        `El loadout ${document._id} usa una ranura desconocida: "${entry.slot}".`,
      )
    }
    if (seenSlots.has(entry.slot)) {
      throw new HeroLoadoutMappingError(
        `El loadout ${document._id} repite la ranura "${entry.slot}".`,
      )
    }
    if (seenItems.has(entry.itemId)) {
      throw new HeroLoadoutMappingError(
        `El loadout ${document._id} repite el objeto "${entry.itemId}".`,
      )
    }
    seenSlots.add(entry.slot)
    seenItems.add(entry.itemId)
  }

  return {
    ownerId: document.ownerId,
    heroId: document.heroId,
    version: toInteger(document.version, `La version del loadout ${document._id}`),
    entries: document.entries.map((entry) => ({
      slot: entry.slot as EquipmentSlot,
      itemId: entry.itemId,
      productId: entry.productId,
    })),
  }
}

export const toDocument = (snapshot: HeroLoadoutSnapshot): HeroLoadoutDocument => ({
  _id: documentId(snapshot.ownerId, snapshot.heroId),
  ownerId: snapshot.ownerId,
  heroId: snapshot.heroId,
  version: new Int32(snapshot.version),
  entries: snapshot.entries.map((entry) => ({
    slot: entry.slot,
    itemId: entry.itemId,
    productId: entry.productId,
  })),
})
