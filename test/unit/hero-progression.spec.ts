import { DomainError } from '../../src/domain/errors/DomainError'
import { HeroProgression } from '../../src/domain/entities/HeroProgression'
import {
  MAX_HERO_LEVEL,
  MIN_HERO_LEVEL,
  HeroLevel,
} from '../../src/domain/value-objects/hero-level'
import { Experience } from '../../src/domain/value-objects/experience'

/**
 * Agregado de progresion de un heroe (HU-08, Task #189).
 *
 * Comprueba tres cosas: la forma del estado, que el umbral se DERIVA, y las
 * cuatro reglas que aprobo el Product Owner sobre la experiencia -- se suma y
 * nunca se resta, un solo otorgamiento puede cruzar varios umbrales, en el
 * nivel maximo la experiencia sigue creciendo, y el nivel guardado tiene que
 * corresponder al acumulado.
 *
 * LA XP QUE SE OTORGA NO SE DECIDE AQUI. `awardExperience` recibe un importe ya
 * calculado; quien lo calcula (10 x 1,2^(1d8), con la tirada de Combat) es
 * HU-09 / HU-10 y no se prueba en esta suite.
 */
describe('HeroProgression', () => {
  describe('estado inicial', () => {
    it('un heroe sin progresion empieza en nivel 1 con 0 de experiencia', () => {
      const progression = HeroProgression.createEmpty('jugador-1', 'heroe-1')

      expect(progression.level.value).toBe(1)
      expect(progression.experience.currentXp).toBe(0)
      expect(progression.version).toBe(0)
      expect(progression.isAtMaxLevel()).toBe(false)
    })

    it('el estado inicial es coherente con la tabla: 0 acumulados son nivel 1', () => {
      const progression = HeroProgression.createEmpty('jugador-1', 'heroe-1')

      expect(progression.levelForTotalXp().value).toBe(progression.level.value)
    })

    it('normaliza los identificadores sin cambiar su valor', () => {
      const progression = HeroProgression.createEmpty('  jugador-1  ', '  heroe-1  ')

      expect(progression.ownerId).toBe('jugador-1')
      expect(progression.heroId).toBe('heroe-1')
    })

    it('rechaza un jugador o un heroe vacios', () => {
      expect(() => HeroProgression.createEmpty('', 'heroe-1')).toThrow(DomainError)
      expect(() => HeroProgression.createEmpty('jugador-1', '   ')).toThrow(DomainError)
    })
  })

  describe('umbral derivado', () => {
    it('en nivel 1 el umbral es el del nivel 2: 200 acumulados', () => {
      const progression = HeroProgression.createEmpty('jugador-1', 'heroe-1')

      expect(progression.thresholdForNextLevel()).toEqual({
        status: 'AVAILABLE',
        forNextLevel: 2,
        amount: 100,
      })
    })

    it('en nivel maximo el umbral es MAX_LEVEL', () => {
      const progression = HeroProgression.restore({
        ownerId: 'jugador-1',
        heroId: 'heroe-1',
        level: 8,
        currentXp: 1500,
        version: 3,
      })

      expect(progression.isAtMaxLevel()).toBe(true)
      expect(progression.thresholdForNextLevel()).toEqual({
        status: 'MAX_LEVEL',
        currentLevel: 8,
        forNextLevel: null,
        amount: null,
      })
    })

    it('el umbral NO se almacena: la instantanea no lo lleva', () => {
      const progression = HeroProgression.createEmpty('jugador-1', 'heroe-1')
      const snapshot = progression.toSnapshot()

      expect(Object.keys(snapshot).sort()).toEqual(
        ['currentXp', 'heroId', 'level', 'ownerId', 'version'].sort(),
      )
      expect(snapshot).not.toHaveProperty('threshold')
      expect(snapshot).not.toHaveProperty('nextLevel')
    })
  })

  /**
   * Las cuatro reglas del Product Owner sobre la experiencia. Cada una tiene su
   * caso con los numeros que el PO uso al aclararlas.
   */
  describe('acreditar experiencia', () => {
    const at = (level: number, currentXp: number): HeroProgression =>
      HeroProgression.restore({
        ownerId: 'jugador-1',
        heroId: 'heroe-1',
        level,
        currentXp,
        version: 7,
      })

    it('suma sin restar: 99 + 1 deja 100 acumulados y sube al nivel 2', () => {
      const after = at(1, 99).awardExperience(1)

      expect(after.experience.currentXp).toBe(100)
      expect(after.level.value).toBe(2)
    })

    it('cada umbral sube exactamente un nivel y conserva la XP acumulada', () => {
      const steps = [
        [1, 99, 100, 2],
        [2, 299, 300, 3],
        [3, 499, 500, 4],
        [4, 699, 700, 5],
        [5, 899, 900, 6],
        [6, 1099, 1100, 7],
        [7, 1299, 1300, 8],
      ] as const

      for (const [level, xp, expectedXp, expectedLevel] of steps) {
        const after = at(level, xp).awardExperience(1)

        expect(after.experience.currentXp).toBe(expectedXp)
        expect(after.level.value).toBe(expectedLevel)
      }
    })

    it('un solo otorgamiento cruza varios umbrales: 90 + 430 deja 520 en el nivel 4', () => {
      // No se avanza un nivel por recompensa: se aplica la tabla al acumulado
      // nuevo. Con 90 acumulados el heroe esta en el nivel 1.
      const before = at(1, 90)
      const after = before.awardExperience(430)

      expect(after.experience.currentXp).toBe(520)
      expect(after.level.value).toBe(4)
    })

    it('en el nivel maximo la experiencia sigue creciendo y el nivel se queda en 8', () => {
      // No se descarta la experiencia ganada ni se rechaza la operacion.
      const after = at(8, 1300).awardExperience(5000)

      expect(after.experience.currentXp).toBe(6300)
      expect(after.level.value).toBe(MAX_HERO_LEVEL)
      expect(after.isAtMaxLevel()).toBe(true)
    })

    it('no muta la instancia original: devuelve una progresion nueva', () => {
      const before = at(1, 99)
      const after = before.awardExperience(1)

      expect(before.experience.currentXp).toBe(99)
      expect(before.level.value).toBe(1)
      expect(after).not.toBe(before)
    })

    it('no incrementa la version: el bloqueo optimista lo gobierna el repositorio', () => {
      const after = at(1, 99).awardExperience(1)

      expect(after.version).toBe(7)
    })

    it('acreditar 0 no cambia ni el acumulado ni el nivel', () => {
      const before = at(6, 900)
      const after = before.awardExperience(0)

      expect(after.experience.currentXp).toBe(900)
      expect(after.level.value).toBe(6)
    })

    it('rechaza una recompensa negativa, fraccionaria o de otro tipo', () => {
      const progression = at(1, 0)
      const invalidas = [-1, 14.4, Number.NaN, Number.POSITIVE_INFINITY, '14', null, undefined]

      for (const invalid of invalidas) {
        expect(() => progression.awardExperience(invalid)).toThrow(DomainError)
      }
    })

    it('la experiencia acreditada es entera: la recompensa se redondea antes', () => {
      // `14,4` es el valor exacto del 1d8 = 2 y NO llega hasta aqui: quien lo
      // calcula lo redondea a 14. La frontera se prueba para que no se cuele.
      expect(() => at(1, 0).awardExperience(14.4)).toThrow(DomainError)
      expect(at(1, 0).awardExperience(14).experience.currentXp).toBe(14)
    })
  })

  describe('el nivel se deriva del acumulado', () => {
    it('levelForTotalXp coincide con el nivel guardado', () => {
      for (const [level, currentXp] of [
        [1, 0],
        [1, 99],
        [2, 100],
        [2, 299],
        [3, 300],
        [4, 520],
        [7, 1299],
        [8, 1300],
        [8, 6300],
      ] as const) {
        const progression = HeroProgression.restore({
          ownerId: 'jugador-1',
          heroId: 'heroe-1',
          level,
          currentXp,
          version: 0,
        })

        expect(progression.levelForTotalXp().value).toBe(level)
      }
    })
  })

  /**
   * El tope de nivel es una regla, y `HeroLevel.next()` es la operacion que la
   * impone: por eso se prueba directamente en vez de dejarla sin cubrir. Es el
   * punto donde "no calcular un nivel 9" (CA-05) deja de ser una convencion.
   */
  describe('el tope de nivel vive en el objeto de valor', () => {
    it('next() avanza un nivel mientras haya siguiente', () => {
      for (let level = MIN_HERO_LEVEL; level < MAX_HERO_LEVEL; level += 1) {
        const next = HeroLevel.create(level).next()

        expect(next?.value).toBe(level + 1)
      }
    })

    it('next() devuelve null en el nivel maximo: no existe un nivel 9', () => {
      expect(HeroLevel.create(MAX_HERO_LEVEL).next()).toBeNull()
    })

    it('isMax() solo es cierto en el nivel maximo', () => {
      expect(HeroLevel.create(MAX_HERO_LEVEL).isMax()).toBe(true)
      expect(HeroLevel.create(MAX_HERO_LEVEL - 1).isMax()).toBe(false)
      expect(HeroLevel.create(MIN_HERO_LEVEL).isMax()).toBe(false)
    })
  })

  describe('igualdad de los objetos de valor', () => {
    it('dos niveles con el mismo valor son iguales', () => {
      expect(HeroLevel.create(4).equals(HeroLevel.create(4))).toBe(true)
      expect(HeroLevel.create(4).equals(HeroLevel.create(5))).toBe(false)
    })

    it('dos experiencias con la misma cantidad son iguales', () => {
      expect(Experience.create(250).equals(Experience.create(250))).toBe(true)
      expect(Experience.create(250).equals(Experience.create(0))).toBe(false)
      expect(Experience.zero().equals(Experience.create(0))).toBe(true)
    })

    it('`add` devuelve una experiencia nueva sin tocar la original', () => {
      const original = Experience.create(250)
      const sumada = original.add(100)

      expect(sumada.currentXp).toBe(350)
      expect(original.currentXp).toBe(250)
      expect(sumada.equals(original)).toBe(false)
    })
  })

  describe('restore valida el documento, no lo confia', () => {
    // Nivel 3 con 300 acumulados: coherente con la tabla (300 <= 300 < 500).
    const base = { ownerId: 'jugador-1', heroId: 'heroe-1', level: 3, currentXp: 300, version: 1 }

    it('reconstituye una progresion valida', () => {
      const progression = HeroProgression.restore(base)

      expect(progression.level.value).toBe(3)
      expect(progression.experience.currentXp).toBe(300)
      expect(progression.version).toBe(1)
    })

    it('rechaza un nivel fuera del rango', () => {
      expect(() => HeroProgression.restore({ ...base, level: 0 })).toThrow(DomainError)
      expect(() => HeroProgression.restore({ ...base, level: 9 })).toThrow(DomainError)
    })

    it('rechaza una experiencia negativa o fraccionaria', () => {
      expect(() => HeroProgression.restore({ ...base, currentXp: -1 })).toThrow(DomainError)
      expect(() => HeroProgression.restore({ ...base, currentXp: 1.5 })).toThrow(DomainError)
    })

    it('rechaza una version negativa o no entera', () => {
      expect(() => HeroProgression.restore({ ...base, version: -1 })).toThrow(DomainError)
      expect(() => HeroProgression.restore({ ...base, version: 1.5 })).toThrow(DomainError)
    })

    /**
     * La invariante del agregado: el nivel guardado es la tabla aplicada al
     * acumulado guardado. Un documento que los contradiga es un dato corrupto
     * --de una tabla anterior, de una edicion manual-- y no se acepta.
     */
    it('rechaza un nivel que no corresponde a la experiencia acumulada', () => {
      // 100 acumulados son nivel 2: declarar nivel 1 es un dato corrupto.
      expect(() => HeroProgression.restore({ ...base, level: 1, currentXp: 100 })).toThrow(
        DomainError,
      )
      // 499 acumulados son nivel 3, no nivel 4 ni nivel 1.
      expect(() => HeroProgression.restore({ ...base, level: 4, currentXp: 499 })).toThrow(
        DomainError,
      )
      expect(() => HeroProgression.restore({ ...base, level: 1, currentXp: 499 })).toThrow(
        DomainError,
      )
      // Y al reves: 1300 acumulados son nivel 8, no nivel 7.
      expect(() => HeroProgression.restore({ ...base, level: 7, currentXp: 1300 })).toThrow(
        DomainError,
      )
    })

    it('acepta un documento coherente con el umbral: nivel 2 con 100 acumulados', () => {
      const progression = HeroProgression.restore({ ...base, level: 2, currentXp: 100 })

      expect(progression.level.value).toBe(2)
      expect(progression.experience.currentXp).toBe(100)
    })

    it('el error dice que nivel corresponde, para poder diagnosticarlo', () => {
      expect(() => HeroProgression.restore({ ...base, level: 4, currentXp: 499 })).toThrow(
        /nivel 3/,
      )
    })

    it('acepta los dos extremos coherentes del rango', () => {
      expect(HeroProgression.restore({ ...base, level: 1, currentXp: 0 }).level.value).toBe(1)
      expect(HeroProgression.restore({ ...base, level: 8, currentXp: 1300 }).level.value).toBe(8)
    })

    it('ida y vuelta: la instantanea restaurada es la misma', () => {
      expect(HeroProgression.restore(base).toSnapshot()).toEqual(base)
    })

    it('ida y vuelta tras acreditar: el acumulado y el nivel viajan juntos', () => {
      const after = HeroProgression.restore(base).awardExperience(1200)
      const restored = HeroProgression.restore(after.toSnapshot())

      expect(restored.experience.currentXp).toBe(1500)
      expect(restored.level.value).toBe(8)
    })
  })
})
