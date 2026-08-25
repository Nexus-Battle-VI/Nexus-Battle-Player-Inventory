import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../../src/infrastructure/bootstrap/app.module'
import {
  Role,
  TOKEN_VERIFIER,
  TokenVerificationError,
  type TokenVerifierPort,
  type VerifiedIdentity,
} from '../../src/application/ports/TokenVerifierPort'

/**
 * Integracion con la autenticacion ACTIVA.
 *
 * Lo que se comprueba es concreto: el `ownerId` viaja en la URL, y antes bastaba
 * cambiarlo para leer o VACIAR el inventario de cualquier jugador.
 */
const IDENTITIES: Readonly<Record<string, VerifiedIdentity>> = {
  'token-ana': { subject: 'sujeto-ana', email: null, roles: new Set([Role.Player]) },
  'token-bruno': { subject: 'sujeto-bruno', email: null, roles: new Set([Role.Player]) },
  'token-administrador': {
    subject: 'sujeto-admin',
    email: null,
    roles: new Set([Role.Player, Role.Administrator]),
  },
}

const stubVerifier: TokenVerifierPort = {
  verify: (token: string): Promise<VerifiedIdentity> => {
    const identity = IDENTITIES[token]

    return identity === undefined
      ? Promise.reject(new TokenVerificationError())
      : Promise.resolve(identity)
  },
}

describe('API de inventarios con autenticacion activa', () => {
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

  const bearer = (token: string) => `Bearer ${token}`

  const anadir = (ownerId: string, token: string, itemId = 'pocion-de-vida') =>
    request(app.getHttpServer())
      .post(`/api/inventories/${ownerId}/items`)
      .set('Authorization', bearer(token))
      .send({ itemId, quantity: 3 })

  it('responde 401 sin testimonio', async () => {
    const response = await request(app.getHttpServer()).get('/api/inventories/sujeto-ana')

    expect(response.status).toBe(401)
  })

  it('permite a cada jugador operar sobre su propio inventario', async () => {
    const response = await anadir('sujeto-ana', 'token-ana')

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ ownerId: 'sujeto-ana' })
  })

  /**
   * Responde 404 y no 403 a proposito: distinguirlos confirmaria que ese
   * jugador existe, y con eso se puede enumerar quien juega probando
   * identificadores.
   */
  it('responde 404 al leer el inventario de otro jugador', async () => {
    await anadir('sujeto-ana', 'token-ana')

    const response = await request(app.getHttpServer())
      .get('/api/inventories/sujeto-ana')
      .set('Authorization', bearer('token-bruno'))

    expect(response.status).toBe(404)
  })

  /**
   * La consecuencia mas grave del agujero anterior: vaciar el inventario ajeno.
   */
  it('responde 404 al retirar objetos del inventario de otro jugador', async () => {
    await anadir('sujeto-ana', 'token-ana')

    const response = await request(app.getHttpServer())
      .post('/api/inventories/sujeto-ana/items/removals')
      .set('Authorization', bearer('token-bruno'))
      .send({ itemId: 'pocion-de-vida', quantity: 1 })

    expect(response.status).toBe(404)
  })

  it('responde 404 al anadir objetos al inventario de otro jugador', async () => {
    expect((await anadir('sujeto-ana', 'token-bruno')).status).toBe(404)
  })

  it('permite a un administrador consultar un inventario ajeno', async () => {
    await anadir('sujeto-ana', 'token-ana')

    const response = await request(app.getHttpServer())
      .get('/api/inventories/sujeto-ana')
      .set('Authorization', bearer('token-administrador'))

    expect(response.status).toBe(200)
  })

  it('las sondas de salud responden sin testimonio', async () => {
    expect((await request(app.getHttpServer()).get('/api/health/live')).status).toBeLessThan(400)
  })
})
