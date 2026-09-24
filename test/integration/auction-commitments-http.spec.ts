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
import type { AuctionCommitments } from '../../src/application/use-cases/AuctionCommitments'
import { AUCTION_COMMITMENT_USE_CASE } from '../../src/application/use-cases/AuctionCommitments'

const secret = 'test-only-internal-secret'
const base = '/api/internal/v1/inventory/auction-commitments'
const product = '11111111-1111-4111-8111-111111111111'
const owner = 'seller-a'
const commitmentIdOf = (body: unknown): string => {
  if (
    typeof body === 'object' &&
    body !== null &&
    'commitmentId' in body &&
    typeof body.commitmentId === 'string'
  )
    return body.commitmentId
  throw new Error('La respuesta no contiene commitmentId.')
}
describe('Auction commitments HTTP', () => {
  let app: INestApplication
  let inventory: InMemoryInventoryRepository
  let commitments: AuctionCommitments
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
    commitments = module.get(AUCTION_COMMITMENT_USE_CASE)
    app = module.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    )
    await app.init()
  })
  afterAll(async () => app.close())
  const post = (
    path: string,
    body: object,
    service = 'auction',
    timestamp = String(Date.now()),
    signature?: string,
  ) =>
    request(app.getHttpServer())
      .post(path)
      .set('x-internal-service', service)
      .set('x-internal-timestamp', timestamp)
      .set(
        'x-internal-signature',
        signature ??
          signInternalRequest(secret, { service, method: 'POST', path, timestamp, body }),
      )
      .send(body)
  const seed = () =>
    inventory.save(
      Inventory.restore({
        ownerId: PlayerId.create(owner),
        capacity: 30,
        slots: [{ itemId: product, quantity: 3 }],
      }),
    )
  const commit = (id: string) => ({
    operationId: id,
    auctionId: id,
    ownerId: owner,
    productId: product,
    expiresAt: '2026-01-01T00:00:00.000Z',
  })
  it('commit, release y pending claim son idempotentes', async () => {
    await seed()
    const first = await post(base, commit('auction-a'))
    const firstId = commitmentIdOf(first.body)
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ status: 'ACTIVE', applied: true })
    const replay = await post(base, commit('auction-a'))
    expect(replay.body).toMatchObject({ commitmentId: first.body.commitmentId, applied: false })
    const released = await post(`${base}/${firstId}/release`, {
      operationId: 'auction-a:release',
      auctionId: 'auction-a',
      ownerId: owner,
      productId: product,
      reason: 'AUCTION_WITHOUT_BIDS',
    })
    expect(released.body).toMatchObject({ status: 'RELEASED', applied: true })
    expect(
      (
        await post(`${base}/${firstId}/release`, {
          operationId: 'auction-a:release',
          auctionId: 'auction-a',
          ownerId: owner,
          productId: product,
          reason: 'AUCTION_WITHOUT_BIDS',
        })
      ).body.applied,
    ).toBe(false)
    const second = await post(base, commit('auction-b'))
    const secondId = commitmentIdOf(second.body)
    const pending = {
      operationId: 'auction-b:pending',
      auctionId: 'auction-b',
      sellerId: owner,
      winnerId: 'winner',
      productId: product,
    }
    expect((await post(`${base}/${secondId}/pending-claim`, pending)).body).toMatchObject({
      status: 'PENDING_CLAIM',
      winnerId: 'winner',
      applied: true,
    })
    expect((await post(`${base}/${secondId}/pending-claim`, pending)).body.applied).toBe(false)
  })
  it('claim entrega el producto al ganador y es idempotente', async () => {
    await seed()
    const winner = 'winner-claim'
    const created = await post(base, commit('auction-claim'))
    const commitmentId = commitmentIdOf(created.body)
    const pending = {
      operationId: 'auction-claim:pending',
      auctionId: 'auction-claim',
      sellerId: owner,
      winnerId: winner,
      productId: product,
    }
    expect((await post(`${base}/${commitmentId}/pending-claim`, pending)).status).toBe(200)
    const claim = {
      operationId: 'auction-claim:claim',
      auctionId: 'auction-claim',
      winnerId: winner,
      productId: product,
    }
    const claimed = await post(`${base}/${commitmentId}/claim`, claim)
    expect(claimed.status).toBe(200)
    expect(claimed.body).toMatchObject({ status: 'CLAIMED', winnerId: winner, applied: true })
    const replay = await post(`${base}/${commitmentId}/claim`, claim)
    expect(replay.body).toMatchObject({ status: 'CLAIMED', winnerId: winner, applied: false })
    expect(
      (await inventory.findByOwner(PlayerId.create(winner)))?.quantityOf({
        value: product,
      } as never),
    ).toBe(1)
  })
  it('protege por caller, firma, timestamp y body', async () => {
    const body = commit('auction-c')
    for (const caller of ['commerce', 'combat', 'notifications'])
      expect((await post(base, body, caller)).status).toBe(401)
    expect((await post(base, body, 'auction', String(Date.now()), 'bad')).status).toBe(401)
    const old = '0'
    expect((await post(base, body, 'auction', old)).status).toBe(401)
    const timestamp = String(Date.now())
    const signed = signInternalRequest(secret, {
      service: 'auction',
      method: 'POST',
      path: base,
      timestamp,
      body,
    })
    expect(
      (await post(base, { ...body, auctionId: 'changed' }, 'auction', timestamp, signed)).status,
    ).toBe(401)
  })
  it('valida DTO y niega auction en grants', async () => {
    expect((await post(base, { ...commit('x'), operationId: '' })).status).toBe(400)
    const grants = '/api/internal/v1/inventory/grants'
    const body = {
      operationId: '22222222-2222-4222-8222-222222222222',
      playerId: 'p',
      items: [{ productId: product, quantity: 1 }],
    }
    expect((await post(grants, body)).status).toBe(401)
    expect((await post(grants, body, 'commerce')).status).toBe(200)
  })
  it('mapea not found, conflicto, estado invalido y fallo inesperado', async () => {
    await seed()
    const missing = {
      operationId: 'missing:release',
      auctionId: 'missing',
      ownerId: owner,
      productId: product,
      reason: 'AUCTION_WITHOUT_BIDS',
    }
    expect((await post(`${base}/missing/release`, missing)).status).toBe(404)
    expect(
      (
        await post(`${base}/missing/claim`, {
          operationId: 'missing:claim',
          auctionId: 'missing',
          winnerId: 'winner',
          productId: product,
        })
      ).status,
    ).toBe(404)
    const first = await post(base, commit('conflict'))
    const firstId = commitmentIdOf(first.body)
    expect((await post(base, { ...commit('conflict'), ownerId: 'other' })).status).toBe(409)
    expect(
      (
        await post(`${base}/${firstId}/claim`, {
          operationId: 'conflict:claim-too-early',
          auctionId: 'conflict',
          winnerId: 'winner',
          productId: product,
        })
      ).status,
    ).toBe(422)
    const pending = {
      operationId: 'conflict:pending',
      auctionId: 'conflict',
      sellerId: owner,
      winnerId: 'winner',
      productId: product,
    }
    expect((await post(`${base}/${firstId}/pending-claim`, pending)).status).toBe(200)
    expect(
      (
        await post(`${base}/${firstId}/release`, {
          ...missing,
          operationId: 'conflict:release',
          auctionId: 'conflict',
        })
      ).status,
    ).toBe(422)
    const spy = jest
      .spyOn(commitments, 'commit')
      .mockRejectedValueOnce(new Error('database unavailable'))
    expect((await post(base, commit('unavailable'))).status).toBe(503)
    spy.mockRestore()
  })
})
