import type { AbilityPowerCost, Magnitude } from '../../domain/value-objects/equipment-effects'
import type { HeroReadinessBlocker } from '../../domain/policies/HeroReadinessPolicy'
import type { HeroStatsDto } from './HeroEquipmentDto'

/**
 * Efecto de equipamiento, NORMALIZADO para el contrato interno de Combat
 * (HU-25, Management#72; HU-28, Management#75/#152).
 *
 * Es una proyeccion de `EquippedEffect` (el efecto que HU-28 ya calcula y
 * conserva en `HeroEquipmentDto.activeEffects`), no una segunda lectura de
 * Catalog. Lleva SOLO lo que un consumidor necesita para decidir si puede
 * tratar el efecto y como:
 *
 *  - `kind`, `target`, `statistic`, `operation`, `magnitude`: QUE hace el
 *    efecto y sobre quien. `target` importa tanto como `statistic`: un efecto
 *    dirigido al oponente no modifica al heroe propio.
 *  - `durationTurns`: si es permanente (ausente) o temporal.
 *  - `hasActivationCondition`: si esta sujeto a una condicion. Es un
 *    INDICADOR: la condicion en si no viaja (ver mas abajo). Basta para que un
 *    consumidor no lo trate como modificador permanente.
 *  - `appliedToStats`: si el efecto YA esta reflejado en `effectiveStats`.
 *    Evita la doble aplicacion: un `+1 ATTACK` con `appliedToStats = true` ya
 *    esta dentro de `effectiveStats.attack` y no debe sumarse otra vez.
 *  - `sourceProductId`/`sourceProductReference`: procedencia, solo para
 *    trazabilidad (que producto origina el efecto). No es informacion para
 *    decidir nada.
 *
 * LO QUE DELIBERADAMENTE NO VIAJA:
 *
 *  - `raw`: el objeto crudo de Catalog (`unknown`). Exponerlo dejaria un
 *    contrato abierto que acopla a Combat con una estructura de Catalog que
 *    nadie versiona aqui. Este DTO es cerrado: cada campo es una decision.
 *  - `sourceSlot`: es una propiedad del loadout (donde esta puesto el
 *    producto), no del efecto, y Combat no necesita el detalle de ranuras.
 *  - La CONDICION de activacion (`EVERY_N_TURNS`, `STAT_COMPARISON`, ...):
 *    hoy nadie la evalua. Cuando una HU defina cuando y como se evalua, el
 *    contrato debe ampliarse con un campo normalizado y versionado, no
 *    reabrirse con `raw`.
 *
 * Este DTO NO define semantica de combate: no dice como se traduce un
 * `CRITICAL_CHANCE` a una probabilidad de la tabla de HU-25. Solo transporta el
 * efecto tal como HU-28 lo conserva.
 */
export interface EquippedHeroEffectDto {
  readonly sourceProductId: string
  readonly sourceProductReference: string
  readonly kind: string
  readonly target: string
  readonly statistic?: string
  readonly operation?: string
  readonly magnitude?: Magnitude
  readonly durationTurns?: number
  readonly hasActivationCondition: boolean
  readonly appliedToStats: boolean
}

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
 * `activeEffects` (HU-25) son los efectos del equipamiento vigente, con la
 * forma normalizada de `EquippedHeroEffectDto`. Salen del MISMO calculo de
 * HU-28 que produce `effectiveStats`: no se recalculan para este contrato.
 * Un heroe sin equipamiento que module algo devuelve `[]`.
 *
 * EL NIVEL VIAJA (HU-08, CA-06). Cuando se escribio este contrato el nivel no
 * existia en el dominio (auditoria HU-15.2, hallazgo DP-3). Existe desde
 * HU-08/HU-09, y CA-06 exige que multiplique las estadisticas: `level` es el
 * nivel del heroe, `levelStats` la base x nivel y `effectiveStats` YA es
 * `(base x nivel) + equipamiento`. Combat NO debe volver a multiplicar por el
 * nivel: seria contarlo dos veces. Cambio ADITIVO: un consumidor que ignore
 * `level`/`levelStats` sigue leyendo `effectiveStats` como siempre.
 *
 * AMPLIACION ADITIVA (HU-16.1/HU-16.2, auditoria de elegibilidad precombate,
 * Management#401/#402):
 *
 *  - `blockers`: la MISMA lista de `HeroReadinessPolicy.assessHeroReadiness`
 *    que ya viaja en el contrato publico de HU-07 (`HeroSelectionDto.readiness`).
 *    Antes de esta ampliacion, Combat solo recibia `ready: boolean` y no podia
 *    distinguir POR QUE un heroe no esta listo. Los codigos
 *    (`HeroReadinessBlockerCode`) son los MISMOS de siempre: esta ampliacion no
 *    crea una segunda taxonomia de errores de equipamiento, solo deja de
 *    ocultarla a Combat.
 *  - `loadoutVersion`: la version real de `HeroLoadout` (bloqueo optimista que
 *    ya usa la escritura de HU-28, ver `HeroLoadout.version`). No existia en
 *    ningun contrato -ni siquiera en el publico de HU-07- hasta ahora. Permite
 *    a un consumidor (Combat) verificar que la configuracion de equipamiento
 *    validada en un momento sigue siendo la misma mas tarde, sin copiar el
 *    inventario. `0` cuando el heroe nunca tuvo loadout persistido (equivalente
 *    a `HeroLoadout.createEmpty`).
 */
/**
 * Efecto de una HABILIDAD del heroe (HU-19), normalizado para Combat.
 *
 * Mismos campos que `EquippedHeroEffectDto` MENOS los de procedencia y
 * `appliedToStats`, que no aplican: una habilidad no forma parte de las
 * estadisticas efectivas, se ejecuta como accion. Lista blanca campo a campo,
 * sin `raw`, y la condicion de activacion (y el codigo de una inmunidad o de un
 * estado) NO cruza la frontera: solo su indicador. Este DTO no define
 * semantica de combate: que efecto sabe ejecutar Combat lo decide Combat.
 */
export interface EquippedHeroAbilityEffectDto {
  readonly kind: string
  readonly target: string
  readonly statistic?: string
  readonly operation?: string
  readonly magnitude?: Magnitude
  readonly durationTurns?: number
  readonly hasActivationCondition: boolean
}

/**
 * Habilidad especial de un heroe (HU-19, Management#63; Tabla 7 del documento
 * oficial): identidad, costo de Poder, turnos de carga y efectos, tal como los
 * publica Catalog v1. Player-Inventory las RESUELVE (una llamada a Catalog por
 * peticion) y las entrega a Combat, que las congela al iniciar la batalla y las
 * ejecuta. No ejecuta nada ni decide que efecto es soportado.
 *
 * `abilityId` es el `productId` de Catalog: es el identificador que el cliente
 * envia en `useSkill`. `name` es texto para mostrar.
 */
export interface EquippedHeroAbilityDto {
  readonly abilityId: string
  readonly reference: string
  readonly name: string
  readonly powerCost: AbilityPowerCost
  readonly chargeTurns: number
  readonly effects: readonly EquippedHeroAbilityEffectDto[]
}

/**
 * Epica equipada resuelta (HU-31, contrato `hu-31-equipped-epic-v1` §5).
 *
 * Lista blanca, no el documento crudo de Catalog. `baseEffect`/`specificEffect`
 * son la definicion tal como la publica Catalog (`null` en `baseEffect` =
 * "No aplica", misma semantica que `EpicDefinition` de `EpicEffectPolicy`).
 * `applied.*` es el resultado YA resuelto por `applyEpicEffects` con el
 * subtype real del heroe: lo que Combat congela y lo que Web presenta como
 * "aplicado"/"no aplicado por subtipo". No se reimplementa el resolver aqui:
 * este DTO solo transporta su salida.
 */
export interface EquippedHeroEpicDto {
  readonly epicProductId: string
  readonly epicReference: string
  readonly name: string
  readonly compatibleHeroSubtype: string
  readonly baseEffect: Record<string, unknown> | null
  readonly specificEffect: Record<string, unknown>
  readonly applied: {
    readonly baseApplied: Record<string, unknown> | null
    readonly additionalApplied: Record<string, unknown> | null
  }
}

export interface EquippedHeroDto {
  readonly playerId: string
  readonly heroId: string
  readonly reference: string
  readonly subtype: string
  readonly name: string
  /** Nivel del heroe (HU-08). `effectiveStats` ya lo incorpora (CA-06). */
  readonly level: number
  /** Estadisticas base de Catalog (nivel 1), sin escalar. */
  readonly baseStats: HeroStatsDto
  /** Base x nivel, antes del equipamiento. `damage` y `healing` no se escalan. */
  readonly levelStats: HeroStatsDto
  /** `(base x nivel) + equipamiento`. */
  readonly effectiveStats: HeroStatsDto
  readonly activeEffects: readonly EquippedHeroEffectDto[]
  /**
   * Habilidades especiales del heroe (HU-19), en el orden en que Catalog las
   * declara. Una que Catalog no resuelva o cuyos atributos no cumplan el
   * contrato canonico se OMITE (no se inventa). Ampliacion aditiva: Combat la
   * exige, asi que este servicio se despliega primero.
   */
  readonly abilities: readonly EquippedHeroAbilityDto[]
  readonly ready: boolean
  readonly blockers: readonly HeroReadinessBlocker[]
  readonly loadoutVersion: number
  readonly selectedAt: string
  /**
   * Epica equipada del heroe (HU-31). AUSENTE (la clave entera no existe en
   * el JSON) cuando el heroe no tiene epica equipada -- nunca `null` ni `{}`,
   * mismo criterio de ausencia explicita que el resto de este contrato.
   * Ampliacion aditiva: ningun consumidor existente se rompe por su ausencia.
   */
  readonly epic?: EquippedHeroEpicDto
}
