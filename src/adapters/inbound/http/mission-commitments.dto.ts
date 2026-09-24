import { Type } from 'class-transformer'
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'

export class MissionCommitmentRequirements {
  @IsBoolean()
  completeLoadout!: boolean
}

export class CreateMissionCommitmentRequest {
  @IsUUID()
  operationId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  playerId!: string

  @IsIn(['MISSION'])
  purpose!: 'MISSION'

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  reference!: string

  @IsDateString()
  expiresAt!: string

  @ValidateNested()
  @Type(() => MissionCommitmentRequirements)
  requirements!: MissionCommitmentRequirements
}
