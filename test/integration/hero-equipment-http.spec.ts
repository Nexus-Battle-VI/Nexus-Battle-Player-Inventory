import { randomUUID } from 'node:crypto'

import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import { LOGGER } from '../../src/infrastructure/observability/logger'
import {
  Role,
  TOKEN_VERIFIER,
  type TokenVerifierPort,
  type VerifiedIdentity,
} from '../../src/application/ports/TokenVerifierPort'
import { CATALOG_READ, type CatalogProductView } from '../../src/application/ports/CatalogReadPort'
import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import { InMemoryBattleHeroCommitmentRepository } from '../../src/adapters/outbound/persistence/InMemoryBattleHeroCommitmentRepository'
import { BATTLE_HERO_COMMITMENTS } from '../../src/application/ports/BattleHeroCommitmentPort'

/**
 * HU-28 sobre HTTP con autenticacion activa y un doble sembrado de Catalog.
 *
 * El token de prueba se toma como sujeto: cada prueba usa su propio inventario.
 */
const stubVerifier: TokenVerifierPort = {
  verify: (token: string): Promise<VerifiedIdentity> =>
    Promise.resolve({ subject: token, email: null, roles: new Set([Role.Player]) }),
}

const hero = (sku: string): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name: 'Guerrero Tanque',
  imageUrl: `https://assets.example.test/${sku}.png`,
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

const equippable = (
  sku: string,
  type: 'ARMA' | 'ARMADURA' | 'ITEM',
  extraValues: Record<string, unknown> = {},
): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name: sku,
  imageUrl: `https://assets.example.test/${sku}.png`,
  description: sku,
  type,
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 10,
  premium: false,
  realMoneyPrice: null,
  attributes: {
    schemaVersion: '1',
    values: {
      kind: type,
      compatibilityScope: 'ALL_HEROES',
      effects: [
        {
          kind: 'STAT_MODIFIER',
          target: 'SELF',
          statistic: 'ATTACK',
          operation: 'INCREASE',
          magnitude: { mode: 'FIXED', amount: 2 },
        },
      ],
      ...extraValues,
    },
  },
})

const CATALOG: CatalogProductView[] = [
  hero('guerrero-tanque'),
  equippable('espada-de-fuego', 'ARMA'),
  equippable('hacha-de-hielo', 'ARMA'),
  equippable('casco-de-acero', 'ARMADURA', { slot: 'HEAD' }),
  equippable('pocion-de-vida', 'ITEM'),
  equippable('orbe-de-manos-ardientes', 'ARMA', {
    compatibilityScope: 'SELECTED_SUBTYPES',
    compatibleHeroSubtypes: ['MAGO_FUEGO'],
  }),
]

describe('HU-28 — configuracion de equipamiento del heroe (HTTP)', () => {
  let app: INestApplication
  let previousEnv: Record<string, string | undefined>
  let battleStates: InMemoryBattleHeroCommitmentRepository
  /** Lo que el controlador registro: la evidencia que pide la Task HU-29.2. */
  let logged: { level: string; message: string; context: Record<string, unknown> }[]

  beforeAll(async () => {
    previousEnv = {
      AUTH_MODE: process.env.AUTH_MODE,
      COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID,
      COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
    }
    process.env.AUTH_MODE = 'jwt'
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_pruebas'
    process.env.COGNITO_CLIENT_ID = 'cliente-de-pruebas'

    logged = []
    const record =
      (level: string) =>
      (message: string, context: Record<string, unknown> = {}): void => {
        logged.push({ level, message, context })
      }
    const logger = {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    }

    battleStates = new InMemoryBattleHeroCommitmentRepository()
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(stubVerifier)
      .overrideProvider(CATALOG_READ)
      .useValue(new InMemoryCatalogReadClient(CATALOG))
      .overrideProvider(BATTLE_HERO_COMMITMENTS)
      .useValue(battleStates)
      .overrideProvider(LOGGER)
      .useValue(logger)
      .compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
  })

  afterAll(async () => {
    await app.close()
    for (const [key, value] of Object.entries(previousEnv)) {
      process.env[key] = value ?? ''
    }
  })

  const bearer = (token: string): string => `Bearer ${token}`

  /** La operacion con la que se comprometio a cada heroe, para poder liberarlo. */
  const battleOperations = new Map<string, string>()

  /**
   * Arranca una batalla como la arranca Combat: COMPROMETIENDO al heroe. No hay
   * atajo que marque el estado sin pasar por el compromiso, porque ese atajo
   * probaria un camino que en produccion no existe.
   */
  const commitBattle = async (subject: string, heroId: string): Promise<void> => {
    const operationId = randomUUID()

    await battleStates.commit(
      {
        operationId,
        playerId: subject,
        heroId,
        reference: 'room_prueba',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
      new Date(),
    )
    battleOperations.set(`${subject}::${heroId}`, operationId)
  }

  const releaseBattle = async (subject: string, heroId: string): Promise<void> => {
    const operationId = battleOperations.get(`${subject}::${heroId}`)

    expect(operationId).toBeDefined()
    await battleStates.release(operationId ?? '')
    battleOperations.delete(`${subject}::${heroId}`)
  }

  const own = async (subject: string, itemId: string): Promise<void> => {
    const response = await request(app.getHttpServer())
      .post(`/api/inventories/${subject}/items`)
      .set('Authorization', bearer(subject))
      .send({ itemId, quantity: 1 })
    expect(response.status).toBe(200)
  }

  const getEquipment = (subject: string, heroId: string): request.Test =>
    request(app.getHttpServer())
      .get(`/api/inventories/me/heroes/${heroId}/equipment`)
      .set('Authorization', bearer(subject))

  const equip = (
    subject: string,
    heroId: string,
    slot: string,
    productReference: string,
  ): request.Test =>
    request(app.getHttpServer())
      .put(`/api/inventories/me/heroes/${heroId}/equipment/${slot}`)
      .set('Authorization', bearer(subject))
      .send({ productReference })

  const unequip = (subject: string, heroId: string, slot: string): request.Test =>
    request(app.getHttpServer())
      .delete(`/api/inventories/me/heroes/${heroId}/equipment/${slot}`)
      .set('Authorization', bearer(subject))

  it('sin testimonio responde 401', async () => {
    await request(app.getHttpServer())
      .get('/api/inventories/me/heroes/guerrero-tanque/equipment')
      .expect(401)
  })

  it('GET del heroe propio devuelve diez ranuras vacias y estadisticas base', async () => {
    await own('s-get', 'guerrero-tanque')

    const response = await getEquipment('s-get', 'guerrero-tanque')

    expect(response.status).toBe(200)
    expect(response.body.hero.subtype).toBe('GUERRERO_TANQUE')
    expect(response.body.equipment.weapons).toEqual([])
    expect(response.body.baseStats).toMatchObject({ attack: 10, defense: 8, health: 40 })
    expect(response.body.effectiveStats).toEqual(response.body.baseStats)
  })

  it('GET de un heroe que el jugador no posee responde 404 (anti-enumeracion)', async () => {
    await getEquipment('s-ajeno', 'guerrero-tanque').expect(404)
  })

  it('CA-01 + CA-09: equipar un arma propia persiste y la lectura posterior lo refleja', async () => {
    await own('s-equipa', 'guerrero-tanque')
    await own('s-equipa', 'espada-de-fuego')

    const put = await equip('s-equipa', 'guerrero-tanque', 'WEAPON_1', 'espada-de-fuego')
    expect(put.status).toBe(200)
    expect(put.body.equipment.weapons[0]).toMatchObject({
      itemId: 'espada-de-fuego',
      slot: 'WEAPON_1',
    })
    expect(put.body.effectiveStats.attack).toBe(12)

    const after = await getEquipment('s-equipa', 'guerrero-tanque')
    expect(after.body.equipment.weapons[0].itemId).toBe('espada-de-fuego')
    expect(after.body.effectiveStats.attack).toBe(12)
  })

  it('CA-07: un arma en la ranura del casco responde 422', async () => {
    await own('s-slot', 'guerrero-tanque')
    await own('s-slot', 'espada-de-fuego')

    await equip('s-slot', 'guerrero-tanque', 'HELMET', 'espada-de-fuego').expect(422)
  })

  it('un arma exclusiva de otro heroe responde 422 y NO la equipa', async () => {
    await own('s-incompat', 'guerrero-tanque')
    await own('s-incompat', 'orbe-de-manos-ardientes')

    await equip('s-incompat', 'guerrero-tanque', 'WEAPON_1', 'orbe-de-manos-ardientes').expect(422)

    const state = await getEquipment('s-incompat', 'guerrero-tanque')
    expect(state.body.equipment.weapons).toEqual([])
  })

  it('una ranura ocupada responde 409 y NO reemplaza (backend es autoridad)', async () => {
    await own('s-occ', 'guerrero-tanque')
    await own('s-occ', 'espada-de-fuego')
    await own('s-occ', 'hacha-de-hielo')

    await equip('s-occ', 'guerrero-tanque', 'WEAPON_1', 'espada-de-fuego').expect(200)
    await equip('s-occ', 'guerrero-tanque', 'WEAPON_1', 'hacha-de-hielo').expect(409)

    const state = await getEquipment('s-occ', 'guerrero-tanque')
    expect(state.body.equipment.weapons[0].itemId).toBe('espada-de-fuego')
  })

  it('CA-05: equipar un producto que no esta en el inventario responde 404', async () => {
    await own('s-prod', 'guerrero-tanque')

    await equip('s-prod', 'guerrero-tanque', 'WEAPON_1', 'espada-de-fuego').expect(404)
  })

  it('una ranura inexistente responde 400', async () => {
    await own('s-badslot', 'guerrero-tanque')
    await own('s-badslot', 'espada-de-fuego')

    await equip('s-badslot', 'guerrero-tanque', 'ANILLO_1', 'espada-de-fuego').expect(400)
  })

  it.each([
    ['weapon', 'WEAPON_1', 'espada-de-fuego'] as const,
    ['armor', 'HELMET', 'casco-de-acero'] as const,
    ['item', 'ITEM_1', 'pocion-de-vida'] as const,
  ])(
    'HU-29: batalla activa bloquea %s con 409 y deja el loadout intacto',
    async (kind, slot, sku) => {
      const subject = `s-battle-${kind}`
      await own(subject, 'guerrero-tanque')
      await own(subject, sku)
      await commitBattle(subject, 'pid-guerrero-tanque')

      const blocked = await equip(subject, 'guerrero-tanque', slot, sku)
      expect(blocked.status).toBe(409)
      expect(blocked.body).toMatchObject({
        reason: 'battle_lock',
        message: expect.stringMatching(/batalla activa/),
      })

      // La lectura publica el mismo dato, para que la interfaz deshabilite sin
      // reimplementar la regla.
      const after = await getEquipment(subject, 'guerrero-tanque')
      expect(after.status).toBe(200)
      expect(after.body.locked).toBe(true)
      expect(after.body.equipment.weapons).toEqual([])
      expect(after.body.equipment.items).toEqual([])
      expect(Object.values(after.body.equipment.armor).every((value) => value === null)).toBe(true)
    },
  )

  it('HU-29: el rechazo y el exito quedan registrados', async () => {
    const subject = 's-battle-log'
    await own(subject, 'guerrero-tanque')
    await own(subject, 'espada-de-fuego')

    logged.length = 0
    await commitBattle(subject, 'pid-guerrero-tanque')
    await equip(subject, 'guerrero-tanque', 'WEAPON_1', 'espada-de-fuego').expect(409)

    expect(logged).toContainEqual({
      level: 'warn',
      message: 'equipment_change_rejected',
      context: {
        reason: 'battle_lock',
        playerId: subject,
        heroId: 'guerrero-tanque',
        slot: 'WEAPON_1',
      },
    })

    await releaseBattle(subject, 'pid-guerrero-tanque')
    logged.length = 0
    await equip(subject, 'guerrero-tanque', 'WEAPON_1', 'espada-de-fuego').expect(200)

    // El exito fuera de batalla tambien se registra: sin el, no se podria
    // distinguir «no se intento» de «se intento y paso».
    expect(logged).toContainEqual({
      level: 'info',
      message: 'equipment_change_applied',
      context: { playerId: subject, heroId: 'guerrero-tanque', slot: 'WEAPON_1' },
    })
  })

  it('HU-29: dos intentos seguidos en batalla no acumulan ningun cambio', async () => {
    const subject = 's-battle-twice'
    await own(subject, 'guerrero-tanque')
    await own(subject, 'espada-de-fuego')
    await commitBattle(subject, 'pid-guerrero-tanque')

    await equip(subject, 'guerrero-tanque', 'WEAPON_1', 'espada-de-fuego').expect(409)
    await equip(subject, 'guerrero-tanque', 'WEAPON_1', 'espada-de-fuego').expect(409)

    const after = await getEquipment(subject, 'guerrero-tanque')

    expect(after.body.locked).toBe(true)
    expect(after.body.equipment.weapons).toEqual([])
  })

  it('HU-29: al terminar la batalla, la lectura deja de estar bloqueada', async () => {
    const subject = 's-battle-unlocked'
    await own(subject, 'guerrero-tanque')
    await commitBattle(subject, 'pid-guerrero-tanque')

    expect((await getEquipment(subject, 'guerrero-tanque')).body.locked).toBe(true)

    await releaseBattle(subject, 'pid-guerrero-tanque')

    expect((await getEquipment(subject, 'guerrero-tanque')).body.locked).toBe(false)
  })

  it('HU-29: al finalizar la batalla libera el flujo normal de HU-28', async () => {
    const subject = 's-battle-finished'
    await own(subject, 'guerrero-tanque')
    await own(subject, 'espada-de-fuego')
    await commitBattle(subject, 'pid-guerrero-tanque')
    await equip(subject, 'guerrero-tanque', 'WEAPON_1', 'espada-de-fuego').expect(409)

    await releaseBattle(subject, 'pid-guerrero-tanque')
    const allowed = await equip(subject, 'guerrero-tanque', 'WEAPON_1', 'espada-de-fuego')

    expect(allowed.status).toBe(200)
    expect(allowed.body.equipment.weapons[0]).toMatchObject({
      slot: 'WEAPON_1',
      itemId: 'espada-de-fuego',
    })
  })

  it('regresion HU-27: el listado del inventario propio sigue respondiendo', async () => {
    await own('s-reg', 'guerrero-tanque')

    const response = await request(app.getHttpServer())
      .get('/api/inventories/me/items')
      .set('Authorization', bearer('s-reg'))

    expect(response.status).toBe(200)
    expect(response.body.pageSize).toBe(16)
  })

  describe('HU-28.4 — desequipar', () => {
    it.each([
      ['weapon', 'WEAPON_1', 'espada-de-fuego'] as const,
      ['armor', 'HELMET', 'casco-de-acero'] as const,
      ['item', 'ITEM_1', 'pocion-de-vida'] as const,
    ])(
      'desequipa %s: la ranura queda vacia y el producto sigue en el inventario',
      async (kind, slot, sku) => {
        const subject = `s-unequip-${kind}`
        await own(subject, 'guerrero-tanque')
        await own(subject, sku)
        await equip(subject, 'guerrero-tanque', slot, sku).expect(200)

        const del = await unequip(subject, 'guerrero-tanque', slot)
        expect(del.status).toBe(200)

        const after = await getEquipment(subject, 'guerrero-tanque')
        if (slot.startsWith('WEAPON')) {
          expect(after.body.equipment.weapons).toEqual([])
        } else if (slot.startsWith('ITEM')) {
          expect(after.body.equipment.items).toEqual([])
        } else {
          expect(after.body.equipment.armor[slot]).toBeNull()
        }

        // El producto sigue siendo del jugador: una nueva consulta del inventario
        // propio lo sigue mostrando (este caso de uso solo borra la asociacion,
        // nunca el objeto).
        const owned = await request(app.getHttpServer())
          .get('/api/inventories/me/items')
          .set('Authorization', bearer(subject))
        expect(owned.status).toBe(200)
        expect((owned.body.items as { itemId: string }[]).some((it) => it.itemId === sku)).toBe(
          true,
        )
      },
    )

    it('recalcula las estadisticas efectivas al desequipar', async () => {
      const subject = 's-unequip-stats'
      await own(subject, 'guerrero-tanque')
      await own(subject, 'espada-de-fuego')
      const equipped = await equip(subject, 'guerrero-tanque', 'WEAPON_1', 'espada-de-fuego')
      expect(equipped.body.effectiveStats.attack).toBe(12)

      const after = await unequip(subject, 'guerrero-tanque', 'WEAPON_1')
      expect(after.status).toBe(200)
      expect(after.body.effectiveStats.attack).toBe(after.body.baseStats.attack)
    })

    it('el efecto cuyo origen es la pieza removida desaparece; otros efectos permanecen', async () => {
      const subject = 's-unequip-effects'
      await own(subject, 'guerrero-tanque')
      await own(subject, 'espada-de-fuego')
      await own(subject, 'casco-de-acero')
      await equip(subject, 'guerrero-tanque', 'WEAPON_1', 'espada-de-fuego')
      await equip(subject, 'guerrero-tanque', 'HELMET', 'casco-de-acero')

      const after = await unequip(subject, 'guerrero-tanque', 'WEAPON_1')
      const sources = (after.body.activeEffects as { sourceSlot: string }[]).map(
        (effect) => effect.sourceSlot,
      )
      expect(sources).not.toContain('WEAPON_1')
      expect(sources).toContain('HELMET')
    })

    it('la capacidad decrementa tras desequipar', async () => {
      const subject = 's-unequip-capacity'
      await own(subject, 'guerrero-tanque')
      await own(subject, 'casco-de-acero')
      await equip(subject, 'guerrero-tanque', 'HELMET', 'casco-de-acero')

      const occupied = await getEquipment(subject, 'guerrero-tanque')
      const usedBefore = Object.values(
        occupied.body.equipment.armor as Record<string, unknown>,
      ).filter((v) => v !== null).length
      expect(usedBefore).toBe(1)

      await unequip(subject, 'guerrero-tanque', 'HELMET')
      const after = await getEquipment(subject, 'guerrero-tanque')
      const usedAfter = Object.values(after.body.equipment.armor as Record<string, unknown>).filter(
        (v) => v !== null,
      ).length
      expect(usedAfter).toBe(0)
    })

    it('desequipar una ranura ya vacia responde 409 (nunca 500)', async () => {
      const subject = 's-unequip-empty'
      await own(subject, 'guerrero-tanque')

      await unequip(subject, 'guerrero-tanque', 'WEAPON_1').expect(409)
    })

    it('desequipar en un heroe ajeno responde 404', async () => {
      await unequip('s-unequip-ajeno', 'guerrero-tanque', 'WEAPON_1').expect(404)
    })

    it('desequipar una ranura invalida responde 400', async () => {
      const subject = 's-unequip-badslot'
      await own(subject, 'guerrero-tanque')

      await unequip(subject, 'guerrero-tanque', 'ANILLO_1').expect(400)
    })

    it('sin testimonio responde 401', async () => {
      await request(app.getHttpServer())
        .delete('/api/inventories/me/heroes/guerrero-tanque/equipment/WEAPON_1')
        .expect(401)
    })

    it('HU-29: batalla activa bloquea el desequipado con 409 y deja el loadout intacto', async () => {
      const subject = 's-unequip-battle'
      await own(subject, 'guerrero-tanque')
      await own(subject, 'espada-de-fuego')
      await equip(subject, 'guerrero-tanque', 'WEAPON_1', 'espada-de-fuego').expect(200)
      await commitBattle(subject, 'pid-guerrero-tanque')

      const blocked = await unequip(subject, 'guerrero-tanque', 'WEAPON_1')
      expect(blocked.status).toBe(409)
      expect(blocked.body).toMatchObject({ reason: 'battle_lock' })

      await releaseBattle(subject, 'pid-guerrero-tanque')
      const after = await getEquipment(subject, 'guerrero-tanque')
      expect(after.body.equipment.weapons[0].itemId).toBe('espada-de-fuego')
    })

    it('regresion: Equip sigue funcionando normalmente tras los cambios de Unequip', async () => {
      const subject = 's-unequip-regression'
      await own(subject, 'guerrero-tanque')
      await own(subject, 'espada-de-fuego')

      const put = await equip(subject, 'guerrero-tanque', 'WEAPON_1', 'espada-de-fuego')
      expect(put.status).toBe(200)
      expect(put.body.equipment.weapons[0]).toMatchObject({ itemId: 'espada-de-fuego' })
    })

    it('replacement: tras desequipar, la MISMA ranura admite una pieza distinta', async () => {
      const subject = 's-unequip-replace'
      await own(subject, 'guerrero-tanque')
      await own(subject, 'espada-de-fuego')
      await own(subject, 'hacha-de-hielo')
      await equip(subject, 'guerrero-tanque', 'WEAPON_1', 'espada-de-fuego').expect(200)

      await unequip(subject, 'guerrero-tanque', 'WEAPON_1').expect(200)
      const replaced = await equip(subject, 'guerrero-tanque', 'WEAPON_1', 'hacha-de-hielo')

      expect(replaced.status).toBe(200)
      expect(replaced.body.equipment.weapons[0]).toMatchObject({ itemId: 'hacha-de-hielo' })
    })
  })
})

describe('HU-28 — Catalog no disponible', () => {
  let app: INestApplication
  let previousEnv: Record<string, string | undefined>

  beforeAll(async () => {
    previousEnv = {
      AUTH_MODE: process.env.AUTH_MODE,
      COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID,
      COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
    }
    process.env.AUTH_MODE = 'jwt'
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_pruebas'
    process.env.COGNITO_CLIENT_ID = 'cliente-de-pruebas'

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(stubVerifier)
      .overrideProvider(CATALOG_READ)
      .useValue(new InMemoryCatalogReadClient([], true))
      .compile()

    app = moduleRef.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
  })

  afterAll(async () => {
    await app.close()
    for (const [key, value] of Object.entries(previousEnv)) {
      process.env[key] = value ?? ''
    }
  })

  it('GET del equipamiento responde 503 cuando Catalog no responde', async () => {
    await request(app.getHttpServer())
      .post('/api/inventories/s-503/items')
      .set('Authorization', `Bearer s-503`)
      .send({ itemId: 'guerrero-tanque', quantity: 1 })
      .expect(200)

    await request(app.getHttpServer())
      .get('/api/inventories/me/heroes/guerrero-tanque/equipment')
      .set('Authorization', `Bearer s-503`)
      .expect(503)
  })
})
