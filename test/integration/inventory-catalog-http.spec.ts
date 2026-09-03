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
 * Búsqueda y ficha de detalle de HU-27 con un doble sembrado de Catalog.
 *
 * El token de prueba se toma como sujeto: cada prueba usa su propio inventario.
 */
const stubVerifier: TokenVerifierPort = {
  verify: (token: string): Promise<VerifiedIdentity> =>
    Promise.resolve({ subject: token, email: null, roles: new Set([Role.Player]) }),
}

const view = (sku: string, name: string, type = 'ARMA'): CatalogProductView => ({
  productId: `pid-${sku}`,
  sku,
  name,
  imageUrl: `https://assets.example.test/${sku}.png`,
  description: `Ficha de ${name}`,
  type,
  lifecycleStatus: 'ACTIVE',
  creditsPrice: 40,
  premium: false,
  realMoneyPrice: null,
  attributes: { schemaVersion: '1', values: { kind: type } },
})

const CATALOG = [
  view('espada-larga', 'Espada Larga'),
  view('espada-corta', 'Espada Corta'),
  view('escudo-torre', 'Escudo Torre'),
  view('pocion-vida', 'Poción de Vida', 'ITEM'),
]

describe('HU-27 — búsqueda y detalle con Catalog', () => {
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
      .send({ itemId, quantity: 2 })
    expect(response.status).toBe(200)
  }

  const list = (subject: string, query = ''): request.Test =>
    request(app.getHttpServer())
      .get(`/api/inventories/me/items${query}`)
      .set('Authorization', bearer(subject))

  it('enriquece cada ítem del listado con el resumen del producto', async () => {
    await own('s-enriquece', 'espada-larga')

    const response = await list('s-enriquece')

    expect(response.status).toBe(200)
    expect(response.body.items[0].product).toMatchObject({
      sku: 'espada-larga',
      name: 'Espada Larga',
      type: 'ARMA',
      lifecycleStatus: 'ACTIVE',
    })
  })

  it('con q < 4 no busca: devuelve el inventario completo', async () => {
    await own('s-corto', 'espada-larga')
    await own('s-corto', 'escudo-torre')

    const response = await list('s-corto', '?q=esp')

    expect(response.status).toBe(200)
    expect(response.body.totalItems).toBe(2)
  })

  it('con q >= 4 filtra por nombre y solo dentro del inventario poseído', async () => {
    await own('s-busca', 'espada-larga')
    await own('s-busca', 'espada-corta')
    await own('s-busca', 'escudo-torre')

    const response = await list('s-busca', '?q=espada')

    expect(response.status).toBe(200)
    expect(response.body.totalItems).toBe(2)
    expect(
      (response.body.items as { product: { name: string } }[])
        .map((item) => item.product.name)
        .sort(),
    ).toEqual(['Espada Corta', 'Espada Larga'])
  })

  it('la búsqueda sin coincidencias devuelve página vacía', async () => {
    await own('s-vacia', 'espada-larga')

    const response = await list('s-vacia', '?q=martillo')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ items: [], totalItems: 0, totalPages: 0 })
  })

  it('filtra por tipo canónico', async () => {
    await own('s-tipo', 'espada-larga')
    await own('s-tipo', 'pocion-vida')

    const response = await list('s-tipo', '?type=ITEM')

    expect(response.status).toBe(200)
    expect(response.body.items).toHaveLength(1)
    expect(response.body.items[0].product.name).toBe('Poción de Vida')
  })

  it('rechaza un type fuera del enum con 400', async () => {
    const response = await list('s-tipo-malo', '?type=LEGENDARIO')

    expect(response.status).toBe(400)
  })

  it('GET items/:itemReference devuelve la ficha compuesta del producto poseído', async () => {
    await own('s-detalle', 'espada-larga')

    const response = await request(app.getHttpServer())
      .get('/api/inventories/me/items/espada-larga')
      .set('Authorization', bearer('s-detalle'))

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      itemId: 'espada-larga',
      quantity: 2,
      product: {
        productId: 'pid-espada-larga',
        name: 'Espada Larga',
        description: 'Ficha de Espada Larga',
      },
    })
    expect(response.body.product).toHaveProperty('attributes')
    expect(response.body.product).not.toHaveProperty('rating')
    expect(response.body.product).not.toHaveProperty('comments')
  })

  it('el detalle de una referencia no poseída responde 404', async () => {
    await own('s-ajeno', 'espada-larga')

    const response = await request(app.getHttpServer())
      .get('/api/inventories/me/items/escudo-torre')
      .set('Authorization', bearer('s-ajeno'))

    expect(response.status).toBe(404)
  })

  it('el detalle de una referencia que Catalog no conoce responde 404', async () => {
    await own('s-desconocido', 'reliquia-sin-catalogo')

    const response = await request(app.getHttpServer())
      .get('/api/inventories/me/items/reliquia-sin-catalogo')
      .set('Authorization', bearer('s-desconocido'))

    expect(response.status).toBe(404)
  })

  it('sin testimonio, la ficha responde 401', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/inventories/me/items/espada-larga',
    )

    expect(response.status).toBe(401)
  })
})

describe('HU-27 — sin Catalog configurado', () => {
  let app: INestApplication
  let previousEnv: Record<string, string | undefined>

  beforeAll(async () => {
    previousEnv = {
      AUTH_MODE: process.env.AUTH_MODE,
      COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID,
      COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
      CATALOG_BASE_URL: process.env.CATALOG_BASE_URL,
    }
    process.env.AUTH_MODE = 'jwt'
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_pruebas'
    process.env.COGNITO_CLIENT_ID = 'cliente-de-pruebas'
    delete process.env.CATALOG_BASE_URL

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue(stubVerifier)
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
    // `loadConfig` trata la cadena vacía como ausente, así que restaurar a ''
    // deja `CATALOG_BASE_URL` efectivamente sin configurar para el resto.
    for (const [key, value] of Object.entries(previousEnv)) {
      process.env[key] = value ?? ''
    }
  })

  const bearer = (token: string): string => `Bearer ${token}`

  it('el listado sin búsqueda funciona en modo degradado: product en null', async () => {
    await request(app.getHttpServer())
      .post('/api/inventories/s-degradado/items')
      .set('Authorization', bearer('s-degradado'))
      .send({ itemId: 'espada-larga', quantity: 1 })

    const response = await request(app.getHttpServer())
      .get('/api/inventories/me/items')
      .set('Authorization', bearer('s-degradado'))

    expect(response.status).toBe(200)
    expect(response.body.items[0]).toMatchObject({ itemId: 'espada-larga', product: null })
  })

  it('la búsqueda por nombre responde 503 cuando Catalog no está configurado', async () => {
    await request(app.getHttpServer())
      .post('/api/inventories/s-503/items')
      .set('Authorization', bearer('s-503'))
      .send({ itemId: 'espada-larga', quantity: 1 })

    const response = await request(app.getHttpServer())
      .get('/api/inventories/me/items?q=espada')
      .set('Authorization', bearer('s-503'))

    expect(response.status).toBe(503)
  })

  it('la ficha de detalle responde 503 cuando Catalog no está configurado', async () => {
    await request(app.getHttpServer())
      .post('/api/inventories/s-503-detalle/items')
      .set('Authorization', bearer('s-503-detalle'))
      .send({ itemId: 'espada-larga', quantity: 1 })

    const response = await request(app.getHttpServer())
      .get('/api/inventories/me/items/espada-larga')
      .set('Authorization', bearer('s-503-detalle'))

    expect(response.status).toBe(503)
  })
})
