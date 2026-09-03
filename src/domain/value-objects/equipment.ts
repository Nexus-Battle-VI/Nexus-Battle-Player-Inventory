import { DomainError } from '../errors/DomainError'

/**
 * Ranuras de equipamiento de un heroe (RF-28).
 *
 * La configuracion conceptual es fija: dos armas, seis piezas de armadura
 * —una por zona— y dos items. Los limites 2/6/2 son regla de negocio y no se
 * parametrizan.
 */
export const EquipmentSlot = {
  Weapon1: 'WEAPON_1',
  Weapon2: 'WEAPON_2',
  Helmet: 'HELMET',
  Chest: 'CHEST',
  Gloves: 'GLOVES',
  Bracers: 'BRACERS',
  Pants: 'PANTS',
  Shoes: 'SHOES',
  Item1: 'ITEM_1',
  Item2: 'ITEM_2',
} as const

export type EquipmentSlot = (typeof EquipmentSlot)[keyof typeof EquipmentSlot]

export const ALL_EQUIPMENT_SLOTS: readonly EquipmentSlot[] = Object.values(EquipmentSlot)

/**
 * Familia de equipamiento. Se corresponde 1:1 con el `type` canonico de
 * Catalog: `ARMA` -> `WEAPON`, `ARMADURA` -> `ARMOR`, `ITEM` -> `ITEM`. Los
 * tipos `HEROE`, `HABILIDAD` y `EPICA` no son equipables en HU-28.
 */
export const EquipmentCategory = {
  Weapon: 'WEAPON',
  Armor: 'ARMOR',
  Item: 'ITEM',
} as const

export type EquipmentCategory = (typeof EquipmentCategory)[keyof typeof EquipmentCategory]

/** Numero maximo de ranuras ocupadas por familia (RF-28). */
export const EQUIPMENT_CAPACITY: Readonly<Record<EquipmentCategory, number>> = {
  WEAPON: 2,
  ARMOR: 6,
  ITEM: 2,
}

const WEAPON_SLOTS: readonly EquipmentSlot[] = [EquipmentSlot.Weapon1, EquipmentSlot.Weapon2]
const ITEM_SLOTS: readonly EquipmentSlot[] = [EquipmentSlot.Item1, EquipmentSlot.Item2]

/**
 * Ranura de armadura -> codigo `ArmorSlot` que Catalog publica en
 * `attributes.values.slot`. Es la unica correspondencia aprobada: una pieza
 * cuyo `slot` canonico no case con la ranura pedida se rechaza.
 */
export const ARMOR_SLOT_BY_EQUIPMENT_SLOT: Partial<Record<EquipmentSlot, string>> = {
  HELMET: 'HEAD',
  CHEST: 'CHEST',
  GLOVES: 'GLOVES',
  BRACERS: 'BRACERS',
  PANTS: 'PANTS',
  SHOES: 'SHOES',
}

const ARMOR_SLOTS: readonly EquipmentSlot[] = Object.keys(
  ARMOR_SLOT_BY_EQUIPMENT_SLOT,
) as EquipmentSlot[]

/** Familia a la que pertenece una ranura. */
export const categoryOfSlot = (slot: EquipmentSlot): EquipmentCategory => {
  if (WEAPON_SLOTS.includes(slot)) return EquipmentCategory.Weapon
  if (ITEM_SLOTS.includes(slot)) return EquipmentCategory.Item
  return EquipmentCategory.Armor
}

/** Todas las ranuras de una familia, en orden estable. */
export const slotsOfCategory = (category: EquipmentCategory): readonly EquipmentSlot[] => {
  if (category === EquipmentCategory.Weapon) return WEAPON_SLOTS
  if (category === EquipmentCategory.Item) return ITEM_SLOTS
  return ARMOR_SLOTS
}

/**
 * Traduce el `type` canonico de Catalog a familia de equipamiento. Devuelve
 * `null` para los tipos que HU-28 no equipa (`HEROE`, `HABILIDAD`, `EPICA`).
 */
export const equipmentCategoryOfProductType = (productType: string): EquipmentCategory | null => {
  switch (productType) {
    case 'ARMA':
      return EquipmentCategory.Weapon
    case 'ARMADURA':
      return EquipmentCategory.Armor
    case 'ITEM':
      return EquipmentCategory.Item
    default:
      return null
  }
}

/** Normaliza y valida una ranura recibida de la interfaz. */
export const parseEquipmentSlot = (raw: string): EquipmentSlot => {
  const normalized = raw.trim().toUpperCase()

  if (!(ALL_EQUIPMENT_SLOTS as readonly string[]).includes(normalized)) {
    throw new DomainError(
      `La ranura de equipamiento "${raw}" no existe. Ranuras validas: ${ALL_EQUIPMENT_SLOTS.join(', ')}.`,
    )
  }

  return normalized as EquipmentSlot
}
