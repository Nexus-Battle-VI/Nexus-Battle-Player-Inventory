import type { HeroReadiness } from '../../domain/policies/HeroReadinessPolicy'
import type { HeroStatsDto } from './HeroEquipmentDto'
import type { HeroProgressionDto } from './HeroProgressionDto'
import type { EquipmentViewWithoutLock } from '../use-cases/hero-equipment-shared'

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
 *
 * `progression` SE AGREGA DE FORMA ADITIVA (auditoria de "Mi Inventario",
 * 2026-09-27) para que la pantalla muestre el nivel y la experiencia REALES de
 * CADA heroe sin una peticion aparte por heroe. Es la MISMA vista que produce
 * `GetHeroProgression` (HU-08, Task #189): no hay una segunda lectura de la
 * progresion ni una segunda tabla de umbrales. Un campo nuevo en un objeto
 * existente no rompe a ningun consumidor que ya lea `AvailableHeroDto`.
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
  readonly progression: HeroProgressionDto
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
 *
 * NO lleva `locked` (HU-29): el estado de batalla lo publica la ruta de
 * equipamiento, que es la que decide si un cambio procede. Aqui se declara el
 * tipo sin ese campo en lugar de rellenarlo con un `false` que nadie comprobo.
 */
export interface HeroSelectionDto {
  readonly selectedAt: string
  readonly configuration: EquipmentViewWithoutLock
  readonly readiness: HeroReadiness
  readonly capacity: {
    readonly weapons: EquipmentCapacityDto
    readonly armor: EquipmentCapacityDto
    readonly items: EquipmentCapacityDto
  }
}
