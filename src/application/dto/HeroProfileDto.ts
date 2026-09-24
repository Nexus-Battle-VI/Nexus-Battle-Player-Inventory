import type { EquippedHeroAbilityDto, EquippedHeroEffectDto } from './EquippedHeroDto'
import type { HeroStatsDto } from './HeroEquipmentDto'

/**
 * Perfil de un heroe CONCRETO del jugador, para el contrato interno de Missions
 * (HU-71, Management#56/#370; la ruta y su forma las fija el cliente de Missions
 * `PlayerInventoryAbilitiesClient`).
 *
 * POR QUE NO REUTILIZA `EquippedHeroDto`. Ese DTO describe al heroe
 * **seleccionado** y lleva tres campos que solo existen cuando hay seleccion:
 *
 *   - `ready` y `blockers`: los produce `HeroReadinessPolicy` para la seleccion
 *     vigente (HU-07/HU-16). El heroe de una estrategia de mision no tiene por
 *     que ser el seleccionado, asi que publicarlos aqui seria inventar una
 *     evaluacion de preparacion que nadie hizo.
 *   - `selectedAt`: no hay seleccion que fechar.
 *
 * POR QUE SI REUTILIZA EL RESTO. `baseStats`, `effectiveStats`, `activeEffects` y
 * `abilities` significan exactamente lo mismo que en `equipped-hero`, y Missions
 * **congela el cuerpo entero** como perfil de combate para HU-72: si los nombres
 * o la forma cambiaran entre las dos rutas, el motor de simulacion recibiria dos
 * perfiles distintos del mismo heroe.
 *
 * `heroId` ES EL `productId` CANONICO, tambien cuando quien llama pidio el heroe
 * por su `sku`: el consumidor compara `heroId` con el que pidio, asi que devolver
 * la referencia de entrada romperia esa comprobacion.
 */
export interface HeroProfileDto {
  readonly playerId: string
  /** `productId` canonico del heroe. */
  readonly heroId: string
  /** Referencia con la que el heroe figura en el inventario del jugador. */
  readonly reference: string
  readonly subtype: string
  readonly name: string
  readonly baseStats: HeroStatsDto
  readonly effectiveStats: HeroStatsDto
  readonly activeEffects: readonly EquippedHeroEffectDto[]
  readonly abilities: readonly EquippedHeroAbilityDto[]
  /** Version real del loadout; `0` cuando el heroe nunca tuvo uno persistido. */
  readonly loadoutVersion: number
}
