import "server-only";

// Ключ AISStream - тільки з серверного оточення. Значення не логується
// і не повертається клієнту; відсутній або порожній ключ - null, без винятку.
export function readApiKey(): string | null {
  const value = process.env.AISSTREAM_API_KEY?.trim();
  return value ? value : null;
}
