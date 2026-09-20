import type { EquippedHeroDto } from '../dto/EquippedHeroDto'
import type { GetHeroSelection } from './GetHeroSelection'

/**
 * Heroe preparado/equipado de un jugador, para el contrato interno de Combat
 * (HU-15, Management#24, Management#392).
 *
 * NO ACCEDE A NINGUN REPOSITORIO POR SU CUENTA. Delega COMPLETAMENTE en
 * `GetHeroSelection`, el MISMO caso de uso que sirve
 * `GET /inventories/me/heroes/selection` (HU-07): misma fuente de verdad,
 * mismas reglas de resolucion (heroe fuera del inventario, Catalog caido,
 * sin seleccion), un unico camino de lectura. Este caso de uso solo PROYECTA
 * ese resultado a un DTO mas pequeno -ver `EquippedHeroDto` para el porque-.
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
      ready: selection.readiness.ready,
      selectedAt: selection.selectedAt,
    }
  }
}
