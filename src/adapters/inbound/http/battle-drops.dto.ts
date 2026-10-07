import { IsInt, IsNotEmpty, IsString, IsUUID, Min } from 'class-validator'

export class TransferBattleDropRequest {
  @IsUUID()
  readonly operationId!: string

  @IsString()
  @IsNotEmpty()
  readonly battleId!: string

  @IsInt()
  @Min(1)
  readonly defeatEventSeq!: number

  @IsString()
  @IsNotEmpty()
  readonly sourcePlayerId!: string

  @IsString()
  @IsNotEmpty()
  readonly targetPlayerId!: string

  @IsString()
  @IsNotEmpty()
  readonly productInstanceId!: string
}

export class CaptureBattleDropSnapshotRequest {
  @IsString()
  @IsNotEmpty()
  readonly battleId!: string

  @IsString()
  @IsNotEmpty()
  readonly playerId!: string

  @IsString()
  @IsNotEmpty()
  readonly heroId!: string

  @IsInt()
  @Min(0)
  readonly loadoutVersion!: number
}
