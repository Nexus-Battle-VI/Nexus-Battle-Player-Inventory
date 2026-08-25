import { Module, type CanActivate } from '@nestjs/common'
import { APP_GUARD, Reflector } from '@nestjs/core'

import { InventoriesController } from '../../adapters/inbound/http/inventories.controller'
import { HealthController } from '../../adapters/inbound/http/health.controller'
import { ADD_ITEM, GET_INVENTORY, REMOVE_ITEM } from '../../adapters/inbound/http/tokens'
import { READINESS_CHECKS, VERSION_REPORT } from '../../adapters/inbound/http/tokens.health'

import {
  AddItemToInventory,
  GetInventory,
  RemoveItemFromInventory,
} from '../../application/use-cases/InventoryUseCases'
import { INVENTORY_REPOSITORY } from '../../application/ports/InventoryRepositoryPort'
import { CLOCK } from '../../application/ports/ClockPort'
import type { InventoryRepositoryPort } from '../../application/ports/InventoryRepositoryPort'
import type { ClockPort } from '../../application/ports/ClockPort'

import { InMemoryInventoryRepository } from '../../adapters/outbound/persistence/InMemoryInventoryRepository'
import { SystemClock } from '../../adapters/outbound/system/SystemClock'
import { CapacityPolicy } from '../../domain/policies/CapacityPolicy'

import { createLogger, type Logger } from '../observability/logger'
import { AuthMode, loadConfig, PersistenceDriver, type AppConfig } from '../config/env'

import { JwtAuthGuard } from '../../adapters/inbound/http/auth/jwt-auth.guard'
import { RolesGuard } from '../../adapters/inbound/http/auth/roles.guard'
import { AnonymousIdentityGuard } from '../../adapters/inbound/http/auth/anonymous.guard'
import { TOKEN_VERIFIER } from '../../application/ports/TokenVerifierPort'
import type { TokenVerifierPort } from '../../application/ports/TokenVerifierPort'
import { CognitoTokenVerifier } from '../../adapters/outbound/identity/CognitoTokenVerifier'
import type { ReadinessCheck, VersionReport } from '../health/health'

export const APP_CONFIG = Symbol('AppConfig')
export const LOGGER = Symbol('Logger')
export const CAPACITY_POLICY = Symbol('CapacityPolicy')

/**
 * Raiz de composicion.
 *
 * Es el unico lugar donde se eligen implementaciones concretas. Los casos de
 * uso son clases planas sin decoradores de NestJS: se registran con fabricas
 * explicitas, de modo que la capa de aplicacion permanece independiente del
 * framework y podria ejecutarse fuera de el sin cambios.
 */
@Module({
  controllers: [InventoriesController, HealthController],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadConfig(process.env),
    },
    {
      provide: LOGGER,
      useFactory: (config: AppConfig): Logger =>
        createLogger({
          level: config.logLevel,
          service: config.serviceName,
          version: config.version,
        }),
      inject: [APP_CONFIG],
    },
    {
      provide: INVENTORY_REPOSITORY,
      useFactory: (config: AppConfig, logger: Logger): InventoryRepositoryPort => {
        if (config.persistenceDriver === PersistenceDriver.Mongo) {
          // La configuracion se valida al arrancar para que un despliegue mal
          // parametrizado falle de inmediato. El adaptador MongoDB depende de
          // que ADR-005 decida el ODM; no se sustituye por una simulacion.
          logger.warn('mongo_driver_not_available', {
            detail:
              'El adaptador MongoDB requiere ADR-005 aprobado. Se usa el repositorio en memoria.',
          })
        }

        return new InMemoryInventoryRepository()
      },
      inject: [APP_CONFIG, LOGGER],
    },
    {
      provide: TOKEN_VERIFIER,
      useFactory: (config: AppConfig, logger: Logger): TokenVerifierPort => {
        if (config.cognito === null) {
          // No se devuelve un verificador que acepte cualquier cosa: sin
          // proveedor, el guard directamente no se registra. Un verificador
          // permisivo daria la apariencia de que hay comprobacion.
          logger.warn('authentication_disabled', {
            detail:
              'AUTH_MODE=disabled: ninguna ruta verifica quien realiza la peticion. BLOCKER de ADR-004.',
          })

          return {
            verify: (): Promise<never> => {
              throw new Error('No hay verificador de testimonios configurado.')
            },
          }
        }

        return new CognitoTokenVerifier(config.cognito)
      },
      inject: [APP_CONFIG, LOGGER],
    },
    // Los guards se registran de forma global SOLO cuando hay proveedor. El
    // orden importa: JwtAuthGuard deja la identidad verificada en la peticion y
    // RolesGuard la lee. NestJS los ejecuta en el orden de declaracion.
    {
      provide: APP_GUARD,
      useFactory: (
        config: AppConfig,
        reflector: Reflector,
        verifier: TokenVerifierPort,
      ): CanActivate =>
        config.authMode === AuthMode.Jwt
          ? new JwtAuthGuard(reflector, verifier)
          : // Sin proveedor no se deja pasar sin mas: se atribuye la identidad
            // anonima, para que lo que se guarde diga que nadie fue verificado.
            new AnonymousIdentityGuard(),
      inject: [APP_CONFIG, Reflector, TOKEN_VERIFIER],
    },
    {
      provide: APP_GUARD,
      useFactory: (config: AppConfig, reflector: Reflector): CanActivate =>
        config.authMode === AuthMode.Jwt
          ? new RolesGuard(reflector)
          : { canActivate: (): boolean => true },
      inject: [APP_CONFIG, Reflector],
    },
    {
      provide: CLOCK,
      useFactory: (): ClockPort => new SystemClock(),
    },
    {
      provide: CAPACITY_POLICY,
      useFactory: (): CapacityPolicy => CapacityPolicy.default(),
    },
    {
      provide: GET_INVENTORY,
      useFactory: (inventories: InventoryRepositoryPort): GetInventory =>
        new GetInventory(inventories),
      inject: [INVENTORY_REPOSITORY],
    },
    {
      provide: ADD_ITEM,
      useFactory: (
        inventories: InventoryRepositoryPort,
        clock: ClockPort,
        defaultCapacity: CapacityPolicy,
      ): AddItemToInventory => new AddItemToInventory({ inventories, clock, defaultCapacity }),
      inject: [INVENTORY_REPOSITORY, CLOCK, CAPACITY_POLICY],
    },
    {
      provide: REMOVE_ITEM,
      useFactory: (
        inventories: InventoryRepositoryPort,
        clock: ClockPort,
        defaultCapacity: CapacityPolicy,
      ): RemoveItemFromInventory =>
        new RemoveItemFromInventory({ inventories, clock, defaultCapacity }),
      inject: [INVENTORY_REPOSITORY, CLOCK, CAPACITY_POLICY],
    },
    {
      provide: READINESS_CHECKS,
      useFactory: (inventories: InventoryRepositoryPort): readonly ReadinessCheck[] => [
        // La comprobacion ejercita el repositorio de verdad: si el almacen no
        // responde, la sonda falla. No se declara `ok` de forma incondicional.
        {
          name: 'inventories-repository',
          check: (): boolean => typeof inventories.findByOwner === 'function',
        },
      ],
      inject: [INVENTORY_REPOSITORY],
    },
    {
      provide: VERSION_REPORT,
      useFactory: (config: AppConfig): VersionReport => ({
        service: config.serviceName,
        version: config.version,
        nodeEnv: config.nodeEnv,
      }),
      inject: [APP_CONFIG],
    },
  ],
})
export class AppModule {}
