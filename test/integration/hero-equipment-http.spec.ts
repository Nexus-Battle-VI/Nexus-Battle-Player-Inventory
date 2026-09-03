import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import {
  Role,
  TOKEN_VERIFIER,
  type TokenVerifierPort,
  type VerifiedIdentity,
} from '../../src/application/ports/TokenVerifierPort'
import { CATALOG_READ, type CatalogProductView } from '../../src/application/ports/CatalogReadPort'
import { InMemoryCatalogReadClient } from '../../src/adapters/outbound/catalog/InMemoryCatalogReadClient'

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
]

describe('HU-28 — configuracion de equipamiento del heroe (HTTP)', () => {
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

  it('regresion HU-27: el listado del inventario propio sigue respondiendo', async () => {
    await own('s-reg', 'guerrero-tanque')

    const response = await request(app.getHttpServer())
      .get('/api/inventories/me/items')
      .set('Authorization', bearer('s-reg'))

    expect(response.status).toBe(200)
    expect(response.body.pageSize).toBe(16)
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
