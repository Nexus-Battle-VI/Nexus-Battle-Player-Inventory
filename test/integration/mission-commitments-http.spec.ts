import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'
import { signInternalRequest } from '../../src/adapters/outbound/identity/internal-signature'
import { CATALOG_READ, type CatalogProductView } from '../../src/application/ports/CatalogReadPort'
import {
  Role,
  TOKEN_VERIFIER,
  type TokenVerifierPort,
} from '../../src/application/ports/TokenVerifierPort'
import { AppModule, APP_CONFIG } from '../../src/infrastructure/bootstrap/app.module'
import { loadConfig } from '../../src/infrastructure/config/env'

const SECRET = 'mission-test-secret'
const HERO_ID = 'pid-guerrero-tanque'
const PLAYER = 'jugador-mission'
const PATH = `/api/internal/v1/inventory/heroes/${HERO_ID}/commitments`

const hero: CatalogProductView = {
  productId: HERO_ID,
  sku: 'guerrero-tanque',
  name: 'Guerrero Tanque',
  imageUrl: '',
  description: '',
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
      abilities: [],
    },
  },
}

const weapon: CatalogProductView = {
  productId: 'pid-espada-fuego',
  sku: 'espada-fuego',
  name: 'Espada',
  imageUrl: '',
  description: '',
  type: 'ARMA',
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 0,
  premium: false,
  realMoneyPrice: null,
  attributes: {
    schemaVersion: '1',
    values: { kind: 'ARMA', compatibilityScope: 'ALL_HEROES', effects: [] },
  },
}

const verifier: TokenVerifierPort = {
  verify: (token) =>
    Promise.resolve({ subject: token, email: null, roles: new Set([Role.Player]) }),
}

const input = (operationId: string, completeLoadout = false) => ({
  operationId,
  playerId: PLAYER,
  purpose: 'MISSION',
  reference: 'enr_prueba_1',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  requirements: { completeLoadout },
})

describe('Compromiso interno MISSION del heroe', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(
        loadConfig({
          NODE_ENV: 'test',
          AUTH_MODE: 'jwt',
          COGNITO_USER_POOL_ID: 'us-east-1_test',
          COGNITO_CLIENT_ID: 'test',
          INTERNAL_SERVICE_AUTH_SECRET: SECRET,
        }),
      )
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(verifier)
      .overrideProvider(CATALOG_READ)
      .useValue(new InMemoryCatalogReadClient([hero, weapon]))
      .compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()

    for (const itemId of ['guerrero-tanque', 'espada-fuego']) {
      await request(app.getHttpServer())
        .post(`/api/inventories/${PLAYER}/items`)
        .set('Authorization', `Bearer ${PLAYER}`)
        .send({ itemId, quantity: 1 })
        .expect(200)
    }
  })

  afterAll(async () => {
    await app.close()
  })

  const signed = (path: string, body: object, service = 'missions') => {
    const timestamp = String(Date.now())
    return request(app.getHttpServer())
      .post(path)
      .set('x-internal-service', service)
      .set('x-internal-timestamp', timestamp)
      .set(
        'x-internal-signature',
        signInternalRequest(SECRET, { service, method: 'POST', path, timestamp, body }),
      )
      .send(body)
  }

  it('niega llamadas sin firma o desde otro servicio', async () => {
    const body = input('11111111-1111-4111-8111-111111111111')
    await request(app.getHttpServer()).post(PATH).send(body).expect(401)
    await signed(PATH, body, 'combat').expect(401)
  })

  it('distingue heroe ajeno y mazo incompleto antes de reservar', async () => {
    const foreign = input('22222222-2222-4222-8222-222222222222')
    const notOwned = await signed(PATH, { ...foreign, playerId: 'otro-jugador' })
    expect(notOwned.status).toBe(422)
    expect(notOwned.body.code).toBe('HERO_NOT_OWNED')

    const incomplete = await signed(PATH, input('33333333-3333-4333-8333-333333333333', true))
    expect(incomplete.status).toBe(422)
    expect(incomplete.body.code).toBe('LOADOUT_INCOMPLETE')
    expect(incomplete.body.missingSlots).toEqual([
      { family: 'WEAPON', missing: 2 },
      { family: 'ARMOR', missing: 6 },
      { family: 'ITEM', missing: 2 },
    ])
  })

  it('reserva idempotentemente, impide equipar y libera incluso con reintentos', async () => {
    const body = input('44444444-4444-4444-8444-444444444444')
    const first = await signed(PATH, body)
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({
      heroId: HERO_ID,
      purpose: 'MISSION',
      reference: body.reference,
    })
    expect((await signed(PATH, body)).body).toEqual(first.body)

    const equipmentPath = `/api/inventories/me/heroes/${HERO_ID}/equipment/WEAPON_1`
    const equip = () =>
      request(app.getHttpServer())
        .put(equipmentPath)
        .set('Authorization', `Bearer ${PLAYER}`)
        .send({ productReference: 'espada-fuego' })
    expect((await equip()).status).toBe(409)

    const competing = await signed(PATH, input('55555555-5555-4555-8555-555555555555'))
    expect(competing.status).toBe(422)
    expect(competing.body.code).toBe('HERO_COMMITTED')

    const releasePath =
      '/api/internal/v1/inventory/commitments/44444444-4444-4444-8444-444444444444/release'
    await signed(releasePath, {}).expect(204)
    await signed(releasePath, {}).expect(204)
    expect((await equip()).status).toBe(200)
    expect((await signed(PATH, body)).status).toBe(409)
  })
})
