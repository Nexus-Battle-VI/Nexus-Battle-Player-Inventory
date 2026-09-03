import type { EquipmentSlot } from '../../domain/value-objects/equipment'
import type { EquippedEffect, Magnitude } from '../../domain/value-objects/equipment-effects'

/** Producto equipado en una ranura, con los datos que la interfaz necesita. */
export interface EquippedProductDto {
  readonly slot: EquipmentSlot
  readonly itemId: string
  readonly productId: string
  readonly name: string
  readonly imageUrl: string
  readonly type: string
  readonly lifecycleStatus: string
}

export interface HeroStatsDto {
  readonly power: number
  readonly health: number
  readonly defense: number
  readonly attack: number | null
  /** Dado o valor fijo, sin colapsar: HU-28 no ejecuta combate. */
  readonly damage: Magnitude | null
  readonly healing: Magnitude | null
}

export interface HeroStatDeltaDto {
  readonly statistic: string
  readonly base: number
  readonly effective: number
  readonly delta: number
}

export interface HeroEquipmentDto {
  readonly hero: {
    readonly heroId: string
    readonly reference: string
    readonly subtype: string
    readonly name: string
    readonly imageUrl: string
  }
  readonly equipment: {
    readonly weapons: readonly EquippedProductDto[]
    readonly armor: Readonly<Record<string, EquippedProductDto | null>>
    readonly items: readonly EquippedProductDto[]
  }
  readonly baseStats: HeroStatsDto
  readonly effectiveStats: HeroStatsDto
  readonly deltas: readonly HeroStatDeltaDto[]
  /**
   * Todos los efectos del equipamiento, con procedencia. `appliedToStats`
   * distingue los que ya se reflejan en `effectiveStats` de los que quedan para
   * el motor de combate (HU-29+).
   */
  readonly activeEffects: readonly EquippedEffect[]
}
