import type { HeroReadiness } from '../../domain/policies/HeroReadinessPolicy'
import type { HeroEquipmentDto, HeroStatsDto } from './HeroEquipmentDto'

/**
 * Habilidad declarada por un heroe. `name` es `null` cuando Catalog no resolvio
 * la referencia: se muestra el hueco en vez de inventar un nombre.
 */
export interface HeroAbilityDto {
  readonly reference: string
  readonly name: string | null
}

/**
 * Un heroe que el jugador puede preparar (HU-07, CA-02 y CA-11).
 *
 * La lista sale del INVENTARIO del jugador cruzado con el catalogo vigente. Los
 * ocho prototipos iniciales no estan codificados en ninguna parte de este
 * contrato: un noveno heroe aprobado aparece aqui sin tocar codigo.
 */
export interface AvailableHeroDto {
  readonly heroId: string
  readonly reference: string
  readonly subtype: string
  readonly name: string
  readonly imageUrl: string
  readonly lifecycleStatus: string
  readonly baseStats: HeroStatsDto
  readonly abilities: readonly HeroAbilityDto[]
  readonly selected: boolean
}

/** Ocupacion de una familia de ranuras frente a su techo (HU-28: 2/6/2). */
export interface EquipmentCapacityDto {
  readonly used: number
  readonly max: number
}

/**
 * Configuracion preparada del jugador (HU-07, CA-01).
 *
 * `configuration` es LA MISMA vista que devuelve HU-28: heroe, equipamiento,
 * estadisticas base y efectivas. No se recalcula nada aqui.
 */
export interface HeroSelectionDto {
  readonly selectedAt: string
  readonly configuration: HeroEquipmentDto
  readonly readiness: HeroReadiness
  readonly capacity: {
    readonly weapons: EquipmentCapacityDto
    readonly armor: EquipmentCapacityDto
    readonly items: EquipmentCapacityDto
  }
}
