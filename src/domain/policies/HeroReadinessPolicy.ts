/**
 * Cuando un heroe preparado esta LISTO para entrar a una batalla, mision o
 * torneo (HU-07, CA-10).
 *
 * ESTA POLITICA NO REIMPLEMENTA HU-28. Las capacidades 2/6/2, la coherencia
 * ranura/familia y la propiedad del producto en el momento de equipar ya las
 * aplica `HeroLoadout` cuando se escribe, y volver a comprobarlas aqui seria la
 * segunda implementacion que la TASK HU-07.2 prohibe expresamente.
 *
 * Lo que esta politica cubre es lo que HU-28 NO puede garantizar: la DERIVA
 * posterior a la escritura. Entre el momento de equipar y el momento de jugar
 * pueden pasar cosas que nadie vuelve a mirar:
 *
 * - el heroe se suspende en el catalogo;
 * - una pieza equipada deja de estar en el inventario del jugador (se vendio,
 *   se subasto, se transfirio) — CA-06;
 * - una pieza equipada se suspende en el catalogo.
 *
 * Ninguna de las tres invalida el loadout guardado, y por eso no se borra nada:
 * un heroe con una pieza suspendida vuelve a estar listo en cuanto esa pieza se
 * reactive. Se informa, no se destruye.
 *
 * UN HEROE SIN EQUIPAMIENTO ESTA LISTO. La HU dice "hasta dos armas", "hasta
 * seis piezas", "hasta dos items": son techos, no minimos. Exigir el
 * equipamiento completo inventaria una regla que nadie escribio.
 *
 * NO DECIDE SI UNA BATALLA CONCRETA ADMITE ESTA CONFIGURACION (eso es HU-16) NI
 * QUE PUEDE CAMBIARSE DURANTE EL COMBATE (eso es HU-29).
 */
export const ACTIVE_LIFECYCLE_STATUS = 'ACTIVE'

export const HERO_READINESS_BLOCKERS = [
  'HERO_NOT_ACTIVE',
  'EQUIPPED_PRODUCT_NOT_OWNED',
  'EQUIPPED_PRODUCT_NOT_ACTIVE',
] as const

export type HeroReadinessBlockerCode = (typeof HERO_READINESS_BLOCKERS)[number]

export interface HeroReadinessBlocker {
  readonly code: HeroReadinessBlockerCode
  /** Ranura afectada, o `null` cuando el impedimento es del propio heroe. */
  readonly slot: string | null
  readonly reference: string
  readonly detail: string
}

export interface HeroReadiness {
  readonly ready: boolean
  readonly blockers: readonly HeroReadinessBlocker[]
}

export interface EquippedForReadiness {
  readonly slot: string
  readonly itemId: string
  readonly name: string
  /** `UNKNOWN` cuando Catalog no devolvio el producto: no se supone activo. */
  readonly lifecycleStatus: string
}

export interface HeroReadinessInput {
  readonly heroReference: string
  readonly heroName: string
  readonly heroLifecycleStatus: string
  readonly equipped: readonly EquippedForReadiness[]
  /** Referencias que el jugador posee AHORA, tal como las da el inventario. */
  readonly ownedReferences: ReadonlySet<string>
}

export const assessHeroReadiness = (input: HeroReadinessInput): HeroReadiness => {
  const blockers: HeroReadinessBlocker[] = []

  if (input.heroLifecycleStatus !== ACTIVE_LIFECYCLE_STATUS) {
    blockers.push({
      code: 'HERO_NOT_ACTIVE',
      slot: null,
      reference: input.heroReference,
      detail: `El heroe "${input.heroName}" no esta activo en el catalogo vigente.`,
    })
  }

  for (const entry of input.equipped) {
    if (!input.ownedReferences.has(entry.itemId)) {
      blockers.push({
        code: 'EQUIPPED_PRODUCT_NOT_OWNED',
        slot: entry.slot,
        reference: entry.itemId,
        detail: `"${entry.name}" ya no esta en tu inventario. Retiralo de la ranura ${entry.slot}.`,
      })

      // Un producto que ya no se posee no se juzga ademas por su estado en el
      // catalogo: seria un segundo mensaje sobre el mismo problema.
      continue
    }

    if (entry.lifecycleStatus !== ACTIVE_LIFECYCLE_STATUS) {
      blockers.push({
        code: 'EQUIPPED_PRODUCT_NOT_ACTIVE',
        slot: entry.slot,
        reference: entry.itemId,
        detail: `"${entry.name}" no esta activo en el catalogo vigente.`,
      })
    }
  }

  return { ready: blockers.length === 0, blockers }
}
