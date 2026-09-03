import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator'

export class InventoryGrantItemRequest {
  @IsUUID()
  productId!: string

  @IsInt()
  @Min(1)
  @Max(9999)
  quantity!: number
}

export class InventoryGrantRequest {
  @IsUUID()
  operationId!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  playerId!: string

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => InventoryGrantItemRequest)
  items!: InventoryGrantItemRequest[]
}
