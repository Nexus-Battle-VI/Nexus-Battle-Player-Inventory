import type { EquippedHeroEpicDto } from './EquippedHeroDto'

/**
 * Vista publica de la epica equipada de un heroe propio (HU-31, contrato
 * `hu-31-equipped-epic-v1` §11).
 *
 * `epic` es `null` (no ausente: esta es una respuesta de UN solo recurso, no
 * una ampliacion aditiva de otro contrato) cuando el heroe no tiene epica
 * equipada. `version` habilita el bloqueo optimista de la propia escritura.
 * `locked` es HU-29: si hay batalla activa, igual criterio que `locked` en
 * `HeroEquipmentDto`.
 */
export interface HeroEpicDto {
  readonly heroId: string
  readonly epic: EquippedHeroEpicDto | null
  readonly version: number
  readonly locked: boolean
}
