import 'reflect-metadata'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule, APP_CONFIG } from '../../src/infrastructure/bootstrap/app.module'
import { loadConfig } from '../../src/infrastructure/config/env'
import { signInternalRequest } from '../../src/adapters/outbound/identity/internal-signature'

const path = '/api/internal/v1/inventory/grants'
const secret = 'test-only-internal-secret'
const body = {
  operationId: '22222222-2222-4222-8222-222222222222',
  playerId: 'player-a',
  items: [{ productId: '11111111-1111-4111-8111-111111111111', quantity: 2 }],
}

describe('Contrato HTTP interno de entrega', () => {
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
          INTERNAL_SERVICE_AUTH_SECRET: secret,
        }),
      )
      .compile()
    app = module.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
  })
  afterAll(async () => {
    await app.close()
  })
  const signed = (payload = body, service = 'commerce', timestamp = String(Date.now())) =>
    request(app.getHttpServer())
      .post(path)
      .set('x-internal-service', service)
      .set('x-internal-timestamp', timestamp)
      .set(
        'x-internal-signature',
        signInternalRequest(secret, { service, method: 'POST', path, timestamp, body: payload }),
      )
      .send(payload)

  it('exige HMAC incluso sin bearer y registra una sola entrega', async () => {
    expect((await request(app.getHttpServer()).post(path).send(body)).status).toBe(401)
    const first = await signed()
    const replay = await signed()
    expect(first.status).toBe(200)
    expect(replay.body).toEqual(first.body)
    expect(first.body.applied).toBe(true)
  })
  it('rechaza servicio ajeno y sello vencido', async () => {
    expect((await signed(body, 'web')).status).toBe(401)
    expect((await signed(body, 'commerce', '0')).status).toBe(401)
  })
  it('rechaza cambio de payload y no confunde conflicto con entrega rechazada', async () => {
    expect((await signed({ ...body, playerId: 'player-b' })).status).toBe(409)
    const tooMany = {
      ...body,
      operationId: '33333333-3333-4333-8333-333333333333',
      items: Array.from({ length: 31 }, (_, index) => ({
        productId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        quantity: 1,
      })),
    }
    const rejected = await signed(tooMany)
    expect(rejected.status).toBe(422)
    expect(rejected.body.code).toBe('INVENTORY_REJECTED')
  })
})
