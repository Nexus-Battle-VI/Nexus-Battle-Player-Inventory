import type { HeroStatsDto } from './HeroEquipmentDto'

/**
 * Heroe preparado/equipado de un jugador, proyectado para el contrato interno
 * de Combat (HU-15, Management#24, Management#392).
 *
 * ES UN SUBCONJUNTO DELIBERADO de `HeroSelectionDto`/`HeroEquipmentDto`: no
 * viaja `imageUrl`, `lifecycleStatus`, el detalle de cada ranura equipada
 * (`itemId`, `productId`, `type`), ni la ocupacion de capacidad. Combat
 * necesita identificar el heroe y calcular con sus estadisticas, no el
 * detalle de inventario del jugador -minimizacion de datos frente al
 * contrato de HU-07 que si expone esa vista al propio jugador-.
 *
 * NO INCLUYE "nivel de heroe": ese concepto no existe en el dominio actual
 * (auditoria HU-15.2, hallazgo DP-3, confirmado de nuevo por grep exhaustivo
 * al implementar este contrato). Anadirlo aqui seria inventar un dato que
 * ninguna otra parte del sistema produce.
 */
export interface EquippedHeroDto {
  readonly playerId: string
  readonly heroId: string
  readonly reference: string
  readonly subtype: string
  readonly name: string
  readonly baseStats: HeroStatsDto
  readonly effectiveStats: HeroStatsDto
  readonly ready: boolean
  readonly selectedAt: string
}
