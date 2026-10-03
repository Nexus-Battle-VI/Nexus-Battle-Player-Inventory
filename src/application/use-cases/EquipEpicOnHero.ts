import { HeroEpicSelection } from '../../domain/entities/HeroEpicSelection'
import { decideEpicChange } from '../../domain/policies/EquipmentCombatLockPolicy'
import { parseEpicAttributes } from '../../domain/policies/hero-epic-effects'
import { PlayerId } from '../../domain/value-objects/identifiers'
import type { HeroEpicDto } from '../dto/HeroEpicDto'
import {
  EpicProductInvalidTypeError,
  EpicProductNotOwnedError,
  EquipmentLockedDuringBattleError,
} from '../errors/ApplicationError'
import type { BattleStatePort } from '../ports/BattleStatePort'
import type { CatalogReadPort } from '../ports/CatalogReadPort'
import type { HeroEpicSelectionRepositoryPort } from '../ports/HeroEpicSelectionRepositoryPort'
import type { ClockPort } from '../ports/ClockPort'
import type { InventoryQueryPort } from '../ports/InventoryQueryPort'
import { resolveHeroEpic } from './hero-profile-shared'
import { resolveOwnedHero } from './hero-equipment-shared'

export interface EquipEpicOnHeroCommand {
  readonly ownerId: string
  readonly heroReference: string
  readonly productReference: string
}

/**
 * Equipa (o reemplaza) la habilidad epica de un heroe propio (HU-31,
 * contrato `hu-31-equipped-epic-v1` §11).
 *
 * Mismo orden estricto que `EquipItemOnHero`: VALIDAR TODO -> CALCULAR ESTADO
 * RESULTANTE -> PERSISTIR DE FORMA CONSISTENTE -> RESPONDER. NO reabre HU-28:
 * la epica se persiste en `HeroEpicSelection`, un agregado HERMANO de
 * `HeroLoadout`, nunca en sus ranuras.
 *
 * A DIFERENCIA de `EquipItemOnHero`, NO rechaza por incompatibilidad de
 * subtipo (`EquipmentHeroIncompatibleError`): una epica cuyo
 * `compatibleHeroSubtype` no coincide con el heroe es una seleccion VALIDA
 * (CA-05 de HU-31) -- solo el efecto especifico queda sin aplicar, el
 * general se conserva. Rechazar aqui por esa razon inventaria una regla que
 * ninguna fuente formal exige.
 */
export class EquipEpicOnHero {
  constructor(
    private readonly inventories: InventoryQueryPort,
    private readonly catalog: CatalogReadPort,
    private readonly epicSelections: HeroEpicSelectionRepositoryPort,
    private readonly clock: ClockPort,
    private readonly battles: BattleStatePort,
  ) {}

  async execute(command: EquipEpicOnHeroCommand): Promise<HeroEpicDto> {
    const owner = PlayerId.create(command.ownerId)
    const productReference = command.productReference.trim()
    const deps = { inventories: this.inventories, catalog: this.catalog }

    // 1. El heroe pertenece al jugador y es un HEROE canonico.
    const hero = await resolveOwnedHero(deps, owner, command.heroReference)
    const heroId = hero.heroProduct.productId

    // 2. HU-29 precede a TODA lectura y mutacion de la epica, mismo criterio
    // y mismo orden que `EquipItemOnHero`: despues de validar pertenencia del
    // heroe, para no convertir el estado de batalla en un canal de
    // enumeracion de heroes ajenos.
    const battleActive = await this.battles.isHeroInActiveBattle(owner, heroId)
    const decision = decideEpicChange(battleActive)
    if (!decision.ok) {
      throw new EquipmentLockedDuringBattleError(decision.message)
    }

    // 3. La epica pertenece al inventario del jugador.
    const owned = await this.inventories.findAllOwnedItems(owner)
    const ownedRefs = new Set(owned.map((item) => item.itemId))

    const product = await this.catalog.getByReference(productReference)
    if (product === null) {
      throw new EpicProductNotOwnedError(productReference)
    }
    const ownedItemId = ownedRefs.has(productReference)
      ? productReference
      : ownedRefs.has(product.sku)
        ? product.sku
        : null
    if (ownedItemId === null) {
      throw new EpicProductNotOwnedError(productReference)
    }

    // 4. El tipo del producto es EPICA, y su definicion cumple el contrato
    // canonico (si no, se rechaza aqui en vez de equipar algo que luego
    // `equipped-hero` tendria que omitir en silencio).
    if (product.type !== 'EPICA') {
      throw new EpicProductInvalidTypeError(productReference, product.type)
    }
    parseEpicAttributes(product.attributes)

    // 5. Estado resultante: reemplaza directamente la seleccion anterior
    // (contrato §3): no hay "ranura ocupada" que rechazar.
    const selection =
      (await this.epicSelections.findByHero(owner, heroId)) ??
      HeroEpicSelection.createEmpty(owner.value, heroId)
    const expectedVersion = selection.version

    selection.equip({
      epicItemId: ownedItemId,
      epicProductId: product.productId,
      occurredAt: this.clock.now(),
    })

    // 6. Persistencia atomica con bloqueo optimista (lanza HeroEpicSelectionConflictError).
    const saved = await this.epicSelections.save(selection, expectedVersion)

    // 7. Vista resuelta, lista para refrescar la interfaz.
    const epic = await resolveHeroEpic(this.catalog, hero.heroView.heroSubtype, {
      epicProductId: product.productId,
    })

    return { heroId, epic, version: saved.version, locked: false }
  }
}
