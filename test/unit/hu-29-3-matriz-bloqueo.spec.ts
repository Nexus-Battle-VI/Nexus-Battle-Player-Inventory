import { ConflictException, NotFoundException } from '@nestjs/common'

import { EquipItemOnHero } from '../../src/application/use-cases/EquipItemOnHero'
import { GetHeroEquipment } from '../../src/application/use-cases/GetHeroEquipment'
import { InMemoryHeroLoadoutRepository } from '../../src/adapters/outbound/persistence/InMemoryHeroLoadoutRepository'
import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import { HeroEquipmentController } from '../../src/adapters/inbound/http/hero-equipment.controller'
import type { CatalogProductView } from '../../src/application/ports/CatalogReadPort'
import type {
  InventoryQueryPort,
  OwnedInventoryItem,
  OwnedInventoryItemsSlice,
} from '../../src/application/ports/InventoryQueryPort'
import type { ClockPort } from '../../src/application/ports/ClockPort'
import type { HeroEquipmentDto } from '../../src/application/dto/HeroEquipmentDto'
import type { VerifiedIdentity } from '../../src/application/ports/TokenVerifierPort'
import { Role } from '../../src/application/ports/TokenVerifierPort'
import {
  EquipmentLockedDuringBattleError,
  EquipmentProductNotOwnedError,
  HeroNotOwnedError,
} from '../../src/application/errors/ApplicationError'
import { BATTLE_LOCK_MESSAGE } from '../../src/domain/policies/EquipmentCombatLockPolicy'
import type { PlayerId } from '../../src/domain/value-objects/identifiers'
import type { Logger, LogContext } from '../../src/infrastructure/observability/logger'
import { battleStateKit, type BattleStateKit } from '../fixtures/battle-state'

/**
 * HU-29.3 (Task #233): **matriz del bloqueo de equipamiento**, con el registro.
 *
 * Los tres casos de la Task, sobre el MISMO heroe y los MISMOS productos, de modo
 * que lo unico que cambia entre ellos sea el estado de la batalla:
 *
 * | # | Caso | Esperado |
 * | --- | --- | --- |
 * | P1 | fuera de batalla | la mutacion pasa (`ok true`) y se delega en HU-28 |
 * | P2 | en batalla | `ok false` con `reason: battle_lock` y el equipo **igual** |
 * | P3 | fin de batalla | el lock se libera |
 *
 * Dos decisiones que hacen que esta suite pruebe algo que las demas no prueban:
 *
 * 1. **El estado de batalla NO se simula con un doble.** Empezar una batalla es
 *    **comprometer** al heroe y terminarla es **liberarlo**, que es exactamente lo
 *    que hace Combat por la ruta interna (`test/fixtures/battle-state.ts`). Un
 *    atajo que marcara el estado sin pasar por el compromiso probaria un camino
 *    que en produccion no existe.
 * 2. **P2 compara el estado ANTES y DESPUES**, no se conforma con «no se creo el
 *    loadout»: el heroe llega a la batalla **ya equipado**, que es el caso real, y
 *    lo que hay que demostrar es que el equipo no se mueve ni un campo.
 *
 * El registro (`equipment_change_rejected` / `equipment_change_applied`) se
 * comprueba en el controlador, que es quien lo emite, sin levantar el modulo Nest.
 */

const OWNER = 'sujeto-jugador'
const HERO_SKU = 'guerrero-tanque'
const HERO_ID = `pid-${HERO_SKU}`
const SWORD = 'espada-de-fuego'
const AXE = 'hacha-de-guerra'
const AT = new Date('2026-09-24T12:00:00.000Z')

/** Reloj movible: la caducidad del compromiso no se puede probar con un reloj fijo. */
const mutableClock = (initial: Date): { now: () => Date; advance: (ms: number) => void } => {
  let current = initial

  return {
    now: () => current,
    advance: (ms) => {
      current = new Date(current.getTime() + ms)
    },
  }
}

class FakeInventoryQuery implements InventoryQueryPort {
  constructor(private readonly owned: readonly string[]) {}

  listOwnedItems(): Promise<OwnedInventoryItemsSlice> {
    return Promise.resolve({ items: [], totalItems: 0 })
  }

  findAllOwnedItems(): Promise<readonly OwnedInventoryItem[]> {
    return Promise.resolve(this.owned.map((itemId) => ({ itemId, quantity: 1 })))
  }

  findOwnersOfProduct(): Promise<readonly string[]> {
    return Promise.resolve([])
  }
}

const hero = (): CatalogProductView => ({
  productId: HERO_ID,
  sku: HERO_SKU,
  name: 'Guerrero Tanque',
  imageUrl: 'https://assets.example.test/guerrero-tanque.png',
  description: 'Heroe',
  type: 'HEROE',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 0,
  premium: false,
  realMoneyPrice: null,
  attributes: {
    schemaVersion: '1',
    values: {
      kind: 'HEROE',
      heroSubtype: 'GUERRERO_TANQUE',
      basePower: 5,
      baseHealth: 40,
      baseDefense: 8,
      baseAttack: { mode: 'FIXED', amount: 10 },
      baseDamage: { mode: 'FIXED', amount: 4 },
      abilities: ['a', 'b', 'c'],
    },
  },
})

const weapon = (sku: string, amount: number): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name: sku,
  imageUrl: `https://assets.example.test/${sku}.png`,
  description: sku,
  type: 'ARMA',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 10,
  premium: false,
  realMoneyPrice: null,
  attributes: {
    schemaVersion: '1',
    values: {
      kind: 'ARMA',
      compatibilityScope: 'ALL_HEROES',
      effects: [
        {
          kind: 'STAT_MODIFIER',
          target: 'SELF',
          statistic: 'ATTACK',
          operation: 'INCREASE',
          magnitude: { mode: 'FIXED', amount },
        },
      ],
    },
  },
})

interface Kit {
  readonly equip: EquipItemOnHero
  readonly get: GetHeroEquipment
  readonly loadouts: InMemoryHeroLoadoutRepository
  readonly battles: BattleStateKit
}

const buildKit = (
  owned: readonly string[] = [HERO_SKU, SWORD, AXE],
  clock: ClockPort = { now: () => AT },
): Kit => {
  const inventories = new FakeInventoryQuery(owned)
  const catalog = new InMemoryCatalogReadClient([hero(), weapon(SWORD, 1), weapon(AXE, 3)], false)
  const loadouts = new InMemoryHeroLoadoutRepository()
  const battles = battleStateKit(clock)

  return {
    equip: new EquipItemOnHero(inventories, catalog, loadouts, clock, battles.state),
    get: new GetHeroEquipment(inventories, catalog, loadouts, battles.state),
    loadouts,
    battles,
  }
}

const equip = (kit: Kit, slot: string, sku: string): Promise<HeroEquipmentDto> =>
  kit.equip.execute({
    ownerId: OWNER,
    heroReference: HERO_SKU,
    slot,
    productReference: sku,
  })

describe('HU-29.3 — matriz P1/P2/P3 del bloqueo de equipamiento', () => {
  it('P1 fuera de batalla: la mutacion pasa (ok true) y la lectura publica locked=false', async () => {
    const kit = buildKit()

    const applied = await equip(kit, 'WEAPON_1', SWORD)

    expect(applied.equipment.weapons.map((weapon) => weapon.itemId)).toEqual([SWORD])
    expect(applied.locked).toBe(false)
    await expect(kit.get.execute(OWNER, HERO_SKU)).resolves.toMatchObject({ locked: false })
  })

  it('P1 fuera de batalla: se DELEGA en HU-28, no se responde «bloqueado» a todo', async () => {
    // Sin batalla, las reglas que aplican son las de HU-28: un producto que no es
    // del jugador sigue siendo 404. Si el guard respondiera `battle_lock` por
    // defecto, esto lo delataria.
    const kit = buildKit([HERO_SKU, SWORD])

    await expect(equip(kit, 'WEAPON_1', AXE)).rejects.toBeInstanceOf(EquipmentProductNotOwnedError)
    await expect(kit.get.execute(OWNER, 'heroe-ajeno')).rejects.toBeInstanceOf(HeroNotOwnedError)
  })

  it('P2 en batalla: rechaza con `reason: battle_lock` y el equipo queda EXACTAMENTE igual', async () => {
    const kit = buildKit()

    // El heroe llega a la batalla YA equipado: es el caso real y el unico en el
    // que «el equipo queda igual» significa algo.
    await equip(kit, 'WEAPON_1', SWORD)
    await kit.battles.startBattle(OWNER, HERO_ID)

    const during = await kit.get.execute(OWNER, HERO_SKU)
    const versionBefore = (await kit.loadouts.findByHero({ value: OWNER } as PlayerId, HERO_ID))
      ?.version

    expect(during.locked).toBe(true)

    await expect(equip(kit, 'WEAPON_2', AXE)).rejects.toMatchObject({
      name: 'EquipmentLockedDuringBattleError',
      reason: 'battle_lock',
      message: BATTLE_LOCK_MESSAGE,
    })

    const after = await kit.get.execute(OWNER, HERO_SKU)
    const versionAfter = (await kit.loadouts.findByHero({ value: OWNER } as PlayerId, HERO_ID))
      ?.version

    // El estado completo, campo por campo: equipo, estadisticas efectivas, deltas
    // y efectos. No basta con «no se creo el loadout».
    expect(after).toEqual(during)
    expect(versionAfter).toBe(versionBefore)
  })

  it('P3 fin de batalla: el lock se libera y el MISMO cambio que se rechazo ahora pasa', async () => {
    const kit = buildKit()

    await kit.battles.startBattle(OWNER, HERO_ID)

    const attempt = (): Promise<HeroEquipmentDto> => equip(kit, 'WEAPON_1', AXE)

    await expect(attempt()).rejects.toMatchObject({ reason: 'battle_lock' })

    await kit.battles.finishBattle(OWNER, HERO_ID)

    const applied = await attempt()

    expect(applied.equipment.weapons.map((weapon) => weapon.itemId)).toEqual([AXE])
    expect(applied.locked).toBe(false)
    await expect(kit.get.execute(OWNER, HERO_SKU)).resolves.toMatchObject({ locked: false })
  })

  it('P3 (red de seguridad): un compromiso VENCIDO deja de bloquear sin que nadie lo libere', async () => {
    // Es la red que impide un bloqueo permanente si la liberacion se pierde. La
    // duracion la fija quien compromete: aqui, una hora.
    const clock = mutableClock(AT)
    const kit = buildKit([HERO_SKU, SWORD, AXE], clock)

    await kit.battles.startBattle(OWNER, HERO_ID)
    await expect(equip(kit, 'WEAPON_1', AXE)).rejects.toMatchObject({ reason: 'battle_lock' })

    clock.advance(3_600_000 + 1)

    const applied = await equip(kit, 'WEAPON_1', AXE)

    expect(applied.equipment.weapons.map((weapon) => weapon.itemId)).toEqual([AXE])
    expect(applied.locked).toBe(false)
  })
})

/**
 * El registro del §«Test + log» de la Task, en el punto que lo emite: el
 * controlador. Se instancia DIRECTO, con dobles de los casos de uso, porque lo
 * que se comprueba es la decision de registrar, no el resto del modulo.
 */
describe('HU-29.3 — registro del bloqueo (controlador)', () => {
  interface LogLine {
    readonly level: string
    readonly message: string
    readonly context: LogContext | undefined
  }

  const recordingLogger = (): { logger: Logger; lines: LogLine[] } => {
    const lines: LogLine[] = []
    const record =
      (level: string) =>
      (message: string, context?: LogContext): void => {
        lines.push({ level, message, context })
      }

    return {
      lines,
      logger: {
        debug: record('debug'),
        info: record('info'),
        warn: record('warn'),
        error: record('error'),
      },
    }
  }

  const identity: VerifiedIdentity = {
    subject: OWNER,
    email: 'jugador@example.test',
    roles: new Set([Role.Player]),
  }

  const view = { locked: false } as HeroEquipmentDto

  const controllerWith = (
    equipResult: Promise<HeroEquipmentDto>,
  ): {
    controller: HeroEquipmentController
    lines: LogLine[]
  } => {
    const { logger, lines } = recordingLogger()
    const equipItemOnHero = { execute: () => equipResult } as unknown as EquipItemOnHero
    const getHeroEquipment = { execute: () => Promise.resolve(view) } as unknown as GetHeroEquipment

    return {
      controller: new HeroEquipmentController(getHeroEquipment, equipItemOnHero, logger),
      lines,
    }
  }

  it('registra el rechazo con `reason: battle_lock` y responde 409 con el cuerpo del contrato', async () => {
    const { controller, lines } = controllerWith(
      Promise.reject(new EquipmentLockedDuringBattleError(BATTLE_LOCK_MESSAGE)),
    )

    const error: unknown = await controller
      .equip(HERO_SKU, 'WEAPON_1', { productReference: SWORD }, identity)
      .catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ConflictException)
    expect((error as ConflictException).getStatus()).toBe(409)
    expect((error as ConflictException).getResponse()).toMatchObject({ reason: 'battle_lock' })
    expect(lines).toEqual([
      {
        level: 'warn',
        message: 'equipment_change_rejected',
        context: { reason: 'battle_lock', playerId: OWNER, heroId: HERO_SKU, slot: 'WEAPON_1' },
      },
    ])
  })

  it('registra el exito fuera de batalla: sin este evento no se distingue «no se intento» de «se intento y paso»', async () => {
    const { controller, lines } = controllerWith(Promise.resolve(view))

    await expect(
      controller.equip(HERO_SKU, 'WEAPON_1', { productReference: SWORD }, identity),
    ).resolves.toBe(view)

    expect(lines).toEqual([
      {
        level: 'info',
        message: 'equipment_change_applied',
        context: { playerId: OWNER, heroId: HERO_SKU, slot: 'WEAPON_1' },
      },
    ])
  })

  it('un rechazo que NO es el bloqueo no se registra como bloqueo', async () => {
    // Si cualquier fallo se registrara como `equipment_change_rejected`, el
    // registro dejaria de servir para medir el bloqueo.
    const { controller, lines } = controllerWith(
      Promise.reject(new EquipmentProductNotOwnedError(SWORD)),
    )

    const error: unknown = await controller
      .equip(HERO_SKU, 'WEAPON_1', { productReference: SWORD }, identity)
      .catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(NotFoundException)
    expect(lines).toEqual([])
  })
})
