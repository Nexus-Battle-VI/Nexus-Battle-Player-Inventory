import { PlayerId } from '../../domain/value-objects/identifiers'
import {
  parseAbilityAttributes,
  parseHeroAttributes,
  type EquippedEffect,
  type ParsedEffect,
} from '../../domain/value-objects/equipment-effects'
import type {
  EquippedHeroAbilityDto,
  EquippedHeroAbilityEffectDto,
  EquippedHeroDto,
  EquippedHeroEffectDto,
} from '../dto/EquippedHeroDto'
import type { CatalogProductView, CatalogReadPort } from '../ports/CatalogReadPort'
import type { HeroLoadoutRepositoryPort } from '../ports/HeroLoadoutRepositoryPort'
import type { GetHeroSelection } from './GetHeroSelection'

/** Tipo canonico de Catalog de las acciones especiales de un heroe. */
const ABILITY_TYPE = 'HABILIDAD'

/**
 * Heroe preparado/equipado de un jugador, para el contrato interno de Combat
 * (HU-15, Management#24, Management#392; efectos activos: HU-25, Management#72;
 * habilidades: HU-19, Management#63).
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
 * a consultar Catalog ni a recorrer el loadout para el equipamiento: una sola
 * logica de equipamiento, y por construccion los efectos y las estadisticas
 * efectivas de esta respuesta describen el mismo estado.
 *
 * LAS HABILIDADES SON LA EXCEPCION (HU-19): no forman parte del equipamiento ni
 * de las estadisticas efectivas (las tres acciones especiales de un heroe son
 * de su clase, Tabla 7), y `GetHeroSelection` solo conserva sus referencias.
 * Aqui se RESUELVEN a traves del puerto de lectura de Catalog: el producto del
 * heroe (sus referencias) y una sola llamada `lookup` por las habilidades.
 * Player-Inventory NO las ejecuta ni decide que efecto es soportado: eso es de
 * Combat.
 *
 * LA IDENTIDAD DEL JUGADOR LA DA QUIEN LLAMA (el controlador, a partir del
 * segmento de ruta que Combat rellena con el sujeto de SU PROPIO testimonio
 * verificado). Este caso de uso no la deriva de ningun otro sitio ni acepta
 * un heroId: solo un identificador de jugador, exactamente igual que
 * `GetHeroSelection.execute`.
 *
 * AMPLIACION ADITIVA (HU-16.1/HU-16.2, Management#401/#402): ademas de
 * `GetHeroSelection`, este caso de uso lee `HeroLoadoutRepositoryPort`
 * DIRECTAMENTE para obtener `HeroLoadout.version`. No es una segunda
 * implementacion de HU-28 (no valida nada del loadout, solo lee su version):
 * es la MISMA politica ya tolerada en `assembleSelectionView` (una segunda
 * lectura del inventario para la vista de capacidad). Es una unica llamada
 * adicional de solo lectura por peticion, no un segundo camino de escritura
 * ni de calculo. `blockers` reutiliza la MISMA lista de
 * `HeroReadinessPolicy` que ya expone el contrato publico de HU-07: no crea
 * una segunda taxonomia de motivos de bloqueo.
 */
export class GetEquippedHeroForCombat {
  constructor(
    private readonly getHeroSelection: GetHeroSelection,
    private readonly loadouts: HeroLoadoutRepositoryPort,
    private readonly catalog: CatalogReadPort,
  ) {}

  async execute(playerId: string): Promise<EquippedHeroDto> {
    const selection = await this.getHeroSelection.execute(playerId)
    const heroId = selection.configuration.hero.heroId

    const loadout = await this.loadouts.findByHero(PlayerId.create(playerId), heroId)
    const abilities = await this.resolveAbilities(heroId)

    return {
      playerId,
      heroId,
      reference: selection.configuration.hero.reference,
      subtype: selection.configuration.hero.subtype,
      name: selection.configuration.hero.name,
      baseStats: selection.configuration.baseStats,
      effectiveStats: selection.configuration.effectiveStats,
      activeEffects: selection.configuration.activeEffects.map(toEffectDto),
      abilities,
      ready: selection.readiness.ready,
      blockers: selection.readiness.blockers,
      loadoutVersion: loadout?.version ?? 0,
      selectedAt: selection.selectedAt,
    }
  }

  /**
   * Las habilidades del heroe en el orden en que Catalog las declara. Una llamada
   * por el producto del heroe y UNA `lookup` por todas sus habilidades (nunca una
   * por habilidad). Un fallo de Catalog se propaga (503): sin sus datos no se
   * inventan habilidades. Una habilidad que Catalog no devuelva o que no cumpla el
   * contrato canonico se omite: el heroe simplemente no la tiene.
   */
  private async resolveAbilities(heroId: string): Promise<readonly EquippedHeroAbilityDto[]> {
    const heroProduct = await this.catalog.getByReference(heroId)

    if (heroProduct === null) {
      return []
    }

    const references = heroAbilityReferences(heroProduct)

    if (references.length === 0) {
      return []
    }

    const products = await this.catalog.lookup({ references, type: ABILITY_TYPE })
    const byReference = new Map<string, CatalogProductView>()

    for (const product of products) {
      byReference.set(product.productId, product)
      byReference.set(product.sku, product)
    }

    return references.flatMap((reference) => {
      const product = byReference.get(reference)
      const ability = product === undefined ? null : toAbilityDto(product)

      return ability === null ? [] : [ability]
    })
  }
}

/** Las referencias `abilities` del producto HEROE, o vacio si sus atributos no son un heroe canonico. */
const heroAbilityReferences = (heroProduct: CatalogProductView): readonly string[] => {
  try {
    return [...new Set(parseHeroAttributes(heroProduct.attributes).abilities)]
  } catch {
    return []
  }
}

const toAbilityDto = (product: CatalogProductView): EquippedHeroAbilityDto | null => {
  try {
    const view = parseAbilityAttributes(product.attributes)

    return {
      abilityId: product.productId,
      reference: product.sku,
      name: product.name,
      powerCost: view.powerCost,
      chargeTurns: view.chargeTurns,
      effects: view.effects.map(toAbilityEffectDto),
    }
  } catch {
    return null
  }
}

/** Lista BLANCA campo a campo: la condicion de activacion y `raw` no cruzan la frontera. */
const toAbilityEffectDto = (effect: ParsedEffect): EquippedHeroAbilityEffectDto => ({
  kind: effect.kind,
  target: effect.target,
  ...(effect.statistic === undefined ? {} : { statistic: effect.statistic }),
  ...(effect.operation === undefined ? {} : { operation: effect.operation }),
  ...(effect.magnitude === undefined ? {} : { magnitude: effect.magnitude }),
  ...(effect.durationTurns === undefined ? {} : { durationTurns: effect.durationTurns }),
  hasActivationCondition: effect.hasActivationCondition,
})

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
