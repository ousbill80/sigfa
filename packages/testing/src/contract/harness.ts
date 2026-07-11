import { access } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/** Résultat d'une invocation Schemathesis */
export interface SchemathesisResult {
  /** Code de sortie du processus */
  exitCode: number;
  /** Sortie combinée stdout + stderr */
  output: string;
}

/** Options pour invoquer Schemathesis */
export interface RunSchemathesisOptions {
  /** Chemin vers le fichier YAML de contrat OpenAPI — undefined = mode SKIP */
  contractPath?: string;
  /** Chemin vers l'exécutable Docker (test d'injection) */
  dockerPath?: string;
}

/**
 * Invoque Schemathesis via son image Docker officielle.
 * - Sans contrat YAML → exit 0 + message SKIP référençant CONTRACT-009
 * - Sans Docker → échec propre avec message explicite
 * @param options - Options d'invocation
 * @returns Résultat avec exitCode et output
 */
export async function runSchemathesis(
  options: RunSchemathesisOptions = {}
): Promise<SchemathesisResult> {
  const { contractPath, dockerPath } = options;

  // Cas SKIP : aucun contrat YAML fourni
  if (!contractPath) {
    return {
      exitCode: 0,
      output: "SKIP: aucun contrat OpenAPI — voir CONTRACT-009",
    };
  }

  // Vérifie que Docker est disponible
  const docker = dockerPath ?? "docker";
  try {
    await execAsync(`"${docker}" --version`);
  } catch {
    return {
      exitCode: 1,
      output: `ERROR: Docker introuvable (chemin: ${docker}). Docker est requis pour exécuter Schemathesis. Installez Docker >= 24 et réessayez.`,
    };
  }

  // Vérifie que le fichier YAML existe
  try {
    await access(contractPath);
  } catch {
    return {
      exitCode: 1,
      output: `ERROR: Fichier de contrat introuvable: ${contractPath}`,
    };
  }

  // Invoque l'image Docker schemathesis/schemathesis
  try {
    const { stdout, stderr } = await execAsync(
      `"${docker}" run --rm -v "${contractPath}:/contract.yaml" schemathesis/schemathesis run /contract.yaml`
    );
    return {
      exitCode: 0,
      output: stdout + stderr,
    };
  } catch (err: unknown) {
    const error = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    return {
      exitCode: error.code ?? 1,
      output: (error.stdout ?? "") + (error.stderr ?? "") + (error.message ?? ""),
    };
  }
}
