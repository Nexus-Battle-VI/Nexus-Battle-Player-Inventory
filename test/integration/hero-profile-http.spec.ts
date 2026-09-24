import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule, APP_CONFIG } from '../../src/infrastructure/bootstrap/app.module'
import { loadConfig } from '../../src/infrastructure/config/env'
import { signInternalRequest } from '../../src/adapters/outbound/identity/internal-signature'
import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import {
  CatalogUnavailableError,
  CATALOG_READ,
  type CatalogLookupQuery,
  type CatalogProductView,
  type CatalogReadPort,
} from '../../src/application/ports/CatalogReadPort'
import {
  Role,
  TOKEN_VERIFIER,
  type TokenVerifierPort,
  type VerifiedIdentity,
} from '../../src/application/ports/TokenVerifierPort'

/**
 * Contrato HTTP interno del perfil de un heroe concreto (HU-71,
 * Management#56/#370).
 *
 * Reproduce EXACTAMENTE la peticion del consumidor real, el cliente de Missions
 * (`PlayerInventoryAbilitiesClient`): `GET` con el jugador y el heroe en la ruta,
 * `x-internal-service: missions` y firma sobre cuerpo VACIO. Y comprueba las tres
 * cosas de las que depende ese cliente:
 *
 *   1. `200` con `heroId` (comparable con el que se pidio, sin distinguir
 *      mayusculas) y `abilities[].abilityId` no vacio;
 *   2. `404` **con `code: HERO_NOT_OWNED`** -- sin ese codigo el cliente trata el
 *      `404` como un resultado desconocido y NO guarda la estrategia;
 *   3. `401` para cualquier servicio que no sea `missions`, sin ampliar la lista
 *      global del servicio.
 */
const secret = 'test-only-internal-secret'

const profilePath = (playerId: string, heroId: string): string =>
  `/api/internal/v1/players/${playerId}/heroes/${heroId}`

const stubVerifier: TokenVerifierPort = {
  verify: (token: string): Promise<VerifiedIdentity> =>
    Promise.resolve({ subject: token, email: null, roles: new Set([Role.Player]) }),
}

const envelope = (values: Record<string, unknown>): unknown => ({ schemaVersion: '1', values })

const hero = (
  sku: string,
  subtype: string,
  name: string,
  abilities: readonly string[] = [`hab-${sku}`],
): CatalogProductView => ({
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
  attributes: envelope({
    kind: 'HEROE',
    heroSubtype: subtype,
    basePower: 5,
    baseHealth: 40,
    baseDefense: 8,
    baseAttack: { mode: 'FIXED', amount: 10 },
    baseDamage: { mode: 'DICE', count: 1, sides: 4 },
    abilities: [...abilities],
  }),
})

const ability = (sku: string): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name: `Habilidad ${sku}`,
  imageUrl: '',
  description: sku,
  type: 'HABILIDAD',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 0,
  premium: false,
  realMoneyPrice: null,
  attributes: envelope({
    kind: 'HABILIDAD',
    compatibleHeroSubtypes: ['GUERRERO_TANQUE'],
    powerCostMode: 'FIXED',
    powerCost: 2,
    chargeTurns: 1,
    effects: [
      {
        kind: 'STAT_MODIFIER',
        target: 'SELF',
        statistic: 'ATTACK',
        operation: 'INCREASE',
        magnitude: { mode: 'FIXED', amount: 2 },
      },
    ],
  }),
})

const CATALOG: CatalogProductView[] = [
  hero('guerrero-tanque', 'GUERRERO_TANQUE', 'Guerrero Tanque', [
    'hab-golpe-con-escudo',
    'hab-mano-de-piedra',
  ]),
  hero('mago-fuego', 'MAGO_FUEGO', 'Mago Fuego', ['hab-bola-de-fuego']),
  ability('hab-golpe-con-escudo'),
  ability('hab-mano-de-piedra'),
  ability('hab-bola-de-fuego'),
]

/** Doble del puerto de Catalog que se puede "caer" en mitad de la suite. */
class SwitchableCatalog implements CatalogReadPort {
  down = false

  constructor(private readonly inner: CatalogReadPort) {}

  getByReference(reference: string): Promise<CatalogProductView | null> {
    return this.down
      ? Promise.reject(new CatalogUnavailableError('prueba'))
      : this.inner.getByReference(reference)
  }

  lookup(query: CatalogLookupQuery): Promise<readonly CatalogProductView[]> {
    return this.down
      ? Promise.reject(new CatalogUnavailableError('prueba'))
      : this.inner.lookup(query)
  }
}

describe('GET /api/internal/v1/players/:playerId/heroes/:heroId (HU-71)', () => {
  let app: INestApplication
  let catalog: SwitchableCatalog
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

    catalog = new SwitchableCatalog(new InMemoryCatalogReadClient(CATALOG))

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
      .useValue(catalog)
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

  const own = async (subject: string, itemId: string): Promise<void> => {
    const response = await request(app.getHttpServer())
      .post(`/api/inventories/${subject}/items`)
      .set('Authorization', `Bearer ${subject}`)
      .send({ itemId, quantity: 1 })

    expect(response.status).toBe(200)
  }

  const select = async (subject: string, heroReference: string): Promise<void> => {
    const response = await request(app.getHttpServer())
      .put('/api/inventories/me/heroes/selection')
      .set('Authorization', `Bearer ${subject}`)
      .send({ heroReference })

    expect(response.status).toBe(200)
  }

  const signedGet = (
    path: string,
    service = 'missions',
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

  it('devuelve el perfil del heroe con sus habilidades, como lo lee el cliente de Missions', async () => {
    const jugador = 'misiones-con-heroe'
    await own(jugador, 'guerrero-tanque')

    const response = await signedGet(profilePath(jugador, 'pid-guerrero-tanque'))

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      playerId: jugador,
      heroId: 'pid-guerrero-tanque',
      reference: 'guerrero-tanque',
      subtype: 'GUERRERO_TANQUE',
      name: 'Guerrero Tanque',
      baseStats: { power: 5, health: 40, defense: 8, attack: 10 },
      loadoutVersion: 0,
    })

    // Las TRES comprobaciones que hace `PlayerInventoryAbilitiesClient`.
    expect(response.body.heroId.toLowerCase()).toBe('pid-guerrero-tanque')
    expect(Array.isArray(response.body.abilities)).toBe(true)
    expect(response.body.abilities).toHaveLength(2)
    for (const item of response.body.abilities as { abilityId: string }[]) {
      expect(typeof item.abilityId).toBe('string')
      expect(item.abilityId).not.toBe('')
    }
    expect((response.body.abilities as { abilityId: string }[]).map((a) => a.abilityId)).toEqual([
      'pid-hab-golpe-con-escudo',
      'pid-hab-mano-de-piedra',
    ])
  })

  it('NO publica los campos de la seleccion: `ready`, `blockers` ni `selectedAt`', async () => {
    const jugador = 'misiones-sin-seleccion'
    await own(jugador, 'guerrero-tanque')

    const response = await signedGet(profilePath(jugador, 'pid-guerrero-tanque'))

    expect(response.status).toBe(200)
    expect(response.body).not.toHaveProperty('ready')
    expect(response.body).not.toHaveProperty('blockers')
    expect(response.body).not.toHaveProperty('selectedAt')
  })

  it('sirve a un heroe DISTINTO del seleccionado (la razon de existir de la ruta)', async () => {
    const jugador = 'misiones-dos-heroes'
    await own(jugador, 'guerrero-tanque')
    await own(jugador, 'mago-fuego')
    await select(jugador, 'guerrero-tanque')

    const perfilDelOtro = await signedGet(profilePath(jugador, 'pid-mago-fuego'))

    expect(perfilDelOtro.status).toBe(200)
    expect(perfilDelOtro.body).toMatchObject({ heroId: 'pid-mago-fuego', subtype: 'MAGO_FUEGO' })
    expect(
      (perfilDelOtro.body.abilities as { abilityId: string }[]).map((a) => a.abilityId),
    ).toEqual(['pid-hab-bola-de-fuego'])
  })

  it('404 con `code: HERO_NOT_OWNED` si el heroe no es del jugador', async () => {
    const response = await signedGet(profilePath('misiones-sin-nada', 'pid-guerrero-tanque'))

    expect(response.status).toBe(404)
    expect(response.body.code).toBe('HERO_NOT_OWNED')
  })

  it('404 con el MISMO codigo si el heroe no existe: no se distingue de uno ajeno', async () => {
    const jugador = 'misiones-inexistente'
    await own(jugador, 'guerrero-tanque')

    const response = await signedGet(profilePath(jugador, 'pid-no-existe'))

    expect(response.status).toBe(404)
    expect(response.body.code).toBe('HERO_NOT_OWNED')
  })

  it('sin firma interna responde 401', async () => {
    const response = await request(app.getHttpServer()).get(
      profilePath('misiones-sin-firma', 'pid-guerrero-tanque'),
    )

    expect(response.status).toBe(401)
  })

  it.each(['combat', 'commerce', 'notifications'])(
    'un servicio de la lista GLOBAL que no es missions responde 401: %s',
    async (service) => {
      const response = await signedGet(
        profilePath('misiones-sin-permiso', 'pid-guerrero-tanque'),
        service,
      )

      expect(response.status).toBe(401)
    },
  )

  it('una firma calculada para OTRA ruta responde 401', async () => {
    const timestamp = String(Date.now())
    const firmaDeOtraRuta = signInternalRequest(secret, {
      service: 'missions',
      method: 'GET',
      path: '/api/internal/v1/players/otro/heroes/otro',
      timestamp,
      body: {},
    })

    const response = await request(app.getHttpServer())
      .get(profilePath('misiones-firma-cruzada', 'pid-guerrero-tanque'))
      .set('x-internal-service', 'missions')
      .set('x-internal-timestamp', timestamp)
      .set('x-internal-signature', firmaDeOtraRuta)

    expect(response.status).toBe(401)
  })

  it('CONTROL: la autorización de missions para grants es específica de la ruta', async () => {
    const grants = '/api/internal/v1/inventory/grants'
    const body = {
      operationId: '22222222-2222-4222-8222-222222222222',
      playerId: 'misiones-grants',
      items: [{ productId: '11111111-1111-4111-8111-111111111111', quantity: 1 }],
    }
    const timestamp = String(Date.now())
    const post = (service: string) =>
      request(app.getHttpServer())
        .post(grants)
        .set('x-internal-service', service)
        .set('x-internal-timestamp', timestamp)
        .set(
          'x-internal-signature',
          signInternalRequest(secret, { service, method: 'POST', path: grants, timestamp, body }),
        )
        .send(body)

    expect((await post('missions')).status).toBe(200)
    // Commerce conserva su permiso y el mismo operationId no duplica el grant.
    expect((await post('commerce')).status).toBe(200)
  })

  it('503 si Catalog no responde', async () => {
    const jugador = 'misiones-catalog-caido'
    await own(jugador, 'guerrero-tanque')
    catalog.down = true

    try {
      const response = await signedGet(profilePath(jugador, 'pid-guerrero-tanque'))

      expect(response.status).toBe(503)
    } finally {
      catalog.down = false
    }
  })
})
