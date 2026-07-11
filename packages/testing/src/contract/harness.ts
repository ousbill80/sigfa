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
 * Retourne un résultat SKIP si aucun contractPath n'est fourni, sinon null.
 * @param contractPath - Chemin optionnel vers le fichier YAML
 */
function checkSkip(contractPath?: string): SchemathesisResult | null {
  if (!contractPath) {
    return {
      exitCode: 0,
      output: "SKIP: aucun contrat OpenAPI — voir CONTRACT-009",
    };
  }
  return null;
}

/**
 * Vérifie que Docker est disponible sur le chemin donné.
 * Retourne un résultat d'erreur si Docker est introuvable, sinon null.
 * @param docker - Chemin vers l'exécutable Docker
 */
async function checkDocker(docker: string): Promise<SchemathesisResult | null> {
  try {
    await execAsync(`"${docker}" --version`);
    return null;
  } catch {
    return {
      exitCode: 1,
      output: `ERROR: Docker introuvable (chemin: ${docker}). Docker est requis pour exécuter Schemathesis. Installez Docker >= 24 et réessayez.`,
    };
  }
}

/**
 * Vérifie que le fichier de contrat est accessible.
 * Retourne un résultat d'erreur si le fichier est introuvable, sinon null.
 * @param contractPath - Chemin vers le fichier YAML de contrat
 */
async function checkContractFile(contractPath: string): Promise<SchemathesisResult | null> {
  try {
    await access(contractPath);
    return null;
  } catch {
    return {
      exitCode: 1,
      output: `ERROR: Fichier de contrat introuvable: ${contractPath}`,
    };
  }
}

/**
 * Invoque l'image Docker schemathesis/schemathesis sur le contrat donné.
 * @param docker - Chemin vers l'exécutable Docker
 * @param contractPath - Chemin vers le fichier YAML de contrat
 * @returns Résultat de l'invocation
 */
async function invokeDocker(docker: string, contractPath: string): Promise<SchemathesisResult> {
  try {
    const { stdout, stderr } = await execAsync(
      `"${docker}" run --rm -v "${contractPath}:/contract.yaml" schemathesis/schemathesis run /contract.yaml`
    );
    return { exitCode: 0, output: stdout + stderr };
  } catch (err: unknown) {
    const error = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    return {
      exitCode: error.code ?? 1,
      output: (error.stdout ?? "") + (error.stderr ?? "") + (error.message ?? ""),
    };
  }
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
  const skipResult = checkSkip(contractPath);
  if (skipResult) return skipResult;
  const docker = dockerPath ?? "docker";
  const dockerError = await checkDocker(docker);
  if (dockerError) return dockerError;
  const fileError = await checkContractFile(contractPath!);
  if (fileError) return fileError;
  return invokeDocker(docker, contractPath!);
}
