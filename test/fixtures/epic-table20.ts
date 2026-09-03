import type { EpicDefinition, EpicEffect } from '../../src/domain/policies/EpicEffectPolicy'
import type { HeroSubtype } from '../../src/domain/value-objects/hero-subtype'

/**
 * Datos funcionales opacos de la Tabla 20, no payloads de Catalog.
 *
 * Fuente: "Proyecto integrador II 2 (1).md", Tabla 20 (pagina 31), y la
 * correccion de #206: https://github.com/Nexus-Battle-VI/Nexus-Battle-Management/issues/206#issuecomment-5440869020
 *
 * El contrato actual de Catalog admite un specificEffect, pero no representa
 * todos los efectos compuestos de estas filas. Estas fixtures verifican que
 * HU-31 preserva la definicion funcional completa sin fingir un contrato
 * canonico, ejecutar dados ni decidir aritmetica de vida/critico.
 */
export interface Table20EpicFixture {
  readonly name: string
  readonly definition: EpicDefinition & {
    readonly associatedHeroType: HeroSubtype
    readonly baseEffect: EpicEffect | null
    readonly additionalEffect: EpicEffect
  }
}

export const TABLE_20_EPICS: Readonly<Record<HeroSubtype, Table20EpicFixture>> = {
  GUERRERO_TANQUE: {
    name: 'Golpe de defensa',
    definition: {
      associatedHeroType: 'GUERRERO_TANQUE',
      baseEffect: { attack: 1 },
      additionalEffect: { damage: 4, criticalPercent: 2 },
    },
  },
  GUERRERO_ARMAS: {
    name: 'Segundo impulso',
    definition: {
      associatedHeroType: 'GUERRERO_ARMAS',
      baseEffect: { recoverHealthDice: { count: 1, sides: 4 } },
      additionalEffect: { health: 3, criticalPercent: 5 },
    },
  },
  MAGO_FUEGO: {
    name: 'Luz cegadora',
    definition: {
      associatedHeroType: 'MAGO_FUEGO',
      baseEffect: { health: 1 },
      additionalEffect: { damage: 2, criticalPercent: 1 },
    },
  },
  MAGO_HIELO: {
    name: 'Frío concentrado',
    definition: {
      associatedHeroType: 'MAGO_HIELO',
      baseEffect: { opponentPower: -1 },
      additionalEffect: { receivesDamage: false, appliesOn: 'NEXT_TURN' },
    },
  },
  PICARO_VENENO: {
    name: 'Toma y lleva',
    definition: {
      associatedHeroType: 'PICARO_VENENO',
      baseEffect: { attack: 1 },
      additionalEffect: { opponentDamageFraction: 0.5, returnReducedDamageToOpponent: true },
    },
  },
  PICARO_MACHETE: {
    name: 'Intimidación sangrienta',
    definition: {
      associatedHeroType: 'PICARO_MACHETE',
      baseEffect: { damage: 1 },
      additionalEffect: { health: 2, criticalPercent: 2 },
    },
  },
  CHAMAN: {
    name: 'Té changua',
    definition: {
      associatedHeroType: 'CHAMAN',
      baseEffect: null,
      additionalEffect: { healingTarget: 'ALL', healingDice: { count: 4, sides: 8 } },
    },
  },
  MEDICO: {
    name: 'Reanimador 3000',
    definition: {
      associatedHeroType: 'MEDICO',
      baseEffect: null,
      additionalEffect: {
        linkedTarget: 'COMPANION',
        trigger: 'LINKED_COMPANION_DIES',
        revivedHealthPercent: 20,
      },
    },
  },
}
