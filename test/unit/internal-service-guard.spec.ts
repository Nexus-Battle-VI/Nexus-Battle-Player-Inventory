import { UnauthorizedException, type ExecutionContext } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'

import {
  InternalServiceGuard,
  type InternalServiceGuardOptions,
} from '../../src/adapters/inbound/http/auth/internal-service.guard'
import { INTERNAL_CALLERS, IS_INTERNAL } from '../../src/adapters/inbound/http/auth/decorators'
import { signInternalRequest } from '../../src/adapters/outbound/identity/internal-signature'
import type { Logger } from '../../src/infrastructure/observability/logger'

const secret = 'internal-service-guard-test-secret'
const path = '/api/internal-test'
const now = new Date('2026-09-24T00:00:00.000Z')

const logger: Logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}

const reflectorFor = (callers?: readonly string[]): Reflector =>
  ({
    getAllAndOverride: (key: string): unknown => {
      if (key === IS_INTERNAL) return true
      if (key === INTERNAL_CALLERS) return callers
      return undefined
    },
  }) as unknown as Reflector

const contextFor = (service: string, signature?: string): ExecutionContext => {
  const timestamp = String(now.getTime())
  const signed =
    signature ?? signInternalRequest(secret, { service, method: 'GET', path, timestamp, body: {} })
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        originalUrl: path,
        headers: {
          'x-internal-service': service,
          'x-internal-timestamp': timestamp,
          'x-internal-signature': signed,
        },
        body: {},
      }),
    }),
  } as unknown as ExecutionContext
}

const guardFor = (callers?: readonly string[]): InternalServiceGuard => {
  const options: InternalServiceGuardOptions = {
    reflector: reflectorFor(callers),
    secret,
    allowedServices: ['commerce', 'notifications', 'combat', 'auction'],
    clock: { now: () => now },
    logger,
  }
  return new InternalServiceGuard(options)
}

describe('InternalServiceGuard', () => {
  it('acepta auction con HMAC valido mediante el allowlist global', () => {
    expect(guardFor().canActivate(contextFor('auction'))).toBe(true)
  })

  it('mantiene la restriccion por endpoint aunque auction este en el allowlist global', () => {
    expect(() => guardFor(['commerce']).canActivate(contextFor('auction'))).toThrow(
      UnauthorizedException,
    )
  })

  it('rechaza un caller ausente del allowlist global y una firma invalida', () => {
    expect(() => guardFor().canActivate(contextFor('web'))).toThrow(UnauthorizedException)
    expect(() => guardFor().canActivate(contextFor('auction', 'invalida'))).toThrow(
      UnauthorizedException,
    )
  })
})
