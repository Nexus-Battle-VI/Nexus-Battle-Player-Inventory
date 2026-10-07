import 'reflect-metadata'

import { ValidationPipe, type INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { signInternalRequest } from '../../src/adapters/outbound/identity/internal-signature'
import { AppModule, APP_CONFIG } from '../../src/infrastructure/bootstrap/app.module'
import { loadConfig } from '../../src/infrastructure/config/env'
import {
  CAPTURE_BATTLE_DROP_SNAPSHOT,
  TRANSFER_BATTLE_DROP,
} from '../../src/adapters/inbound/http/tokens'
import {
  BATTLE_DROP_SNAPSHOTS,
  BattleDropSnapshotConflictError,
  BattleDropSnapshotRejectedError,
} from '../../src/application/ports/BattleDropSnapshotPort'
import {
  BattleDropTransferConflictError,
  BattleDropTransferRejectedError,
} from '../../src/application/ports/BattleDropTransferPort'
import { BattleDropRateUnavailableError } from '../../src/application/use-cases/CaptureBattleDropSnapshot'
import { CatalogUnavailableError } from '../../src/application/ports/CatalogReadPort'
import { DomainError } from '../../src/domain/errors/DomainError'

/**
 * Frontera HTTP de las rutas internas de drop (HU-30, Task HU-30.3).
 *
 * Los casos de uso se sustituyen por dobles controlables: lo que se prueba
 * aqui es la traduccion de errores a codigos HTTP y la seguridad HMAC/caller,
 * no la logica de negocio (que tiene su propia prueba unitaria real) ni la
 * persistencia (que tiene su propia prueba contra Mongo real).
 */
const SECRET = 'battle-drops-test-secret'
const BASE = '/api/internal/v1/inventory/battle-drops'

describe('Rutas internas de drop de batalla (HU-30)', () => {
  let app: INestApplication
  const capture = jest.fn()
  const transfer = jest.fn()
  const snapshots = { capture: jest.fn(), find: jest.fn(), closeBattle: jest.fn() }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(
        loadConfig({
          NODE_ENV: 'test',
          AUTH_MODE: 'disabled',
          INTERNAL_SERVICE_AUTH_SECRET: SECRET,
        }),
      )
      .overrideProvider(CAPTURE_BATTLE_DROP_SNAPSHOT)
      .useValue({ execute: capture })
      .overrideProvider(TRANSFER_BATTLE_DROP)
      .useValue({ execute: transfer })
      .overrideProvider(BATTLE_DROP_SNAPSHOTS)
      .useValue(snapshots)
      .compile()

    app = module.createNestApplication()
    app.setGlobalPrefix('api')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  const signed = (
    method: 'post' | 'get',
    path: string,
    body: object | undefined,
    service = 'combat',
  ) => {
    const timestamp = String(Date.now())
    const payload = body ?? {}
    const signature = signInternalRequest(SECRET, {
      service,
      method: method.toUpperCase(),
      path,
      timestamp,
      body: payload,
    })

    const req = request(app.getHttpServer())
      [method](path)
      .set('x-internal-service', service)
      .set('x-internal-timestamp', timestamp)
      .set('x-internal-signature', signature)

    return method === 'post' ? req.send(payload) : req
  }

  const snapshotBody = {
    battleId: 'battle-1',
    playerId: 'jugador-1',
    heroId: 'heroe-1',
    loadoutVersion: 0,
  }

  const transferBody = {
    operationId: '11111111-1111-4111-8111-111111111111',
    battleId: 'battle-1',
    defeatEventSeq: 1,
    sourcePlayerId: 'jugador-b',
    targetPlayerId: 'jugador-a',
    productInstanceId: 'unidad-1',
  }

  describe('POST .../snapshots', () => {
    it('sin firma o con un servicio no autorizado: 401', async () => {
      await request(app.getHttpServer()).post(`${BASE}/snapshots`).send(snapshotBody).expect(401)
      await signed('post', `${BASE}/snapshots`, snapshotBody, 'missions').expect(401)
      expect(capture).not.toHaveBeenCalled()
    })

    it('capturada con exito: 200 y el cuerpo del contrato', async () => {
      capture.mockResolvedValue({ ...snapshotBody, equipment: [] })

      const response = await signed('post', `${BASE}/snapshots`, snapshotBody)

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ battleId: 'battle-1' })
    })

    it('conflicto de instantanea: 409', async () => {
      capture.mockRejectedValue(new BattleDropSnapshotConflictError())

      await signed('post', `${BASE}/snapshots`, snapshotBody).expect(409)
    })

    it('instantanea rechazada (loadout cambiado): 422 con el codigo del dominio', async () => {
      capture.mockRejectedValue(new BattleDropSnapshotRejectedError('LOADOUT_CHANGED'))

      const response = await signed('post', `${BASE}/snapshots`, snapshotBody)

      expect(response.status).toBe(422)
      expect(response.body.code).toBe('LOADOUT_CHANGED')
    })

    it('tasa de caida no disponible: 422 con DROP_RATE_UNAVAILABLE', async () => {
      capture.mockRejectedValue(new BattleDropRateUnavailableError('producto-1'))

      const response = await signed('post', `${BASE}/snapshots`, snapshotBody)

      expect(response.status).toBe(422)
      expect(response.body.code).toBe('DROP_RATE_UNAVAILABLE')
    })

    it('Catalog no disponible: 503', async () => {
      capture.mockRejectedValue(new CatalogUnavailableError('no responde'))

      await signed('post', `${BASE}/snapshots`, snapshotBody).expect(503)
    })

    it('fallo no clasificado: 503, nunca una excepcion sin traducir', async () => {
      capture.mockRejectedValue(new Error('fallo inesperado'))

      await signed('post', `${BASE}/snapshots`, snapshotBody).expect(503)
    })
  })

  describe('GET .../snapshots/:battleId/:playerId', () => {
    it('no encontrada: 404', async () => {
      snapshots.find.mockResolvedValue(null)

      await signed('get', `${BASE}/snapshots/battle-1/jugador-1`, undefined).expect(404)
    })

    it('encontrada: 200 con el cuerpo', async () => {
      snapshots.find.mockResolvedValue({ ...snapshotBody, equipment: [] })

      const response = await signed('get', `${BASE}/snapshots/battle-1/jugador-1`, undefined)

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ battleId: 'battle-1' })
    })
  })

  describe('POST .../battles/:battleId/close', () => {
    it('cierra la reserva: 204', async () => {
      await signed('post', `${BASE}/battles/battle-1/close`, {}).expect(204)
      expect(snapshots.closeBattle).toHaveBeenCalledWith('battle-1')
    })
  })

  describe('POST .../transfers', () => {
    it('sin firma: 401', async () => {
      await request(app.getHttpServer()).post(`${BASE}/transfers`).send(transferBody).expect(401)
      expect(transfer).not.toHaveBeenCalled()
    })

    it('acreditada: 200 con el recibo', async () => {
      transfer.mockResolvedValue({
        ...transferBody,
        productId: 'p',
        itemId: 'i',
        creditedAt: '2026-10-01T00:00:00.000Z',
      })

      const response = await signed('post', `${BASE}/transfers`, transferBody)

      expect(response.status).toBe(200)
      expect(response.body).toMatchObject({ productInstanceId: 'unidad-1' })
    })

    it('operationId reutilizado con otro contenido: 409', async () => {
      transfer.mockRejectedValue(new BattleDropTransferConflictError())

      const response = await signed('post', `${BASE}/transfers`, transferBody)

      expect(response.status).toBe(409)
      expect(response.body.code).toBe('OPERATION_ID_REUSED')
    })

    it('instancia no propia: 422 con el codigo del dominio', async () => {
      transfer.mockRejectedValue(new BattleDropTransferRejectedError('INSTANCE_NOT_OWNED'))

      const response = await signed('post', `${BASE}/transfers`, transferBody)

      expect(response.status).toBe(422)
      expect(response.body.code).toBe('INSTANCE_NOT_OWNED')
    })

    it('error de forma del dominio: 400', async () => {
      transfer.mockRejectedValue(new DomainError('campo invalido'))

      await signed('post', `${BASE}/transfers`, transferBody).expect(400)
    })

    it('fallo no clasificado: 503', async () => {
      transfer.mockRejectedValue(new Error('fallo inesperado'))

      await signed('post', `${BASE}/transfers`, transferBody).expect(503)
    })
  })
})
