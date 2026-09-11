// Chamadas à API da tela, com o cabeçalho que o servidor exige.

// Métodos que o servidor considera mutantes: exige Content-Type:
// application/json em TODOS eles, mesmo sem corpo (DELETE e POST /run não têm
// corpo e ainda assim precisam do cabeçalho, ou o servidor devolve 415).
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Chama a API da tela e devolve o corpo JSON.
 * @param {string} path Caminho depois de /api, ex.: "/schedules".
 * @param {RequestInit} [init]
 * @returns {Promise<any>}
 */
export async function api(path, init) {
  const method = (init?.method ?? 'GET').toUpperCase();
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: MUTATING_METHODS.has(method) ? { 'Content-Type': 'application/json' } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Erro ${res.status} em ${path}`);
  return body;
}
