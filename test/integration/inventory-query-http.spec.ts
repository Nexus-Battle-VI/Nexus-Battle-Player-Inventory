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

/**
 * Integracion de la consulta paginada self-service `GET /api/inventories/me/items`
 * (HU-27, RF-27) con la autenticacion ACTIVA.
 *
 * Lo que se comprueba: la identidad sale del testimonio verificado y no de la
 * peticion; la paginacion es de 16; y un jugador nunca ve el inventario de otro.
 *
 * El verificador de prueba toma el token literal como sujeto, de modo que cada
 * prueba usa su propio identificador y no comparte inventario con las demas
 * — el mismo aislamiento por sujeto que ya usan las demas suites de este
 * repositorio.
 */
const stubVerifier: TokenVerifierPort = {
  verify: (token: string): Promise<VerifiedIdentity> =>
    Promise.resolve({ subject: token, email: null, roles: new Set([Role.Player]) }),
}

describe('GET /api/inventories/me/items', () => {
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

  const seed = async (subject: string, count: number): Promise<void> => {
    for (let index = 0; index < count; index += 1) {
      const response = await request(app.getHttpServer())
        .post(`/api/inventories/${subject}/items`)
        .set('Authorization', bearer(subject))
        .send({ itemId: `item-${String(index).padStart(3, '0')}`, quantity: 1 })

      expect(response.status).toBe(200)
    }
  }

  const listItems = (subject: string, query = ''): request.Test =>
    request(app.getHttpServer())
      .get(`/api/inventories/me/items${query}`)
      .set('Authorization', bearer(subject))

  it('responde 401 sin testimonio', async () => {
    const response = await request(app.getHttpServer()).get('/api/inventories/me/items')

    expect(response.status).toBe(401)
  })

  it('devuelve la primera pagina del inventario del sujeto autenticado', async () => {
    await seed('sujeto-primera-pagina', 3)

    const response = await listItems('sujeto-primera-pagina')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ page: 1, pageSize: 16, totalItems: 3, totalPages: 1 })
    expect(response.body.items).toHaveLength(3)
  })

  it('aisla el inventario de cada jugador: nunca devuelve el de otro sujeto', async () => {
    await seed('sujeto-aislamiento-a', 3)
    await seed('sujeto-aislamiento-b', 5)

    const a = await listItems('sujeto-aislamiento-a')
    const b = await listItems('sujeto-aislamiento-b')

    expect(a.body.totalItems).toBe(3)
    expect(b.body.totalItems).toBe(5)
    expect(a.body.items.map((item: { itemId: string }) => item.itemId)).not.toContain('item-004')
  })

  it('no acepta ningun ownerId proveniente del cliente', async () => {
    await seed('sujeto-ajeno', 2)

    const response = await listItems('sujeto-query-owner', '?ownerId=sujeto-ajeno')

    expect(response.status).toBe(400)
  })

  it.each([
    ['cero', '?page=0'],
    ['negativa', '?page=-1'],
    ['no numerica', '?page=abc'],
    ['fraccionaria', '?page=2.5'],
  ])('responde 400 ante una pagina %s', async (_caso, query) => {
    const response = await listItems('sujeto-pagina-invalida', query)

    expect(response.status).toBe(400)
  })

  it('acepta una pagina explicita valida', async () => {
    await seed('sujeto-pagina-explicita', 1)

    const response = await listItems('sujeto-pagina-explicita', '?page=1')

    expect(response.status).toBe(200)
    expect(response.body.page).toBe(1)
  })

  it('un jugador sin documento de inventario recibe una pagina vacia', async () => {
    const response = await listItems('sujeto-sin-inventario')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      items: [],
      page: 1,
      pageSize: 16,
      totalItems: 0,
      totalPages: 0,
    })
  })

  it('pagina de 16 en 16: 17 elementos ocupan dos paginas', async () => {
    await seed('sujeto-diecisiete', 17)

    const first = await listItems('sujeto-diecisiete', '?page=1')
    const second = await listItems('sujeto-diecisiete', '?page=2')

    expect(first.body.items).toHaveLength(16)
    expect(first.body.totalPages).toBe(2)
    expect(second.body.items).toHaveLength(1)
    expect(second.body.totalItems).toBe(17)
  })

  it('una pagina valida mas alla del total devuelve items vacios y HTTP 200', async () => {
    await seed('sujeto-fuera-de-rango', 3)

    const response = await listItems('sujeto-fuera-de-rango', '?page=50')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      items: [],
      page: 50,
      pageSize: 16,
      totalItems: 3,
      totalPages: 1,
    })
  })
})
