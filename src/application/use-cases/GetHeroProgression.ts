import { MAX_HERO_LEVEL } from '../../domain/value-objects/hero-level'
import { HeroProgression } from '../../domain/entities/HeroProgression'
import { DomainError } from '../../domain/errors/DomainError'
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
      nextLevel: progression.thresholdForNextLevel(),
      maxLevel: MAX_HERO_LEVEL,
    }
  }
}

/** Rechaza una referencia de heroe vacia en la frontera del caso de uso. */
const requireHeroReference = (raw: string): string => {
  const normalized = raw.trim()

  if (normalized.length === 0) {
    throw new DomainError('La progresion necesita un heroe.')
  }

  return normalized
}
