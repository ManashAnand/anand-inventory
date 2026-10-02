export function mediaUrl(folderName: string, relativePath: string, version?: string): string {
  const suffix = relativePath.split('/').map((part) => encodeURIComponent(part)).join('/')
  const base = `inventory://media/${encodeURIComponent(folderName)}/${suffix}`
  if (!version) return base
  return `${base}?v=${encodeURIComponent(version)}`
}
