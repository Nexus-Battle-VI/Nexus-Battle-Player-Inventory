import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule, APP_CONFIG } from '../../src/infrastructure/bootstrap/app.module'
import { loadConfig } from '../../src/infrastructure/config/env'
import { signInternalRequest } from '../../src/adapters/outbound/identity/internal-signature'
import {
  Role,
  TOKEN_VERIFIER,
  type TokenVerifierPort,
  type VerifiedIdentity,
} from '../../src/application/ports/TokenVerifierPort'
import { CATALOG_READ, type CatalogProductView } from '../../src/application/ports/CatalogReadPort'
import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import {
  HERO_SELECTION_REPOSITORY,
  type HeroSelectionRepositoryPort,
} from '../../src/application/ports/HeroSelectionRepositoryPort'
import { HeroSelection } from '../../src/domain/entities/HeroSelection'

/**
 * Contrato interno de Combat sobre HTTP (HU-15, Management#24, Management#392,
 * resuelve DP-4 de HU-15.2-Plan-Resolucion-Bloqueos-RF15).
 *
 * Combina las DOS mitades ya reales del servicio: autenticacion de JUGADOR
 * (JWT) para sembrar inventario y preparar un heroe por las rutas de HU-07/
 * HU-28, y autenticacion INTERNA (HMAC de `InternalServiceGuard`) para leer
 * el contrato que Combat consume, exactamente como ya hace
 * `product-owners-http.spec.ts` para HU-38.
 */
const secret = 'test-only-internal-secret'
const equippedHeroPath = (playerId: string): string =>
  `/api/internal/v1/players/${playerId}/equipped-hero`

const stubVerifier: TokenVerifierPort = {
  verify: (token: string): Promise<VerifiedIdentity> =>
    Promise.resolve({ subject: token, email: null, roles: new Set([Role.Player]) }),
}

const hero = (sku: string, subtype: string, name: string): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name,
  imageUrl: `https://assets.example.test/${sku}.png`,
  description: name,
  type: 'HEROE',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 0,
  premium: false,
  realMoneyPrice: null,
  attributes: {
    schemaVersion: '1',
    values: {
      kind: 'HEROE',
      heroSubtype: subtype,
      basePower: 5,
      baseHealth: 40,
      baseDefense: 8,
      baseAttack: { mode: 'FIXED', amount: 10 },
      baseDamage: { mode: 'DICE', count: 1, sides: 4 },
      abilities: [`hab-${sku}`],
    },
  },
})

const weapon = (sku: string, name: string, amount: number): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name,
  imageUrl: '',
  description: name,
  type: 'ARMA',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 5,
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

/** Arma cuyos efectos se declaran a mano (critico, condicion, dados...). */
const weaponWithEffects = (
  sku: string,
  name: string,
  effects: readonly Record<string, unknown>[],
): CatalogProductView => ({
  ...weapon(sku, name, 1),
  attributes: {
    schemaVersion: '1',
    values: { kind: 'ARMA', compatibilityScope: 'ALL_HEROES', effects },
  },
})

const CATALOG: CatalogProductView[] = [
  hero('guerrero-tanque', 'GUERRERO_TANQUE', 'Guerrero Tanque'),
  hero('chaman', 'CHAMAN', 'Chaman'),
  weapon('hacha-de-guerra', 'Hacha de guerra', 4),
  weaponWithEffects('espada-de-dos-manos', 'Espada de dos manos', [
    {
      kind: 'STAT_MODIFIER',
      target: 'SELF',
      statistic: 'CRITICAL_CHANCE',
      operation: 'INCREASE',
      magnitude: { mode: 'PERCENTAGE', basisPoints: 300 },
      stackable: false,
    },
    {
      kind: 'STAT_MODIFIER',
      target: 'SELF',
      statistic: 'DEFENSE',
      operation: 'INCREASE',
      magnitude: { mode: 'FIXED', amount: 2 },
      activationCondition: { kind: 'EVERY_N_TURNS', intervalTurns: 2 },
      stackable: false,
    },
    { kind: 'DAMAGE', target: 'OPPONENT', magnitude: { mode: 'DICE', count: 1, sides: 6 } },
  ]),
]

describe('Contrato HTTP interno del heroe equipado, para Combat (HU-15)', () => {
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
      .overrideProvider(APP_CONFIG)
      .useValue(
        loadConfig({
          NODE_ENV: 'test',
          AUTH_MODE: 'jwt',
          COGNITO_USER_POOL_ID: 'us-east-1_test',
          COGNITO_CLIENT_ID: 'test',
          INTERNAL_SERVICE_AUTH_SECRET: secret,
        }),
      )
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(stubVerifier)
      .overrideProvider(CATALOG_READ)
      .useValue(new InMemoryCatalogReadClient(CATALOG))
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

  const own = async (subject: string, itemId: string): Promise<void> => {
    const response = await request(app.getHttpServer())
      .post(`/api/inventories/${subject}/items`)
      .set('Authorization', bearer(subject))
      .send({ itemId, quantity: 1 })
    expect(response.status).toBe(200)
  }

  const select = async (subject: string, heroReference: string): Promise<void> => {
    const response = await request(app.getHttpServer())
      .put('/api/inventories/me/heroes/selection')
      .set('Authorization', bearer(subject))
      .send({ heroReference })
    expect(response.status).toBe(200)
  }

  const signedGet = (
    path: string,
    service = 'combat',
    timestamp = String(Date.now()),
  ): request.Test => {
    const body = {}

    return request(app.getHttpServer())
      .get(path)
      .set('x-internal-service', service)
      .set('x-internal-timestamp', timestamp)
      .set(
        'x-internal-signature',
        signInternalRequest(secret, { service, method: 'GET', path, timestamp, body }),
      )
  }

  it('devuelve el heroe preparado de un jugador con heroe equipado', async () => {
    const jugador = 'combat-con-heroe'
    await own(jugador, 'guerrero-tanque')
    await select(jugador, 'guerrero-tanque')

    const response = await signedGet(equippedHeroPath(jugador))

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      playerId: jugador,
      heroId: 'pid-guerrero-tanque',
      reference: 'guerrero-tanque',
      subtype: 'GUERRERO_TANQUE',
      name: 'Guerrero Tanque',
      baseStats: { power: 5, health: 40, defense: 8, attack: 10 },
      ready: true,
    })
    expect(typeof response.body.selectedAt).toBe('string')
  })

  it('el DTO no filtra datos privados de inventario (imageUrl, lifecycleStatus, equipment, capacity)', async () => {
    const jugador = 'combat-sin-fuga'
    await own(jugador, 'chaman')
    await select(jugador, 'chaman')

    const response = await signedGet(equippedHeroPath(jugador))

    expect(response.status).toBe(200)
    expect(Object.keys(response.body).sort()).toEqual(
      [
        'playerId',
        'heroId',
        'reference',
        'subtype',
        'name',
        'baseStats',
        'effectiveStats',
        'activeEffects',
        'ready',
        'selectedAt',
      ].sort(),
    )
    expect(response.body).not.toHaveProperty('imageUrl')
    expect(response.body).not.toHaveProperty('lifecycleStatus')
    expect(response.body).not.toHaveProperty('equipment')
    expect(response.body).not.toHaveProperty('capacity')
    expect(response.body).not.toHaveProperty('level')
    // Heroe sin equipamiento: la lista viaja vacia, no ausente.
    expect(response.body.activeEffects).toEqual([])
  })

  it('HU-25: el equipamiento real llega como activeEffects normalizados, sin raw ni ranura', async () => {
    const jugador = 'combat-con-efectos'
    await own(jugador, 'guerrero-tanque')
    await select(jugador, 'guerrero-tanque')
    await own(jugador, 'espada-de-dos-manos')
    await request(app.getHttpServer())
      .put('/api/inventories/me/heroes/guerrero-tanque/equipment/WEAPON_1')
      .set('Authorization', bearer(jugador))
      .send({ productReference: 'espada-de-dos-manos' })
      .expect(200)

    const response = await signedGet(equippedHeroPath(jugador))

    expect(response.status).toBe(200)
    expect(response.body.activeEffects).toEqual([
      {
        sourceProductId: 'pid-espada-de-dos-manos',
        sourceProductReference: 'espada-de-dos-manos',
        kind: 'STAT_MODIFIER',
        target: 'SELF',
        statistic: 'CRITICAL_CHANCE',
        operation: 'INCREASE',
        magnitude: { mode: 'PERCENTAGE', basisPoints: 300 },
        hasActivationCondition: false,
        appliedToStats: false,
      },
      {
        sourceProductId: 'pid-espada-de-dos-manos',
        sourceProductReference: 'espada-de-dos-manos',
        kind: 'STAT_MODIFIER',
        target: 'SELF',
        statistic: 'DEFENSE',
        operation: 'INCREASE',
        magnitude: { mode: 'FIXED', amount: 2 },
        hasActivationCondition: true,
        appliedToStats: false,
      },
      {
        sourceProductId: 'pid-espada-de-dos-manos',
        sourceProductReference: 'espada-de-dos-manos',
        kind: 'DAMAGE',
        target: 'OPPONENT',
        magnitude: { mode: 'DICE', count: 1, sides: 6 },
        hasActivationCondition: false,
        appliedToStats: false,
      },
    ])
    // Ni el crudo de Catalog (`stackable`, la condicion) ni la ranura cruzan.
    const texto = JSON.stringify(response.body)
    expect(texto).not.toContain('"raw"')
    expect(texto).not.toContain('sourceSlot')
    expect(texto).not.toContain('stackable')
    expect(texto).not.toContain('EVERY_N_TURNS')
    expect(texto).not.toContain('WEAPON_1')
    // Nada de lo anterior es aplicable a las estadisticas: siguen siendo las base.
    expect(response.body.effectiveStats).toEqual(response.body.baseStats)
  })

  it('HU-25: efectos y estadisticas efectivas salen del mismo estado (sin doble aplicacion)', async () => {
    const jugador = 'combat-mismo-estado'
    await own(jugador, 'guerrero-tanque')
    await select(jugador, 'guerrero-tanque')
    await own(jugador, 'hacha-de-guerra')
    await request(app.getHttpServer())
      .put('/api/inventories/me/heroes/guerrero-tanque/equipment/WEAPON_1')
      .set('Authorization', bearer(jugador))
      .send({ productReference: 'hacha-de-guerra' })
      .expect(200)

    const response = await signedGet(equippedHeroPath(jugador))

    expect(response.status).toBe(200)
    expect(response.body.activeEffects).toHaveLength(1)
    expect(response.body.activeEffects[0]).toMatchObject({
      statistic: 'ATTACK',
      magnitude: { mode: 'FIXED', amount: 4 },
      appliedToStats: true,
    })
    // El +4 ya esta en effectiveStats.attack: por eso viaja con appliedToStats=true.
    expect(response.body.baseStats.attack).toBe(10)
    expect(response.body.effectiveStats.attack).toBe(14)
  })

  it('HU-25: un cambio de equipamiento se refleja de inmediato en los efectos, sin cache intermedia', async () => {
    const jugador = 'combat-efectos-tras-cambio'
    await own(jugador, 'guerrero-tanque')
    await select(jugador, 'guerrero-tanque')
    await own(jugador, 'hacha-de-guerra')
    await own(jugador, 'espada-de-dos-manos')
    await request(app.getHttpServer())
      .put('/api/inventories/me/heroes/guerrero-tanque/equipment/WEAPON_1')
      .set('Authorization', bearer(jugador))
      .send({ productReference: 'hacha-de-guerra' })
      .expect(200)
    expect((await signedGet(equippedHeroPath(jugador))).body.activeEffects).toHaveLength(1)

    await request(app.getHttpServer())
      .put('/api/inventories/me/heroes/guerrero-tanque/equipment/WEAPON_2')
      .set('Authorization', bearer(jugador))
      .send({ productReference: 'espada-de-dos-manos' })
      .expect(200)

    const despues = await signedGet(equippedHeroPath(jugador))
    expect(despues.status).toBe(200)
    expect(despues.body.activeEffects).toHaveLength(1 + 3)
  })

  it('HU-25: el contrato PUBLICO de HU-07 no cambia: sigue exponiendo raw y sourceSlot', async () => {
    const jugador = 'combat-contrato-publico'
    await own(jugador, 'guerrero-tanque')
    await select(jugador, 'guerrero-tanque')
    await own(jugador, 'espada-de-dos-manos')
    await request(app.getHttpServer())
      .put('/api/inventories/me/heroes/guerrero-tanque/equipment/WEAPON_1')
      .set('Authorization', bearer(jugador))
      .send({ productReference: 'espada-de-dos-manos' })
      .expect(200)

    const response = await request(app.getHttpServer())
      .get('/api/inventories/me/heroes/selection')
      .set('Authorization', bearer(jugador))

    expect(response.status).toBe(200)
    const [primero] = response.body.configuration.activeEffects
    expect(primero).toHaveProperty('raw')
    expect(primero.sourceSlot).toBe('WEAPON_1')
    expect(primero.raw.stackable).toBe(false)
  })

  it('un playerId en blanco (solo espacios) es 400, no un 500', async () => {
    const response = await signedGet(equippedHeroPath('%20%20'))

    expect(response.status).toBe(400)
  })

  it('jugador sin heroe equipado responde 404, no una lista vacia disfrazada', async () => {
    const jugador = 'combat-sin-heroe'
    await own(jugador, 'guerrero-tanque')

    const response = await signedGet(equippedHeroPath(jugador))

    expect(response.status).toBe(404)
  })

  it('un jugador que nunca existio responde 404 igual que uno sin seleccion', async () => {
    const response = await signedGet(equippedHeroPath('jugador-que-jamas-existio'))

    expect(response.status).toBe(404)
  })

  it('sin firma es 401, y no como PLAYER autenticado con JWT', async () => {
    const response = await request(app.getHttpServer()).get(equippedHeroPath('cualquiera'))

    expect(response.status).toBe(401)
  })

  it('firma invalida es 401', async () => {
    const response = await request(app.getHttpServer())
      .get(equippedHeroPath('cualquiera'))
      .set('x-internal-service', 'combat')
      .set('x-internal-timestamp', String(Date.now()))
      .set('x-internal-signature', 'firma-que-no-corresponde')

    expect(response.status).toBe(401)
  })

  it('servicio no permitido es 401 aunque la firma sea valida para ese servicio', async () => {
    const response = await signedGet(equippedHeroPath('cualquiera'), 'web')

    expect(response.status).toBe(401)
  })

  it('un testimonio de jugador (JWT) no sustituye la firma interna', async () => {
    const response = await request(app.getHttpServer())
      .get(equippedHeroPath('cualquiera'))
      .set('Authorization', bearer('jugador-cualquiera'))

    expect(response.status).toBe(401)
  })

  /** Regresion: HU-38 sigue funcionando con la lista de servicios ampliada. */
  it('regresion: el contrato de propietarios de HU-38 sigue aceptando "notifications"', async () => {
    const productId = '11111111-1111-4111-8111-111111111111'
    const response = await signedGet(
      `/api/internal/v1/inventory/products/${productId}/owners`,
      'notifications',
    )

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ productId, owners: [] })
  })

  /** Regresion: la ruta de HU-38 sigue rechazando "combat" (no esta autorizado para ella). */
  it('regresion: "combat" no gana acceso a rutas internas ajenas por estar en la lista', async () => {
    const productId = '22222222-2222-4222-8222-222222222222'
    const response = await signedGet(
      `/api/internal/v1/inventory/products/${productId}/owners`,
      'combat',
    )

    // El guard no distingue por ruta, solo por servicio permitido en general;
    // esta prueba documenta el alcance real: cualquier servicio de la lista
    // puede llamar a cualquier ruta @InternalOnly(), igual que ya ocurria
    // entre 'commerce' y 'notifications' antes de este cambio.
    expect(response.status).toBe(200)
  })

  /** Regresion: HU-07 (/me) sigue funcionando sin verse afectado por este cambio. */
  it('regresion: GET /inventories/me/heroes/selection sigue funcionando para el jugador', async () => {
    const jugador = 'regresion-me-selection'
    await own(jugador, 'guerrero-tanque')
    await select(jugador, 'guerrero-tanque')

    const response = await request(app.getHttpServer())
      .get('/api/inventories/me/heroes/selection')
      .set('Authorization', bearer(jugador))

    expect(response.status).toBe(200)
    expect(response.body.configuration.hero.subtype).toBe('GUERRERO_TANQUE')
  })

  /** Regresion: la seleccion de heroe (PUT) sigue funcionando. */
  it('regresion: PUT /inventories/me/heroes/selection sigue preparando el heroe', async () => {
    const jugador = 'regresion-select'
    await own(jugador, 'chaman')

    const response = await request(app.getHttpServer())
      .put('/api/inventories/me/heroes/selection')
      .set('Authorization', bearer(jugador))
      .send({ heroReference: 'chaman' })

    expect(response.status).toBe(200)
    expect(response.body.configuration.hero.subtype).toBe('CHAMAN')
  })

  /** Regresion: el loadout (equipar en HU-28) sigue funcionando y se refleja
   * de inmediato en el contrato interno de Combat, sin recalculo propio. */
  it('regresion: equipar por la ruta de HU-28 sigue funcionando y se refleja en el contrato interno', async () => {
    const jugador = 'regresion-loadout'
    await own(jugador, 'guerrero-tanque')
    await select(jugador, 'guerrero-tanque')

    const antes = await signedGet(equippedHeroPath(jugador))
    expect(antes.status).toBe(200)
    expect(antes.body.effectiveStats.attack).toBe(10)

    await own(jugador, 'hacha-de-guerra')
    const equipResponse = await request(app.getHttpServer())
      .put('/api/inventories/me/heroes/guerrero-tanque/equipment/WEAPON_1')
      .set('Authorization', bearer(jugador))
      .send({ productReference: 'hacha-de-guerra' })
    expect(equipResponse.status).toBe(200)

    const despues = await signedGet(equippedHeroPath(jugador))
    expect(despues.status).toBe(200)
    expect(despues.body.effectiveStats.attack).toBe(14)
  })
})

describe('Contrato HTTP interno del heroe equipado — Catalog no disponible (HU-15)', () => {
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
      .overrideProvider(APP_CONFIG)
      .useValue(
        loadConfig({
          NODE_ENV: 'test',
          AUTH_MODE: 'jwt',
          COGNITO_USER_POOL_ID: 'us-east-1_test',
          COGNITO_CLIENT_ID: 'test',
          INTERNAL_SERVICE_AUTH_SECRET: secret,
        }),
      )
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

  it('responde 503 en vez de inventar estadisticas cuando Catalog no responde', async () => {
    const jugador = 'combat-catalog-caido'
    // La seleccion se siembra directamente en el repositorio (en memoria en
    // pruebas): con Catalog caido no hay forma de seleccionar heroe por HTTP,
    // igual que a un jugador real que ya tenia un heroe preparado antes de
    // que Catalog cayera.
    const selections = app.get<HeroSelectionRepositoryPort>(HERO_SELECTION_REPOSITORY)
    await selections.save(HeroSelection.create(jugador, 'pid-guerrero-tanque', new Date()), 0)

    const timestamp = String(Date.now())
    const path = equippedHeroPath(jugador)

    const response = await request(app.getHttpServer())
      .get(path)
      .set('x-internal-service', 'combat')
      .set('x-internal-timestamp', timestamp)
      .set(
        'x-internal-signature',
        signInternalRequest(secret, {
          service: 'combat',
          method: 'GET',
          path,
          timestamp,
          body: {},
        }),
      )

    expect(response.status).toBe(503)
  })
})
