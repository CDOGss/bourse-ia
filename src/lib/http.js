const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url, { retries = 3, timeoutMs = 20000 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "*/*" },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "follow",
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} sur ${url}`);
        await sleep(2000 * (i + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

export async function fetchJson(url, opts = {}) {
  const body = await fetchText(url, opts);
  return JSON.parse(body);
}
