import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(appRoot, '..')
const archiveRoot = path.join(repoRoot, 'archive')
const outputPath = path.join(appRoot, 'public', 'content', 'articles.json')

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : target
  }))
  return nested.flat()
}

function splitFrontMatter(source) {
  if (!source.startsWith('---\n')) return { attributes: {}, body: source }
  const end = source.indexOf('\n---\n', 4)
  if (end === -1) return { attributes: {}, body: source }
  const attributes = Object.fromEntries(
    source.slice(4, end).split('\n').flatMap((line) => {
      const separator = line.indexOf(':')
      if (separator === -1) return []
      const key = line.slice(0, separator).trim()
      const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
      return [[key, value]]
    })
  )
  return { attributes, body: source.slice(end + 5).trim() }
}

function plainText(markdown) {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function checklistFrom(markdown, id) {
  if (!id.endsWith('23-steps-to-perfect-puppy-manners')) return []
  return markdown.split('\n').flatMap((line, index) => {
    const match = line.match(/^\d+\.\s+(.+)/)
    if (!match) return []
    return [{ id: `${id}:${index}`, text: plainText(match[1]) }]
  })
}

const catalog = JSON.parse(await fs.readFile(path.join(archiveRoot, 'CONTENT_CATALOG.json'), 'utf8'))
const catalogByPath = new Map(catalog.documents.map((document) => [document.path, document]))
const markdownFiles = [
  ...(await walk(path.join(archiveRoot, 'pages'))),
  ...(await walk(path.join(archiveRoot, 'breeds')))
].filter((file) => file.endsWith('.md'))

const articles = await Promise.all(markdownFiles.map(async (file) => {
  const relative = path.relative(archiveRoot, file).split(path.sep).join('/')
  const source = await fs.readFile(file, 'utf8')
  const { attributes, body } = splitFrontMatter(source)
  const heading = body.match(/^#\s+(.+)$/m)?.[1]
  const catalogEntry = catalogByPath.get(relative)
  const id = relative.replace(/\.md$/, '').replace(/\/index$/, '').replaceAll('/', '--')
  return {
    id,
    path: relative,
    title: attributes.title || heading || path.basename(file, '.md'),
    topic: catalogEntry?.topic || (relative.startsWith('breeds/') ? 'Breed reference' : 'Reference'),
    caution: catalogEntry?.caution || '',
    body,
    text: plainText(body),
    checklistItems: checklistFrom(body, id)
  }
}))

articles.sort((a, b) => a.title.localeCompare(b.title))
await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), articles }))
console.log(`Generated ${articles.length} articles at ${path.relative(repoRoot, outputPath)}`)
