import {
  experienceRequiredForNextLevel,
  levelFromTotalXp,
  type ExperienceThreshold,
} from '../../domain/policies/ExperiencePolicy'

/**
 * Operacion reutilizable de consulta del umbral de experiencia (HU-08, RF-08).
 *
 * ES EL UNICO PUNTO POR EL QUE LOS DEMAS CONSUMIDORES PIDEN EL UMBRAL. Existe
 * para que la Task #189 no tenga que justificar por que no duplica la formula:
 * quien necesite el umbral llama aqui, y aqui se delega integramente en
 * `ExperiencePolicy`.
 *
 * LAS DOS DIRECCIONES DE LA MISMA TABLA. El umbral responde "cuanto hace falta
 * para subir"; `resolveLevel` responde "en que nivel queda el heroe con este
 * acumulado", que es lo que hace falta despues de acreditar una recompensa. Las
 * dos salen de la misma tabla y ninguna de las dos la reimplementa: separarlas en
 * dos clases distintas seria la forma mas facil de que se desincronizaran.
 *
 * Consumidores previstos, ninguno de los cuales aplica la tabla:
 *   - HU-09 (Management #18): experiencia por derrota de un rival.
 *   - HU-10 (Management #19): experiencia y recompensas por mision completada.
 *   - La vista de progreso del heroe, cuando exista.
 *
 * NO ES UN ENDPOINT. No hay controlador que lo publique y no lo habra mientras
 * el PO no lo pida: la Task #188 permite explicitamente no exponer esta
 * operacion por HTTP. Es una operacion de dominio de la que pueden depender
 * otros casos de uso de este mismo servicio.
 *
 * No guarda estado, no lee, no escribe y no autentica: recibe un nivel o un
 * acumulado y devuelve un numero. La autorizacion, cuando haga falta, vive en el
 * caso de uso que lo invoca.
 */
export class QueryExperienceThreshold {
  /** Umbral del siguiente nivel, o `MAX_LEVEL` si el heroe ya esta en el 8. */
  execute(currentLevel: unknown): ExperienceThreshold {
    return experienceRequiredForNextLevel(currentLevel)
  }

  /**
   * Nivel que corresponde a una experiencia acumulada, aplicando la tabla de una
   * vez: un acumulado que cruce varios umbrales da directamente el nivel mas
   * alto alcanzado.
   */
  resolveLevel(totalXp: unknown): number {
    return levelFromTotalXp(totalXp)
  }
}
