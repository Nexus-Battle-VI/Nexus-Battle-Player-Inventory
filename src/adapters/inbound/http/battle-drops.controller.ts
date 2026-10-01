import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { DomainError } from '../../../domain/errors/DomainError'
import {
  BattleDropTransferConflictError,
  BattleDropTransferRejectedError,
  type BattleDropTransferResult,
} from '../../../application/ports/BattleDropTransferPort'
import { TransferBattleDrop } from '../../../application/use-cases/TransferBattleDrop'
import {
  BattleDropRateUnavailableError,
  CaptureBattleDropSnapshot,
} from '../../../application/use-cases/CaptureBattleDropSnapshot'
import {
  BattleDropSnapshotConflictError,
  BattleDropSnapshotRejectedError,
  BATTLE_DROP_SNAPSHOTS,
  type BattleDropSnapshotPort,
  type BattleDropSnapshot,
} from '../../../application/ports/BattleDropSnapshotPort'
import { CatalogUnavailableError } from '../../../application/ports/CatalogReadPort'
import { InternalCallers, InternalOnly } from './auth/decorators'
import { CaptureBattleDropSnapshotRequest, TransferBattleDropRequest } from './battle-drops.dto'
import { CAPTURE_BATTLE_DROP_SNAPSHOT, TRANSFER_BATTLE_DROP } from './tokens'

/** Solo Combat puede acreditar un derecho HU-30 ya determinado al FINISHED. */
@ApiTags('internal-combat')
@ApiHeader({ name: 'x-internal-service', required: true, description: 'combat' })
@ApiHeader({ name: 'x-internal-timestamp', required: true })
@ApiHeader({ name: 'x-internal-signature', required: true })
@InternalOnly()
@InternalCallers('combat')
@Controller('internal/v1/inventory/battle-drops')
export class BattleDropsController {
  constructor(
    @Inject(TRANSFER_BATTLE_DROP) private readonly transfer: TransferBattleDrop,
    @Inject(CAPTURE_BATTLE_DROP_SNAPSHOT) private readonly capture: CaptureBattleDropSnapshot,
    @Inject(BATTLE_DROP_SNAPSHOTS) private readonly snapshots: BattleDropSnapshotPort,
  ) {}

  @Get('snapshots/:battleId/:playerId')
  @ApiOperation({ summary: 'Leer la instantánea congelada de equipamiento de una batalla' })
  async getSnapshot(
    @Param('battleId') battleId: string,
    @Param('playerId') playerId: string,
  ): Promise<BattleDropSnapshot> {
    const snapshot = await this.snapshots.find(battleId, playerId)
    if (snapshot === null) throw new NotFoundException('La instantánea no existe.')
    return snapshot
  }

  @Post('battles/:battleId/close')
  @HttpCode(204)
  @ApiOperation({ summary: 'Liberar reservas no transferidas tras liquidar la batalla' })
  async closeBattle(@Param('battleId') battleId: string): Promise<void> {
    if (battleId.trim() === '') throw new BadRequestException('battleId es obligatorio.')
    await this.snapshots.closeBattle(battleId)
  }

  @Post('snapshots')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Congelar unidades equipadas y sus tasas para una batalla comprometida',
  })
  async snapshot(@Body() body: CaptureBattleDropSnapshotRequest): Promise<BattleDropSnapshot> {
    try {
      return await this.capture.execute(body)
    } catch (error: unknown) {
      if (error instanceof BattleDropSnapshotConflictError) {
        throw new ConflictException({
          code: 'BATTLE_DROP_SNAPSHOT_CONFLICT',
          message: error.message,
        })
      }
      if (
        error instanceof BattleDropSnapshotRejectedError ||
        error instanceof BattleDropRateUnavailableError
      ) {
        throw new UnprocessableEntityException({
          code:
            error instanceof BattleDropRateUnavailableError ? 'DROP_RATE_UNAVAILABLE' : error.code,
          message: error.message,
        })
      }
      if (error instanceof CatalogUnavailableError)
        throw new ServiceUnavailableException(error.message)
      throw new ServiceUnavailableException(
        'La instantánea de drop no pudo confirmarse; reintente.',
      )
    }
  }

  @Post('transfers')
  @HttpCode(200)
  @ApiOperation({ summary: 'Transferir una misma instancia por drop de batalla' })
  @ApiResponse({ status: 200, description: 'Acreditado o replay idempotente' })
  @ApiResponse({ status: 401, description: 'Firma HMAC inválida o caller no autorizado' })
  @ApiResponse({ status: 409, description: 'operationId reutilizado con otro contenido' })
  @ApiResponse({ status: 422, description: 'Instancia no propia o inventario destino lleno' })
  async execute(@Body() body: TransferBattleDropRequest): Promise<BattleDropTransferResult> {
    try {
      return await this.transfer.execute({
        operationId: body.operationId,
        battleId: body.battleId,
        defeatEventSeq: body.defeatEventSeq,
        sourcePlayerId: body.sourcePlayerId,
        targetPlayerId: body.targetPlayerId,
        productInstanceId: body.productInstanceId,
      })
    } catch (error: unknown) {
      if (error instanceof BattleDropTransferConflictError) {
        throw new ConflictException({ code: 'OPERATION_ID_REUSED', message: error.message })
      }
      if (error instanceof BattleDropTransferRejectedError) {
        throw new UnprocessableEntityException({ code: error.code, message: error.message })
      }
      if (error instanceof DomainError) throw new BadRequestException(error.message)
      throw new ServiceUnavailableException('La transferencia no pudo confirmarse; reintente.')
    }
  }
}
