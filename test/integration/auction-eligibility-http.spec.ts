import 'reflect-metadata'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AppModule, APP_CONFIG } from '../../src/infrastructure/bootstrap/app.module'
import { loadConfig } from '../../src/infrastructure/config/env'
import { signInternalRequest } from '../../src/adapters/outbound/identity/internal-signature'
import { INVENTORY_REPOSITORY } from '../../src/application/ports/InventoryRepositoryPort'
import type { InMemoryInventoryRepository } from '../../src/adapters/outbound/persistence/InMemoryInventoryRepository'
import { Inventory } from '../../src/domain/entities/Inventory'
import { PlayerId } from '../../src/domain/value-objects/identifiers'

const secret = 'test-only-internal-secret'
const owner = 'seller-eligibility'
const product = '11111111-1111-4111-8111-111111111111'
const path = (id = product) => `/api/internal/v1/inventory/auction-eligibility/${owner}/${id}`
const ownersPath = `/api/internal/v1/inventory/products/${product}/owners`

describe('Auction eligibility HTTP', () => {
  let app: INestApplication
  let inventory: InMemoryInventoryRepository
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
    inventory = module.get(INVENTORY_REPOSITORY)
    app = module.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
  })
  afterAll(async () => app.close())
  const signed = (target = path(), service = 'auction') => {
    const timestamp = String(Date.now())
    return request(app.getHttpServer())
      .get(target)
      .set('x-internal-service', service)
      .set('x-internal-timestamp', timestamp)
      .set(
        'x-internal-signature',
        signInternalRequest(secret, { service, method: 'GET', path: target, timestamp, body: {} }),
      )
  }
  const seed = () =>
    inventory.save(
      Inventory.restore({
        ownerId: PlayerId.create(owner),
        capacity: 30,
        slots: [{ itemId: product, quantity: 2 }],
      }),
    )

  it('acepta Auction firmado y devuelve la forma exacta; no poseido e inventario ausente son false', async () => {
    const missing = await signed()
    expect(missing.body).toEqual({
      ownerId: owner,
      productId: product,
      ownedByPlayer: false,
      inUse: false,
    })
    expect(missing.status).toBe(200)
    await seed()
    expect((await signed()).body).toEqual({
      ownerId: owner,
      productId: product,
      ownedByPlayer: true,
      inUse: false,
    })
  })
  it('rechaza ausencia de firma y caller ajeno aunque use HMAC valido', async () => {
    expect((await request(app.getHttpServer()).get(path())).status).toBe(401)
    expect((await signed(path(), 'commerce')).status).toBe(401)
  })

  it('auction sigue restringido por endpoint y HMAC', async () => {
    expect((await signed(ownersPath)).status).toBe(401)
    expect((await signed(path(), 'commerce')).status).toBe(401)
    expect((await signed(ownersPath, 'web')).status).toBe(401)
    expect(
      (
        await request(app.getHttpServer())
          .get(path())
          .set('x-internal-service', 'auction')
          .set('x-internal-timestamp', String(Date.now()))
          .set('x-internal-signature', 'firma-invalida')
      ).status,
    ).toBe(401)
  })
})
