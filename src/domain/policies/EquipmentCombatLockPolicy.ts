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

/**
 * Misma decision que `decideEquipmentChange`, para la epica equipada (HU-31,
 * contrato `hu-31-equipped-epic-v1` §9).
 *
 * La epica NO es una `EquipmentCategory` (HU-28 la excluye), asi que no entra
 * en `LOCKED_CATEGORIES`: no se fuerza su encaje en esa tabla solo para
 * reutilizar la firma. En su lugar, esta funcion hermana aplica el MISMO
 * mensaje y la MISMA forma de decision a la unica mutacion que existe sobre
 * la epica -no hay categorias que distinguir, porque solo hay una regla: con
 * batalla activa, no se cambia-.
 */
export const decideEpicChange = (battleActive: boolean): EquipmentChangeDecision =>
  battleActive ? { ok: false, reason: 'battle_lock', message: BATTLE_LOCK_MESSAGE } : { ok: true }
