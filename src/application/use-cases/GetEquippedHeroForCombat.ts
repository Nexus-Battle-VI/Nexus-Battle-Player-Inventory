import type { EquippedEffect } from '../../domain/value-objects/equipment-effects'
import type { EquippedHeroDto, EquippedHeroEffectDto } from '../dto/EquippedHeroDto'
import type { GetHeroSelection } from './GetHeroSelection'

/**
 * Heroe preparado/equipado de un jugador, para el contrato interno de Combat
 * (HU-15, Management#24, Management#392; efectos activos: HU-25, Management#72).
 *
 * NO ACCEDE A NINGUN REPOSITORIO POR SU CUENTA. Delega COMPLETAMENTE en
 * `GetHeroSelection`, el MISMO caso de uso que sirve
 * `GET /inventories/me/heroes/selection` (HU-07): misma fuente de verdad,
 * mismas reglas de resolucion (heroe fuera del inventario, Catalog caido,
 * sin seleccion), un unico camino de lectura. Este caso de uso solo PROYECTA
 * ese resultado a un DTO mas pequeno -ver `EquippedHeroDto` para el porque-.
 *
 * NO RECALCULA EQUIPAMIENTO. `activeEffects` es la proyeccion de
 * `configuration.activeEffects`, el resultado que HU-28 ya produjo junto con
 * `effectiveStats` en una unica pasada (`computeEffectiveStats`). No se vuelve
 * a consultar Catalog ni a recorrer el loadout: una sola logica de
 * equipamiento, y por construccion los efectos y las estadisticas efectivas de
 * esta respuesta describen el mismo estado.
 *
 * LA IDENTIDAD DEL JUGADOR LA DA QUIEN LLAMA (el controlador, a partir del
 * segmento de ruta que Combat rellena con el sujeto de SU PROPIO testimonio
 * verificado). Este caso de uso no la deriva de ningun otro sitio ni acepta
 * un heroId: solo un identificador de jugador, exactamente igual que
 * `GetHeroSelection.execute`.
 */
export class GetEquippedHeroForCombat {
  constructor(private readonly getHeroSelection: GetHeroSelection) {}

  async execute(playerId: string): Promise<EquippedHeroDto> {
    const selection = await this.getHeroSelection.execute(playerId)

    return {
      playerId,
      heroId: selection.configuration.hero.heroId,
      reference: selection.configuration.hero.reference,
      subtype: selection.configuration.hero.subtype,
      name: selection.configuration.hero.name,
      baseStats: selection.configuration.baseStats,
      effectiveStats: selection.configuration.effectiveStats,
      activeEffects: selection.configuration.activeEffects.map(toEffectDto),
      ready: selection.readiness.ready,
      selectedAt: selection.selectedAt,
    }
  }
}

/**
 * Lista BLANCA campo a campo, no un `{ ...effect }` menos `raw`: si manana
 * `EquippedEffect` gana un campo, no cruza la frontera de servicio por
 * accidente. Los opcionales solo se anaden cuando existen, igual que en
 * `computeEffectiveStats`.
 */
const toEffectDto = (effect: EquippedEffect): EquippedHeroEffectDto => ({
  sourceProductId: effect.sourceProductId,
  sourceProductReference: effect.sourceProductReference,
  kind: effect.kind,
  target: effect.target,
  ...(effect.statistic === undefined ? {} : { statistic: effect.statistic }),
  ...(effect.operation === undefined ? {} : { operation: effect.operation }),
  ...(effect.magnitude === undefined ? {} : { magnitude: effect.magnitude }),
  ...(effect.durationTurns === undefined ? {} : { durationTurns: effect.durationTurns }),
  hasActivationCondition: effect.hasActivationCondition,
  appliedToStats: effect.appliedToStats,
})
