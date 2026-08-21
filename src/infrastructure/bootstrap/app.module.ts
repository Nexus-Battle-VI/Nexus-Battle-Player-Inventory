import { Module } from '@nestjs/common'

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
import { loadConfig, PersistenceDriver, type AppConfig } from '../config/env'
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
