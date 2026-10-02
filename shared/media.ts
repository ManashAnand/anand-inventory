import path from 'path'

export function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export function resolveProductMedia(dataRoot: string, pathname: string): string {
  const relativePath = pathname.replace(/^\/+/, '')
  if (!relativePath || relativePath.includes('\0')) {
    throw new Error('Invalid image path')
  }
  const productsRoot = path.resolve(dataRoot, 'products')
  const full = path.resolve(productsRoot, relativePath)
  if (!isInside(productsRoot, full)) {
    throw new Error('Invalid image path')
  }
  return full
}
