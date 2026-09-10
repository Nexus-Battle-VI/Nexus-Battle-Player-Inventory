import type { EquipmentCategory } from '../value-objects/equipment'

export type EquipmentChangeDecision =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason: 'battle_lock'
      readonly message: string
    }

export const BATTLE_LOCK_MESSAGE =
  'No se puede modificar el equipamiento porque el heroe participa en una batalla activa.'

const LOCKED_CATEGORIES: ReadonlySet<EquipmentCategory> = new Set(['WEAPON', 'ARMOR', 'ITEM'])

/**
 * Politica pura que precede a cualquier mutacion de HU-28. La categoria no
 * cambia el resultado: arma, armadura e item quedan bloqueados por igual.
 */
export const decideEquipmentChange = (
  battleActive: boolean,
  kind: EquipmentCategory,
): EquipmentChangeDecision =>
  battleActive && LOCKED_CATEGORIES.has(kind)
    ? { ok: false, reason: 'battle_lock', message: BATTLE_LOCK_MESSAGE }
    : { ok: true }
