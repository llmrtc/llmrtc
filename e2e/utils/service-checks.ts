/**
 * Service health checks for local providers.
 * Used to skip tests when required services are not available.
 */

export interface ServiceStatus {
  available: boolean;
  models?: string[];
  error?: string;
}

/**
 * Check if Ollama is running and list available models.
 */
export async function checkOllama(
  baseUrl = 'http://localhost:11434'
): Promise<ServiceStatus> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) {
      return { available: false, error: `HTTP ${response.status}` };
    }
    const data = await response.json() as { models?: Array<{ name: string }> };
    const models = data.models?.map((m) => m.name) ?? [];
    return { available: true, models };
  } catch (error) {
    return { available: false, error: String(error) };
  }
}

/**
 * Check if LMStudio is running and list available models.
 */
export async function checkLMStudio(
  baseUrl = 'http://localhost:1234'
): Promise<ServiceStatus> {
  try {
    const response = await fetch(`${baseUrl}/v1/models`);
    if (!response.ok) {
      return { available: false, error: `HTTP ${response.status}` };
    }
    const data = await response.json() as { data?: Array<{ id: string }> };
    const models = data.data?.map((m) => m.id) ?? [];
    return { available: true, models };
  } catch (error) {
    return { available: false, error: String(error) };
  }
}

/**
 * Check if Faster Whisper server is running.
 */
export async function checkFasterWhisper(
  baseUrl = 'http://localhost:8000'
): Promise<ServiceStatus> {
  try {
    // Try health endpoint first, then root
    let response = await fetch(`${baseUrl}/health`);
    if (!response.ok) {
      response = await fetch(baseUrl);
    }
    return { available: response.ok };
  } catch (error) {
    return { available: false, error: String(error) };
  }
}

/**
 * Check if Piper TTS server is running.
 */
export async function checkPiper(
  baseUrl = 'http://localhost:5000'
): Promise<ServiceStatus> {
  try {
    // Try health endpoint first, then root
    let response = await fetch(`${baseUrl}/health`);
    if (!response.ok) {
      response = await fetch(baseUrl);
    }
    return { available: response.ok };
  } catch (error) {
    return { available: false, error: String(error) };
  }
}

/**
 * Check all local services and return summary.
 */
export async function checkAllLocalServices(): Promise<{
  ollama: ServiceStatus;
  lmstudio: ServiceStatus;
  fasterWhisper: ServiceStatus;
  piper: ServiceStatus;
}> {
  const [ollama, lmstudio, fasterWhisper, piper] = await Promise.all([
    checkOllama(process.env.OLLAMA_BASE_URL),
    checkLMStudio(process.env.LMSTUDIO_BASE_URL),
    checkFasterWhisper(process.env.FASTER_WHISPER_URL),
    checkPiper(process.env.PIPER_URL),
  ]);

  return { ollama, lmstudio, fasterWhisper, piper };
}
