import {
  parseAbilityAttributes,
  parseHeroAttributes,
  type EquippedEffect,
  type ParsedEffect,
} from '../../domain/value-objects/equipment-effects'
import type {
  EquippedHeroAbilityDto,
  EquippedHeroAbilityEffectDto,
  EquippedHeroEffectDto,
} from '../dto/EquippedHeroDto'
import type { CatalogProductView, CatalogReadPort } from '../ports/CatalogReadPort'

/**
 * Proyecciones compartidas por las DOS lecturas internas de un heroe:
 * `equipped-hero` (el heroe seleccionado, para Combat) y `heroes/{heroId}` (el
 * perfil de un heroe concreto, para Missions en HU-71).
 *
 * POR QUE VIVE AQUI Y NO EN UNA DE LAS DOS. Ambas necesitan exactamente la misma
 * regla --resolver las habilidades contra Catalog y normalizar los efectos del
 * equipamiento-- y tenerla dos veces seria la forma mas segura de que las dos
 * respuestas dejaran de coincidir. La regla se escribe una vez y los dos casos
 * de uso la importan; el test `no-duplicated-abilities-resolution` comprueba
 * sobre el codigo fuente que nadie la vuelve a escribir.
 *
 * NO ES UN CASO DE USO: no tiene estado, no decide nada de negocio y no conoce
 * la seleccion del jugador.
 */

/** Tipo canonico de Catalog de las acciones especiales de un heroe. */
const ABILITY_TYPE = 'HABILIDAD'

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
 * Las habilidades del heroe en el orden en que Catalog las declara. Una llamada
 * por el producto del heroe y UNA `lookup` por todas sus habilidades (nunca una
 * por habilidad). Un fallo de Catalog se propaga (503): sin sus datos no se
 * inventan habilidades. Una habilidad que Catalog no devuelva o que no cumpla el
 * contrato canonico se omite: el heroe simplemente no la tiene.
 */
export const resolveHeroAbilities = async (
  catalog: CatalogReadPort,
  heroId: string,
): Promise<readonly EquippedHeroAbilityDto[]> => {
  const heroProduct = await catalog.getByReference(heroId)

  if (heroProduct === null) {
    return []
  }

  const references = heroAbilityReferences(heroProduct)

  if (references.length === 0) {
    return []
  }

  const products = await catalog.lookup({ references, type: ABILITY_TYPE })
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

/**
 * Lista BLANCA campo a campo, no un `{ ...effect }` menos `raw`: si manana
 * `EquippedEffect` gana un campo, no cruza la frontera de servicio por
 * accidente. Los opcionales solo se anaden cuando existen, igual que en
 * `computeEffectiveStats`.
 */
export const toEquippedHeroEffect = (effect: EquippedEffect): EquippedHeroEffectDto => ({
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
