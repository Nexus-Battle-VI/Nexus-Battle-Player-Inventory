import { DomainError } from '../../src/domain/errors/DomainError'
import { InMemoryExperienceGrantRepository } from '../../src/adapters/outbound/persistence/InMemoryExperienceGrantRepository'
import {
  ExperienceGrantMappingError,
  fingerprintOf,
  toLedgerDocument,
  toResultDocument,
  toSource,
  type ExperienceGrantDocument,
} from '../../src/adapters/outbound/persistence/experience-grant-mapping'
import {
  ExperienceGrantConflictError,
  ExperienceGrantRejectedError,
} from '../../src/application/errors/ApplicationError'
import type {
  ExperienceGrantCommand,
  ExperienceGrantResult,
} from '../../src/application/ports/ExperienceGrantPort'
import {
  GrantHeroExperience,
  missionCompletionOperationId,
  type GrantHeroExperienceCommand,
} from '../../src/application/use-cases/GrantHeroExperience'

/**
 * HU-10, Task HU-10.2: la XP de FINALIZACION de una mision
 * (`hu-10-mission-completion-reward-v1` §8).
 *
 * `MISSION_COMPLETION` es un origen DISTINTO de `MISSION_RIVAL_DEFEAT` (HU-09) y
 * los dos usan el mismo motor de progresion (HU-08). Aqui se comprueba:
 *   - que cada variante acepta EXACTAMENTE sus campos y ninguno de la otra;
 *   - que la idempotencia y la huella son las de cada variante;
 *   - que la progresion la decide HU-08 (los importes de estas pruebas son valores
 *     de prueba, NO reglas funcionales: Player/Inventory no decide cuanto se da);
 *   - que la forma historica de HU-09 en el ledger no cambia.
 */
const HERO_ID = '7f3c2a9e-2d4b-4c1a-9e7f-1b2c3d4e5f60'
const PLAYER_ID = 'sub-jugador-1'
const ENROLLMENT_ID = 'enr_01JB8Y3K7Q'

const completionSource = (overrides: Record<string, unknown> = {}) => ({
  kind: 'MISSION_COMPLETION',
  enrollmentId: ENROLLMENT_ID,
  missionId: 'msn_templo_olvidado',
  simulationId: 'sim_01JB8Y4B',
  difficulty: 'NORMAL',
  missionOutcome: 'COMPLETED',
  ...overrides,
})

const rivalSource = (overrides: Record<string, unknown> = {}) => ({
  kind: 'MISSION_RIVAL_DEFEAT',
  enrollmentId: ENROLLMENT_ID,
  simulationId: 'sim_01JB8Y4B',
  encounterId: '5',
  enemyInstanceId: 'guardian-eterno#1',
  rivalRef: 'guardian-eterno',
  roll: 5,
  ...overrides,
})

const OPERATION_ID = missionCompletionOperationId(ENROLLMENT_ID)

/** El origen sin un campo: para comprobar que cada campo es obligatorio. */
const without = (source: Record<string, unknown>, field: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(source).filter(([key]) => key !== field))

const completionCommand = (
  overrides: Partial<GrantHeroExperienceCommand> = {},
): GrantHeroExperienceCommand => ({
  schemaVersion: 1,
  operationId: OPERATION_ID,
  playerId: PLAYER_ID,
  heroId: HERO_ID,
  amount: 25,
  source: completionSource(),
  ...overrides,
})

const rivalCommand = (
  overrides: Partial<GrantHeroExperienceCommand> = {},
): GrantHeroExperienceCommand => ({
  schemaVersion: 1,
  operationId: 'mission:enr_01JB8Y3K7Q:encounter:5:enemy:guardian-eterno#1:hero:h1:xp',
  playerId: PLAYER_ID,
  heroId: HERO_ID,
  amount: 25,
  source: rivalSource(),
  ...overrides,
})

describe('HU-10.2 — XP de finalizacion (MISSION_COMPLETION)', () => {
  let useCase: GrantHeroExperience

  beforeEach(() => {
    useCase = new GrantHeroExperience(new InMemoryExperienceGrantRepository())
  })

  it('el operationId de la finalizacion es EXACTAMENTE el del contrato', () => {
    expect(OPERATION_ID).toBe('mission:enr_01JB8Y3K7Q:reward:completion:xp')
  })

  describe('validez de cada variante', () => {
    it('1. un MISSION_COMPLETION valido se acredita', async () => {
      await expect(useCase.execute(completionCommand())).resolves.toMatchObject({
        applied: true,
        heroId: HERO_ID,
        currentXp: 25,
        level: 1,
        maxLevel: 8,
      })
    })

    it.each(['COMPLETED', 'FAILED'])(
      'el desenlace %s es una finalizacion valida',
      async (outcome) => {
        await expect(
          useCase.execute(
            completionCommand({ source: completionSource({ missionOutcome: outcome }) }),
          ),
        ).resolves.toMatchObject({ applied: true })
      },
    )

    it.each(['NORMAL', 'HEROIC', 'LEGENDARY', 'MYTHIC'])(
      'la dificultad %s es del vocabulario cerrado',
      async (difficulty) => {
        await expect(
          useCase.execute(completionCommand({ source: completionSource({ difficulty }) })),
        ).resolves.toMatchObject({ applied: true })
      },
    )

    it('2. MISSION_RIVAL_DEFEAT sigue siendo valido, sin cambios', async () => {
      await expect(useCase.execute(rivalCommand())).resolves.toMatchObject({
        applied: true,
        currentXp: 25,
      })
    })

    it.each(['roll', 'rivalRef', 'enemyInstanceId', 'encounterId'])(
      '3. una finalizacion con el campo de derrota `%s` se rechaza',
      async (field) => {
        const source = completionSource({ [field]: field === 'roll' ? 7 : 'x#1' })

        await expect(useCase.execute(completionCommand({ source }))).rejects.toThrow(DomainError)
        await expect(useCase.execute(completionCommand({ source }))).rejects.toThrow(field)
      },
    )

    it.each(['roll', 'rivalRef', 'enemyInstanceId', 'encounterId'])(
      '4. una derrota sin `%s` se rechaza',
      async (field) => {
        const source = without(rivalSource(), field)

        await expect(useCase.execute(rivalCommand({ source }))).rejects.toThrow(DomainError)
      },
    )

    it.each(['missionId', 'difficulty', 'missionOutcome'])(
      'una derrota con el campo de finalizacion `%s` se rechaza',
      async (field) => {
        const source = rivalSource({ [field]: 'NORMAL' })

        await expect(useCase.execute(rivalCommand({ source }))).rejects.toThrow(DomainError)
      },
    )

    it.each(['missionId', 'difficulty', 'missionOutcome', 'simulationId', 'enrollmentId'])(
      'una finalizacion sin `%s` se rechaza',
      async (field) => {
        const source = without(completionSource(), field)

        await expect(useCase.execute(completionCommand({ source }))).rejects.toThrow(DomainError)
      },
    )

    it.each([
      ['un desenlace VOIDED', { missionOutcome: 'VOIDED' }],
      ['un desenlace ABANDONED', { missionOutcome: 'ABANDONED' }],
      ['un desenlace IN_PROGRESS', { missionOutcome: 'IN_PROGRESS' }],
      ['una dificultad desconocida', { difficulty: 'EASY' }],
      ['una dificultad en minusculas', { difficulty: 'normal' }],
      ['un identificador en blanco', { missionId: '   ' }],
    ])('rechaza %s', async (_label, overrides) => {
      await expect(
        useCase.execute(completionCommand({ source: completionSource(overrides) })),
      ).rejects.toThrow(DomainError)
    })

    it.each([undefined, null, 'MISSION_COMPLETION', [], { kind: 'OTRO' }, { kind: undefined }])(
      'un origen que no es una variante conocida se rechaza: %j',
      async (source) => {
        await expect(useCase.execute(completionCommand({ source }))).rejects.toThrow(DomainError)
      },
    )

    it('un operationId que no es el de la matricula del origen se rechaza', async () => {
      await expect(
        useCase.execute(
          completionCommand({ operationId: 'mission:otra-matricula:reward:completion:xp' }),
        ),
      ).rejects.toThrow(/operationId/)
    })

    it('12. un importe fraccionario o negativo es 422, no 400', async () => {
      for (const amount of [25.5, -1, '25', null]) {
        await expect(useCase.execute(completionCommand({ amount }))).rejects.toThrow(
          ExperienceGrantRejectedError,
        )
      }
    })

    it('un importe de 0 se acepta (Player/Inventory no decide cuanto corresponde)', async () => {
      await expect(useCase.execute(completionCommand({ amount: 0 }))).resolves.toMatchObject({
        applied: true,
        currentXp: 0,
      })
    })
  })

  describe('idempotencia', () => {
    it('5. el mismo operationId con el mismo cuerpo no vuelve a acreditar', async () => {
      const first = await useCase.execute(completionCommand({ amount: 40 }))
      const replay = await useCase.execute(completionCommand({ amount: 40 }))
      const other = await useCase.execute(
        rivalCommand({ operationId: 'mission:otra:xp', amount: 1 }),
      )

      expect(first).toMatchObject({ applied: true, currentXp: 40 })
      expect(replay).toMatchObject({ applied: false, currentXp: 40, level: first.level })
      // Y la experiencia total no se movio con el replay: solo suma la otra acreditacion.
      expect(other.currentXp).toBe(41)
    })

    it.each([
      ['6. otro importe', completionCommand({ amount: 41 })],
      [
        '7. otra dificultad',
        completionCommand({ amount: 40, source: completionSource({ difficulty: 'HEROIC' }) }),
      ],
      [
        '7. otro desenlace',
        completionCommand({ amount: 40, source: completionSource({ missionOutcome: 'FAILED' }) }),
      ],
      [
        '7. otra mision',
        completionCommand({ amount: 40, source: completionSource({ missionId: 'msn_otra' }) }),
      ],
      [
        '7. otra simulacion',
        completionCommand({ amount: 40, source: completionSource({ simulationId: 'sim-otra' }) }),
      ],
    ])('el mismo operationId con %s es conflicto y no sobrescribe', async (_label, changed) => {
      await useCase.execute(completionCommand({ amount: 40 }))

      await expect(useCase.execute(changed)).rejects.toThrow(ExperienceGrantConflictError)

      // Lo primero sigue ahi.
      await expect(useCase.execute(completionCommand({ amount: 40 }))).resolves.toMatchObject({
        applied: false,
        currentXp: 40,
      })
    })

    it('la finalizacion y una derrota con el MISMO operationId son conflicto (otro contenido)', async () => {
      await useCase.execute(completionCommand({ amount: 40 }))

      await expect(
        useCase.execute(rivalCommand({ operationId: OPERATION_ID, amount: 40 })),
      ).rejects.toThrow(ExperienceGrantConflictError)
    })
  })

  describe('progresion (HU-08), con valores de PRUEBA', () => {
    it('8. la XP es acumulativa y se suma a la de HU-09 sin restar', async () => {
      await useCase.execute(rivalCommand({ amount: 60 }))
      const result = await useCase.execute(completionCommand({ amount: 30 }))

      expect(result).toMatchObject({ currentXp: 90, level: 1, applied: true })
    })

    it('9. cruza un nivel: 290 acumulados + 25 = 315, nivel 3', async () => {
      await useCase.execute(rivalCommand({ operationId: 'op-previo', amount: 290 }))

      const result = await useCase.execute(completionCommand({ amount: 25 }))

      expect(result).toMatchObject({
        currentXp: 315,
        level: 3,
        leveledUp: true,
        levelsGained: 1,
      })
      expect(result.nextLevel).toEqual({ status: 'AVAILABLE', forNextLevel: 4, amount: 500 })
    })

    it('10. cruza varios niveles con una sola finalizacion: 90 + 430 = 520, nivel 4', async () => {
      await useCase.execute(rivalCommand({ operationId: 'op-previo', amount: 90 }))

      const result = await useCase.execute(completionCommand({ amount: 430 }))

      expect(result).toMatchObject({ currentXp: 520, level: 4, levelsGained: 3 })
    })

    it('11. en el nivel 8 sigue acumulando XP y no inventa un nivel 9', async () => {
      await useCase.execute(rivalCommand({ operationId: 'op-max', amount: 1300 }))

      const result = await useCase.execute(completionCommand({ amount: 7 }))

      expect(result).toMatchObject({ currentXp: 1307, level: 8, leveledUp: false, levelsGained: 0 })
      expect(result.nextLevel).toMatchObject({ status: 'MAX_LEVEL', forNextLevel: null })
    })

    it('el desenlace FAILED acredita igual que COMPLETED: el motor no distingue', async () => {
      const failed = await useCase.execute(
        completionCommand({ amount: 12, source: completionSource({ missionOutcome: 'FAILED' }) }),
      )

      expect(failed).toMatchObject({ applied: true, currentXp: 12 })
    })
  })
})

describe('HU-10.2 — traduccion del ledger', () => {
  const resultOf = (overrides: Partial<ExperienceGrantResult> = {}): ExperienceGrantResult => ({
    operationId: OPERATION_ID,
    applied: true,
    heroId: HERO_ID,
    level: 2,
    currentXp: 120,
    leveledUp: true,
    levelsGained: 1,
    ...overrides,
  })

  const commandOf = (source: ExperienceGrantCommand['source']): ExperienceGrantCommand => ({
    operationId: OPERATION_ID,
    ownerId: PLAYER_ID,
    heroId: HERO_ID,
    amount: 120,
    source,
  })

  const completion: ExperienceGrantCommand['source'] = {
    kind: 'MISSION_COMPLETION',
    enrollmentId: ENROLLMENT_ID,
    missionId: 'msn_templo_olvidado',
    simulationId: 'sim_01JB8Y4B',
    difficulty: 'NORMAL',
    missionOutcome: 'COMPLETED',
  }

  const rival: ExperienceGrantCommand['source'] = {
    kind: 'MISSION_RIVAL_DEFEAT',
    enrollmentId: ENROLLMENT_ID,
    simulationId: 'sim_01JB8Y4B',
    encounterId: '5',
    enemyInstanceId: 'guardian-eterno#1',
    rivalRef: 'guardian-eterno',
    roll: 5,
  }

  const AT = new Date('2026-10-02T03:00:04.120Z')

  it('13. HU-10 se guarda con su `source` discriminado y SIN campos de derrota', () => {
    const document = toLedgerDocument(commandOf(completion), 'huella', resultOf(), AT)

    expect(document).toEqual({
      _id: OPERATION_ID,
      fingerprint: 'huella',
      ownerId: PLAYER_ID,
      heroId: HERO_ID,
      amount: 120,
      source: {
        kind: 'MISSION_COMPLETION',
        enrollmentId: ENROLLMENT_ID,
        missionId: 'msn_templo_olvidado',
        simulationId: 'sim_01JB8Y4B',
        difficulty: 'NORMAL',
        missionOutcome: 'COMPLETED',
      },
      result: toResultDocument(resultOf()),
      createdAt: AT,
    })
    for (const forbidden of ['roll', 'rivalRef', 'enemyInstanceId', 'encounterId']) {
      expect(document).not.toHaveProperty(forbidden)
      expect((document as unknown as { source: object }).source).not.toHaveProperty(forbidden)
    }
  })

  it('14. HU-09 se guarda EXACTAMENTE como siempre: aplanado, sin `source` ni `kind`', () => {
    const document = toLedgerDocument(commandOf(rival), 'huella', resultOf(), AT)

    expect(document).toEqual({
      _id: OPERATION_ID,
      fingerprint: 'huella',
      ownerId: PLAYER_ID,
      heroId: HERO_ID,
      amount: 120,
      roll: 5,
      enrollmentId: ENROLLMENT_ID,
      simulationId: 'sim_01JB8Y4B',
      encounterId: '5',
      enemyInstanceId: 'guardian-eterno#1',
      rivalRef: 'guardian-eterno',
      result: toResultDocument(resultOf()),
      createdAt: AT,
    })
    expect(document).not.toHaveProperty('source')
    expect(document).not.toHaveProperty('kind')
  })

  it('un asiento HISTORICO de HU-09 (sin `source`) se lee como MISSION_RIVAL_DEFEAT', () => {
    const historical: ExperienceGrantDocument = {
      _id: 'mission:enr_1:encounter:5:enemy:guardian-eterno#1:hero:h1:xp',
      fingerprint: 'huella-historica',
      ownerId: PLAYER_ID,
      heroId: HERO_ID,
      amount: 25,
      roll: 5,
      enrollmentId: 'enr_1',
      simulationId: 'sim_1',
      encounterId: '5',
      enemyInstanceId: 'guardian-eterno#1',
      rivalRef: 'guardian-eterno',
      result: toResultDocument(resultOf()),
      createdAt: AT,
    }

    expect(toSource(historical)).toEqual({
      kind: 'MISSION_RIVAL_DEFEAT',
      enrollmentId: 'enr_1',
      simulationId: 'sim_1',
      encounterId: '5',
      enemyInstanceId: 'guardian-eterno#1',
      rivalRef: 'guardian-eterno',
      roll: 5,
    })
  })

  it('ida y vuelta: lo que se escribe es lo que se lee, en las dos variantes', () => {
    expect(toSource(toLedgerDocument(commandOf(completion), 'h', resultOf(), AT))).toEqual(
      completion,
    )
    expect(toSource(toLedgerDocument(commandOf(rival), 'h', resultOf(), AT))).toEqual(rival)
  })

  it.each([
    ['un desenlace fuera del vocabulario', { missionOutcome: 'VOIDED' }],
    ['una dificultad fuera del vocabulario', { difficulty: 'EASY' }],
    ['un kind que no es de finalizacion', { kind: 'MISSION_RIVAL_DEFEAT' }],
    ['un missionId vacio', { missionId: '' }],
  ])('un asiento de HU-10 con %s no se lee: no se inventa un origen', (_label, overrides) => {
    const document = toLedgerDocument(commandOf(completion), 'h', resultOf(), AT)
    const broken = {
      ...document,
      source: { ...(document as unknown as { source: object }).source, ...overrides },
    } as unknown as ExperienceGrantDocument

    expect(() => toSource(broken)).toThrow(ExperienceGrantMappingError)
  })

  describe('huella', () => {
    const fingerprintOfSource = (source: ExperienceGrantCommand['source']) =>
      fingerprintOf(commandOf(source))

    it('la huella de HU-09 es BYTE A BYTE la historica: un replay legitimo no se vuelve 409', () => {
      // Valor fijado a mano: si alguien reordena o renombra un campo, los asientos
      // ya guardados dejarian de coincidir con sus reintentos.
      expect(fingerprintOfSource(rival)).toBe(
        '{"ownerId":"sub-jugador-1","heroId":"7f3c2a9e-2d4b-4c1a-9e7f-1b2c3d4e5f60","amount":120,' +
          '"source":{"kind":"MISSION_RIVAL_DEFEAT","enrollmentId":"enr_01JB8Y3K7Q",' +
          '"simulationId":"sim_01JB8Y4B","encounterId":"5","enemyInstanceId":"guardian-eterno#1",' +
          '"rivalRef":"guardian-eterno","roll":5}}',
      )
    })

    it('la huella de HU-10 lleva sus datos semanticos y ninguno de derrota', () => {
      expect(fingerprintOfSource(completion)).toBe(
        '{"ownerId":"sub-jugador-1","heroId":"7f3c2a9e-2d4b-4c1a-9e7f-1b2c3d4e5f60","amount":120,' +
          '"source":{"kind":"MISSION_COMPLETION","enrollmentId":"enr_01JB8Y3K7Q",' +
          '"missionId":"msn_templo_olvidado","simulationId":"sim_01JB8Y4B","difficulty":"NORMAL",' +
          '"missionOutcome":"COMPLETED"}}',
      )
    })

    it.each([
      ['la mision', { missionId: 'msn_otra' }],
      ['la dificultad', { difficulty: 'HEROIC' }],
      ['el desenlace', { missionOutcome: 'FAILED' }],
      ['la simulacion', { simulationId: 'sim-otra' }],
      ['la matricula', { enrollmentId: 'enr-otra' }],
    ])('cambiar %s cambia la huella de HU-10', (_label, overrides) => {
      expect(
        fingerprintOfSource({ ...completion, ...overrides } as ExperienceGrantCommand['source']),
      ).not.toBe(fingerprintOfSource(completion))
    })

    it('dos variantes nunca comparten huella', () => {
      expect(fingerprintOfSource(completion)).not.toBe(fingerprintOfSource(rival))
    })

    it('no depende del orden de las claves del origen', () => {
      const reordered = {
        missionOutcome: 'COMPLETED',
        difficulty: 'NORMAL',
        simulationId: 'sim_01JB8Y4B',
        missionId: 'msn_templo_olvidado',
        enrollmentId: ENROLLMENT_ID,
        kind: 'MISSION_COMPLETION',
      } as ExperienceGrantCommand['source']

      expect(fingerprintOfSource(reordered)).toBe(fingerprintOfSource(completion))
    })
  })
})
