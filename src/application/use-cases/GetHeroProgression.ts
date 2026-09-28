import { MAX_HERO_LEVEL, MIN_HERO_LEVEL } from '../../domain/value-objects/hero-level'
import { HeroProgression } from '../../domain/entities/HeroProgression'
import { DomainError } from '../../domain/errors/DomainError'
import { experienceRequiredForNextLevel } from '../../domain/policies/ExperiencePolicy'
import { PlayerId } from '../../domain/value-objects/identifiers'
import type { HeroProgressionDto } from '../dto/HeroProgressionDto'
import type { HeroProgressionRepositoryPort } from '../ports/HeroProgressionRepositoryPort'

/**
 * Progresion del heroe preparado del jugador autenticado (HU-08, RF-08).
 *
 * Solo lee. La identidad sale del sujeto verificado del testimonio y NUNCA de la
 * peticion, igual que `GetHeroSelection` (HU-07): no hay identificador
 * manipulable con el que ver la progresion de otra persona.
 *
 * CREACION PEREZOSA. Un heroe sin documento de progresion no es un error: se
 * interpreta como el estado inicial (nivel 1 con 0 de experiencia) y NO se
 * escribe nada. El estado inicial es el valor por defecto del dominio, no un dato
 * que haya que sembrar; sembrarlo obligaria a un backfill y a crear documentos al
 * seleccionar un heroe.
 *
 * EL UMBRAL SE DERIVA EN LA LECTURA, no se almacena. Es la misma regla que
 * `HeroProgression.thresholdForNextLevel()` aplica delegando en
 * `ExperiencePolicy`.
 *
 * TRAZABILIDAD: nacio en la Task #188 (diseno) y se implementa en la #189, junto
 * con el adaptador de persistencia.
 */
export class GetHeroProgression {
  constructor(private readonly progressions: HeroProgressionRepositoryPort) {}

  async execute(ownerId: string, heroId: string): Promise<HeroProgressionDto> {
    const owner = PlayerId.create(ownerId)
    // El heroe se normaliza con la MISMA forma con la que el adaptador construye
    // la clave del documento. Sin esto, un `heroId` con espacios leería una
    // progresion y devolvería otra, y la creacion perezosa de abajo guardaria una
    // clave distinta de la que se acaba de buscar.
    const heroReference = requireHeroReference(heroId)

    const stored = await this.progressions.findByHero(owner, heroReference)
    const progression = stored ?? HeroProgression.createEmpty(owner.value, heroReference)

    return {
      heroId: progression.heroId,
      level: progression.level.value,
      currentXp: progression.experience.currentXp,
      floorForCurrentLevel: floorForCurrentLevel(progression.level.value),
      nextLevel: progression.thresholdForNextLevel(),
      maxLevel: MAX_HERO_LEVEL,
    }
  }
}

/**
 * Experiencia acumulada minima para estar en `level`, para que quien pinte una
 * barra de progreso no tenga que conocer la tabla de `ExperiencePolicy`.
 *
 * El nivel 1 es el suelo (HU-08, docs/hu-08-progresion.md seccion 2): no hace
 * falta experiencia para tenerlo, asi que su piso es `0` y no el valor literal
 * de la tabla (`EXPERIENCE_THRESHOLDS[0] = 100`), que la propia politica
 * documenta como "redundante en la practica" para ese nivel. Para `level >= 2`
 * el piso ES el umbral que llevo al heroe hasta ahi: el mismo numero que
 * `experienceRequiredForNextLevel(level - 1)` calculo como `amount` para
 * alcanzarlo. No se reimplementa la tabla: se pide ese resultado.
 */
const floorForCurrentLevel = (level: number): number => {
  if (level <= MIN_HERO_LEVEL) {
    return 0
  }

  const thresholdToReachCurrentLevel = experienceRequiredForNextLevel(level - 1)

  // `level - 1` esta siempre en `1..7` cuando `level` esta en `2..8`, asi que la
  // politica SIEMPRE responde `AVAILABLE` aqui; `MAX_LEVEL` es inalcanzable en
  // esta rama. Se comprueba en vez de forzar el tipo (nada de `as`).
  return thresholdToReachCurrentLevel.status === 'AVAILABLE'
    ? thresholdToReachCurrentLevel.amount
    : 0
}

/** Rechaza una referencia de heroe vacia en la frontera del caso de uso. */
const requireHeroReference = (raw: string): string => {
  const normalized = raw.trim()

  if (normalized.length === 0) {
    throw new DomainError('La progresion necesita un heroe.')
  }

  return normalized
}
