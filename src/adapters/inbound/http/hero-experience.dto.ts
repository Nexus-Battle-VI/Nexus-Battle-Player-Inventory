import { ApiExtraModels, ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger'
import { IsInt, IsNumber, IsObject, IsString } from 'class-validator'

/**
 * Cuerpo de `POST /api/internal/v1/players/{playerId}/heroes/{heroId}/experience`
 * (HU-09, Task HU-09.3; `hu-09-experience-reward-v1` §7).
 *
 * SOLO DECLARA TIPOS DONDE EL CONTRATO TIENE UN CODIGO PROPIO.
 *   - `schemaVersion` es `@IsInt()` y NO `@Equals(1)`: una version distinta es un
 *     rechazo de ESQUEMA y su `400 SCHEMA_INVALID` lo produce el caso de uso, que
 *     es quien puede devolver el `code` del contrato. Una regla puesta aqui
 *     saldria del `ValidationPipe` global con el cuerpo estandar de Nest, sin
 *     `code`.
 *   - `amount` es `@IsNumber()` y NO `@IsInt()`: un importe fraccionario o
 *     negativo tiene que responder `422 EXPERIENCE_GRANT_REJECTED`, y para eso
 *     tiene que llegar al caso de uso. Aqui solo se comprueba que sea un numero;
 *     un texto sigue siendo `400`, que es lo que corresponde a un cuerpo mal
 *     formado.
 */
/**
 * Origen de HU-09: la derrota concreta de un NPC. **Solo documenta el contrato**
 * (Swagger): NO valida. La validacion de cada variante, campo a campo, la hace el
 * caso de uso (ver `GrantHeroExperience`), porque es quien puede devolver el `400
 * SCHEMA_INVALID` con su `code`.
 */
export class MissionRivalDefeatSourceRequest {
  @ApiProperty({ enum: ['MISSION_RIVAL_DEFEAT'], description: 'HU-09: XP por derrota de un NPC.' })
  kind!: string

  @ApiProperty() enrollmentId!: string
  @ApiProperty() simulationId!: string
  @ApiProperty({ description: 'Indice del encuentro dentro de la mision.' })
  encounterId!: string

  @ApiProperty({ description: 'Instancia concreta del enemigo: `<enemyRef>#<n>`.' })
  enemyInstanceId!: string

  @ApiProperty({ description: 'Arquetipo del enemigo. Trazabilidad; no identifica la derrota.' })
  rivalRef!: string

  @ApiProperty({
    minimum: 1,
    description: 'Cara del dado que produjo el importe (1d8, de Combat).',
  })
  roll!: number
}

/**
 * Origen de HU-10: la finalizacion de la mision (`hu-10-mission-completion-reward-v1`
 * §8). NO lleva `encounterId`, `enemyInstanceId`, `rivalRef` ni `roll`: no hay derrota.
 */
export class MissionCompletionSourceRequest {
  @ApiProperty({
    enum: ['MISSION_COMPLETION'],
    description: 'HU-10: XP de finalizacion de la mision.',
  })
  kind!: string

  @ApiProperty() enrollmentId!: string
  @ApiProperty() missionId!: string
  @ApiProperty() simulationId!: string

  @ApiProperty({
    enum: ['NORMAL', 'HEROIC', 'LEGENDARY', 'MYTHIC'],
    description: 'Dificultad realmente ejecutada. Player/Inventory valida la forma, no la decide.',
  })
  difficulty!: string

  @ApiProperty({ enum: ['COMPLETED', 'FAILED'] })
  missionOutcome!: string
}

@ApiExtraModels(MissionRivalDefeatSourceRequest, MissionCompletionSourceRequest)
export class HeroExperienceRequest {
  @ApiProperty({ enum: [1], description: 'Version del esquema del contrato interno.' })
  @IsInt()
  schemaVersion!: number

  @ApiProperty({
    description:
      'Clave de ESTA acreditacion para ESTE heroe. HU-09: ' +
      '`mission:{enrollmentId}:encounter:{encounterId}:enemy:{enemyInstanceId}:hero:{heroId}:xp`. ' +
      'HU-10: `mission:{enrollmentId}:reward:completion:xp`.',
  })
  @IsString()
  operationId!: string

  @ApiProperty({
    minimum: 0,
    description:
      'Experiencia a acreditar: entera y no negativa. Ya viene decidida por Missions ' +
      '(HU-09: formula; HU-10: monto del contenido congelado); aqui no se calcula.',
  })
  @IsNumber()
  amount!: number

  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(MissionRivalDefeatSourceRequest) },
      { $ref: getSchemaPath(MissionCompletionSourceRequest) },
    ],
    discriminator: { propertyName: 'kind' },
    description: 'Union discriminada por `kind`; cada variante admite exactamente sus campos.',
  })
  @IsObject()
  source!: Record<string, unknown>
}

/**
 * Umbral del siguiente nivel. Union discriminada, igual que `ExperienceThreshold`
 * de HU-08: en `MAX_LEVEL` no hay nivel siguiente y los otros dos campos son
 * nulos, en lugar de inventar un nivel 9.
 */
export class NextLevelResponse {
  @ApiProperty({ enum: ['AVAILABLE', 'MAX_LEVEL'] }) status!: string
  @ApiPropertyOptional({ nullable: true }) forNextLevel!: number | null
  @ApiPropertyOptional({ nullable: true, description: 'Experiencia ACUMULADA necesaria.' })
  amount!: number | null
}

/** Respuesta de §7, campo a campo. */
export class HeroExperienceResponse {
  @ApiProperty() operationId!: string
  @ApiProperty({ description: '`false` en un replay: la acreditacion ya estaba hecha.' })
  applied!: boolean
  @ApiProperty() heroId!: string
  @ApiProperty({ minimum: 1, maximum: 8 }) level!: number
  @ApiProperty({ description: 'Experiencia ACUMULADA. Solo crece; nunca se descuenta.' })
  currentXp!: number
  @ApiProperty() leveledUp!: boolean
  @ApiProperty({ description: 'Niveles cruzados con ESTA acreditacion.' }) levelsGained!: number
  @ApiProperty({ type: NextLevelResponse }) nextLevel!: NextLevelResponse
  @ApiProperty({ enum: [8] }) maxLevel!: number
}
