import type { HeroLoadout } from '../../domain/entities/HeroLoadout'
import { assessHeroReadiness } from '../../domain/policies/HeroReadinessPolicy'
import { EQUIPMENT_CAPACITY } from '../../domain/value-objects/equipment'
import type { PlayerId } from '../../domain/value-objects/identifiers'
import type { HeroSelectionDto } from '../dto/HeroSelectionDto'
import {
  assembleEquipmentView,
  type HeroEquipmentDeps,
  type ResolvedHero,
} from './hero-equipment-shared'

/**
 * Compone la configuracion preparada de un jugador (HU-07, CA-01 y CA-10).
 *
 * NO RECALCULA NADA DE HU-28. El bloque `configuration` es literalmente la
 * vista que devuelve `assembleEquipmentView`, con sus estadisticas base,
 * efectivas y efectos; HU-07 solo le anade lo suyo: cuando se eligio el heroe,
 * si esta listo y por que no.
 *
 * LA OCUPACION SE LEE, NO SE REVALIDA. `filledCount` y `EQUIPMENT_CAPACITY` son
 * del agregado de HU-28; aqui se muestran para que la interfaz pueda decir
 * "1/2 armas" sin inventar el techo. Comprobar el limite otra vez seria la
 * segunda implementacion que la TASK HU-07.2 prohibe.
 */
export const assembleSelectionView = async (
  deps: HeroEquipmentDeps,
  owner: PlayerId,
  hero: ResolvedHero,
  loadout: HeroLoadout,
  selectedAt: Date,
): Promise<HeroSelectionDto> => {
  const configuration = await assembleEquipmentView(deps, hero, loadout)

  // Segunda lectura del inventario —la primera la hizo `resolveOwnedHero`—.
  // Es un unico documento acotado por la capacidad del agregado, y tenerlo
  // aqui evita ensanchar la firma compartida de HU-28 con un parametro que solo
  // necesita HU-07.
  const owned = await deps.inventories.findAllOwnedItems(owner)
  const ownedReferences = new Set(owned.map((item) => item.itemId))

  const equipped = [
    ...configuration.equipment.weapons,
    ...Object.values(configuration.equipment.armor).flatMap((entry) =>
      entry === null ? [] : [entry],
    ),
    ...configuration.equipment.items,
  ]

  const readiness = assessHeroReadiness({
    heroReference: configuration.hero.reference,
    heroName: configuration.hero.name,
    heroLifecycleStatus: hero.heroProduct.lifecycleStatus,
    equipped: equipped.map((entry) => ({
      slot: entry.slot,
      itemId: entry.itemId,
      name: entry.name,
      lifecycleStatus: entry.lifecycleStatus,
    })),
    ownedReferences,
  })

  return {
    selectedAt: selectedAt.toISOString(),
    configuration,
    readiness,
    capacity: {
      weapons: { used: loadout.filledCount('WEAPON'), max: EQUIPMENT_CAPACITY.WEAPON },
      armor: { used: loadout.filledCount('ARMOR'), max: EQUIPMENT_CAPACITY.ARMOR },
      items: { used: loadout.filledCount('ITEM'), max: EQUIPMENT_CAPACITY.ITEM },
    },
  }
}
