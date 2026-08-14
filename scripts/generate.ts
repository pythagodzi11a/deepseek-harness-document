/**
 * Project the upstream repository's published documentation into the Hextra
 * site tree.
 *
 * Canonical Markdown stays in the upstream repository (docs/ and the root
 * README files); this script copies the pages selected by the upstream
 * website/docs.ts manifest into content/ (one tree, per-language filename
 * suffixes), rewrites repository-relative links into site routes or GitHub
 * URLs, copies referenced images into static/, and writes section landing
 * pages. The tree is disposable and gitignored.
 *
 * The site is one document: the README is the home page (and sidebar root),
 * and every section lives directly under the root — no module wrappers, no
 * nested sub-sections.
 *
 * The upstream checkout is taken from $UPSTREAM_DIR (default: the sibling
 * directory ../deepseek-harness), so CI can point it at a fresh clone while
 * local development reuses an existing checkout.
 *
 * Run with: pnpm run generate
 */

import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, posix, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Locale key used by the upstream site manifest. */
type DocsLocale = 'root' | 'en'

/** A page projected into the site tree, per the upstream manifest. */
interface DocsPage {
  locale: DocsLocale
  source: string
  label: string
  section: string
  order: number
  route: string
  [key: string]: unknown
}

/** Options accepted by the upstream Markdown projector. */
interface RewriteMarkdownOptions {
  locale: DocsLocale
  sourcePath: string
  route: string
  pages: DocsPage[]
  repoRoot: string
  repositoryRef: string
  placeImage: (absPath: string) => string
}

const projectRoot = resolve(import.meta.dirname, '..')
const contentRoot = resolve(projectRoot, 'content')
const staticRoot = resolve(projectRoot, 'static')
const upstreamDir = resolve(process.env.UPSTREAM_DIR ?? resolve(projectRoot, '..', 'deepseek-harness'))
if (!existsSync(upstreamDir)) {
  throw new Error('site: upstream checkout not found at ' + upstreamDir + ' (set UPSTREAM_DIR)')
}
const repositoryRef = process.env.GITHUB_SHA ?? 'master'

// The upstream manifest and projector are the single source of truth: import
// them from the upstream checkout so the site tracks upstream changes without
// vendoring copies. Their transitive imports (mdast-util-from-markdown and
// friends) resolve from this project's node_modules because the upstream
// checkout always lives inside this project's tree (CI) or next to it (local).
const upstream = await import(pathToFileURL(resolve(upstreamDir, 'website/docs.ts')).href) as {
  docsPages: DocsPage[]
  sectionSpec: (locale: DocsLocale, section: string) => { index: number }
}
const { docsPages, sectionSpec } = upstream
const projector = await import(pathToFileURL(resolve(upstreamDir, 'scripts/project-doc-site.ts')).href) as {
  publishableImage: (path: string, root: string) => string | undefined
  rewriteMarkdown: (markdown: string, options: RewriteMarkdownOptions) => string
}
const { publishableImage, rewriteMarkdown } = projector

/** One page projected into the Hextra content tree. */
interface SitePage {
  /** Manifest entry the page comes from, absent for the README home page. */
  page?: DocsPage
  locale: DocsLocale
  /** Canonical repository source. */
  source: string
  /** Content-relative file path, e.g. 'guide/providers.zh-cn.md'. */
  route: string
  /** Site URL path relative to the base URL, e.g. 'guide/providers/'. */
  url: string
  /** Heading used as the page title; falls back to the manifest label. */
  title: string
  /** Short navigation label for the sidebar, breadcrumbs, and search. */
  linkTitle: string
  weight: number
}

/** Language suffix appended to every generated content file name. */
const LANG_SUFFIX: Record<DocsLocale, string> = { root: '.zh-cn', en: '.en' }

/** Map a canonical source to its flat section directory under the root. */
function targetDir(source: string, locale: DocsLocale): string {
  if (source.startsWith('docs/user/guide/')) return 'guide/'
  if (source.startsWith('docs/user/develop/')) return 'develop/'
  if (source.startsWith('docs/cordis-tutorial/')) return 'tutorial/'
  if (source.startsWith('docs/cordis-api/')) return 'reference/'
  if (source.startsWith('docs/cookbook/')) return 'reference/'
  if (source.startsWith('docs/subsystems/')) return 'subsystems/'
  const exact: Record<string, string> = {
    'docs/cordis-primer.md': 'reference/',
    'docs/architecture.md': 'reference/',
    'docs/capability-seams.md': 'reference/',
    'docs/agent-lifecycle.md': 'reference/',
    'docs/tool-execution-pipeline.md': 'reference/',
    'docs/config-catalog.md': 'reference/',
    'docs/tool-catalog.md': 'reference/',
    'docs/persistence-catalog.md': 'reference/',
  }
  const dir = exact[source.replace(/\.zh\.md$/, '.md')]
  if (dir === undefined) throw new Error('site: no Hextra directory for ' + source)
  return dir
}

/** Content file name for a canonical source; index files become _index.*.md. */
function fileName(source: string, locale: DocsLocale): string {
  const base = basename(source).replace(/\.zh\.md$/, '').replace(/\.md$/, '')
  const name = base === 'index' || base === 'README' ? '_index' : base
  return name + LANG_SUFFIX[locale] + '.md'
}

/** Site URL for a content-relative route. */
function urlOf(route: string): string {
  const lang = route.endsWith(LANG_SUFFIX.en + '.md') ? 'en/' : ''
  const core = route.replace(/\.(?:en|zh-cn)\.md$/, '')
  const url = core.endsWith('_index') ? core.slice(0, -'_index'.length) : core + '/'
  return lang + url
}

/** The switcher line a canonical page carries so its GitHub reader can reach the other language. */
const LANGUAGE_SWITCHER = /^(?:English \| \[中文\]\([^)]*\)|\[English\]\([^)]*\) \| 中文)$/

/** The repository badge a canonical page carries for its GitHub reader. */
const REPOSITORY_BADGE = /^\[!\[[^\]]*\]\(https:\/\/img\.shields\.io\/[^)]*\)\]\([^)]*\)$/

/**
 * Drop the lines that address a canonical page's GitHub reader. The site
 * carries a locale switcher in its navigation bar and links the repository
 * from every page, so projecting these lines would repeat both.
 */
function withoutRepositoryChrome(markdown: string): string {
  const lines = markdown.split('\n')
  const switcher = lines.findIndex(line => LANGUAGE_SWITCHER.test(line))
  if (switcher !== -1 && switcher < 8) {
    lines.splice(switcher, lines[switcher + 1] === '' ? 2 : 1)
  }
  const badge = lines.findLastIndex(line => REPOSITORY_BADGE.test(line))
  if (badge !== -1) {
    lines.splice(lines[badge - 1] === '' ? badge - 1 : badge, lines[badge - 1] === '' ? 2 : 1)
  }
  return lines.join('\n')
}

/** VitePress ':::' admonitions become GitHub-style alerts Hextra renders. */
const ALERT_TYPE: Record<string, string> = {
  note: 'NOTE', tip: 'TIP', info: 'TIP', important: 'IMPORTANT',
  warning: 'WARNING', danger: 'CAUTION', caution: 'CAUTION',
}

function convertAdmonitions(markdown: string): string {
  return markdown.replace(/^:::\s*(\w+)\s*$\n([\s\S]*?)^:::$/gm, (_match, type: string, content: string) => {
    const alert = ALERT_TYPE[type.toLowerCase()] ?? 'NOTE'
    const lines = content.replace(/\n$/, '').split('\n').map(line => '> ' + line)
    return '> [!' + alert + ']\n' + lines.join('\n') + '\n\n'
  })
}

/** Take the first H1 as the page title and drop it from the body. */
function extractTitle(markdown: string, fallback: string): { title: string; body: string } {
  const lines = markdown.split('\n')
  const index = lines.findIndex(line => /^#\s+\S/.test(line))
  if (index === -1) return { title: fallback, body: markdown }
  const heading = lines[index]!.replace(/^#\s+/, '').trim()
  const title = heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\`([^\`]*)\`/g, '$1')
    .trim()
  let end = index + 1
  while (end < lines.length && lines[end]!.trim() === '') end += 1
  const body = [...lines.slice(0, index), ...lines.slice(end)].join('\n')
  return { title: title === '' ? fallback : title, body }
}

/** YAML front matter with double-quoted strings (JSON escaping is YAML-safe). */
function frontmatter(fields: Record<string, string | number>): string {
  const lines = Object.entries(fields).map(([key, value]) => (
    key + ': ' + (typeof value === 'string' ? JSON.stringify(value) : String(value))
  ))
  return '---\n' + lines.join('\n') + '\n---\n\n'
}

/** Copy one referenced image into static/ and return its URL relative to the page. */
function placeImage(absPath: string, fromUrl: string): string {
  const real = publishableImage(absPath, upstreamDir)
  if (real === undefined) {
    throw new Error('site: image ' + relative(upstreamDir, absPath) + ' is not a regular file inside the repository')
  }
  const path = relative(upstreamDir, real).split(sep).join('/')
  const target = resolve(staticRoot, path)
  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(real, target)
  }
  // The page URL is directory-style (ends with '/'); relative targets must
  // resolve from the page itself, i.e. from the URL with its final segment
  // removed — one level deeper than posix.dirname() of the bare URL.
  const base = fromUrl === '' ? '.' : fromUrl.slice(0, -1)
  const link = posix.relative(base, path)
  return link.startsWith('.') ? link : './' + link
}

/** Landing-page markdown listing a section's children. */
function autoIndexContent(dirUrl: string, children: { title: string; url: string }[]): string {
  const items = children.map((child) => {
    const link = posix.relative(dirUrl, child.url)
    return '- [' + child.title + '](' + (link.startsWith('.') ? link : './' + link) + ')'
  })
  return '\n' + items.join('\n') + '\n'
}

/** Every page of one locale, ordered for writing. */
function buildPages(locale: DocsLocale): SitePage[] {
  const entries = docsPages.filter(page => (
    page.locale === locale
    && page.source !== 'docs/user/index.md'
    && page.source !== 'docs/user/index.zh.md'
  ))
  return entries.map((page) => {
    // Index sources of auto-listed sections become regular pages named after
    // their content (quickstart, first-plugin, ...) instead of _index.md.
    const rename = INDEX_AS_PAGE[page.source.replace(/\.zh\.md$/, '.md')]
    const route = rename !== undefined
      ? rename.replace(/\.md$/, LANG_SUFFIX[locale] + '.md')
      : targetDir(page.source, locale) + fileName(page.source, locale)
    return {
      page,
      locale,
      source: page.source,
      route,
      url: urlOf(route),
      title: page.label,
      linkTitle: page.label,
      weight: 0,
    }
  })
}

/** Assign sibling weights inside each directory by manifest section order. */
function assignWeights(pages: SitePage[]): void {
  const byDir = new Map<string, SitePage[]>()
  for (const page of pages) {
    const key = dirname(page.route) + '/' + page.locale
    const list = byDir.get(key) ?? []
    list.push(page)
    byDir.set(key, list)
  }
  for (const list of byDir.values()) {
    const sorted = [...list].sort((left, right) => (
      sectionSpec(left.locale, left.page!.section).index - sectionSpec(right.locale, right.page!.section).index
      || left.page!.order - right.page!.order
    ))
    sorted.forEach((page, index) => { page.weight = index + 1 })
  }
}

/**
 * Index sources that belong to auto-listed sections are published as regular
 * pages under their section, keyed by the canonical English source.
 */
const INDEX_AS_PAGE: Record<string, string> = {
  'docs/user/guide/index.md': 'guide/quickstart.md',
  'docs/user/develop/basic/index.md': 'develop/first-plugin.md',
  'docs/user/develop/framework/index.md': 'develop/framework.md',
  'docs/user/develop/practice/index.md': 'develop/layering.md',
}

/** Structural sidebar weights for the five flat sections. */
const SECTION_WEIGHTS: Record<string, number> = {
  'guide/': 10,
  'develop/': 20,
  'tutorial/': 30,
  'reference/': 40,
  'subsystems/': 50,
}

/** Sections without a canonical index source: title plus a child list. */
interface SectionDef {
  dir: string
  title: Record<DocsLocale, string>
}

const SECTION_DEFS: SectionDef[] = [
  { dir: 'guide/', title: { root: '入门指南', en: 'Guide' } },
  { dir: 'develop/', title: { root: '开发', en: 'Develop' } },
  { dir: 'reference/', title: { root: '参考', en: 'Reference' } },
]

/** Write one page's markdown with its front matter. */
function writePage(page: SitePage, pages: SitePage[], extraFields: Record<string, string> = {}): void {
  const sourceAbs = resolve(upstreamDir, page.source)
  if (!existsSync(sourceAbs) || !lstatSync(sourceAbs).isFile()) {
    throw new Error('site: source ' + page.source + ' does not exist or is not a file')
  }
  let markdown = convertAdmonitions(withoutRepositoryChrome(readFileSync(sourceAbs, 'utf8')))
  const extracted = extractTitle(markdown, page.linkTitle)
  page.title = extracted.title
  markdown = rewriteMarkdown(extracted.body, {
    sourcePath: page.source,
    locale: page.locale,
    // One synthetic segment so the projector's dirname-based relative math
    // resolves links from the page URL itself (see placeImage).
    route: page.url + 'index',
    pages: pages.map(entry => ({ ...entry.page!, route: entry.url })),
    repoRoot: upstreamDir,
    repositoryRef,
    placeImage: (absPath) => placeImage(absPath, page.url),
  })
  // Images inside raw HTML (e.g. the README's QR table) are not markdown
  // image nodes, so the projector never sees them: copy and relink them here.
  markdown = markdown.replace(/src\s*=\s*["']([^"']+)["']/g, (match, src: string) => {
    if (/^(?:https?:|data:|#|\/)/.test(src)) return match
    const abs = resolve(dirname(resolve(upstreamDir, page.source)), src)
    if (!existsSync(abs) || !lstatSync(abs).isFile() || !/\.[a-z0-9]+$/i.test(src)) return match
    const link = placeImage(abs, page.url)
    const index = match.indexOf(src)
    return match.slice(0, index) + link + match.slice(index + src.length)
  })
  // Section indexes carry structural sidebar weights; leaf pages keep the
  // sibling weights computed from the manifest order.
  if (page.route.endsWith('_index' + LANG_SUFFIX[page.locale] + '.md')) {
    const structural = SECTION_WEIGHTS[dirname(page.route) + '/']
    if (structural !== undefined) page.weight = structural
  }
  // type: docs routes every page through the theme's docs layouts, whose
  // sidebar starts from the home tree, so the whole document stays visible.
  const fields: Record<string, string | number> = { title: page.title, weight: page.weight, type: 'docs' }
  // Section indexes name themselves (their H1); only leaf pages take the
  // manifest's short sidebar label as linkTitle.
  if (page.linkTitle !== page.title && !page.route.endsWith('_index' + LANG_SUFFIX[page.locale] + '.md')) {
    fields.linkTitle = page.linkTitle
  }
  for (const [key, value] of Object.entries(extraFields)) fields[key] = value
  const output = resolve(contentRoot, page.route)
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, frontmatter(fields) + markdown)
}

/** Landing pages for sections that have no canonical index source. */
function writeAutoSections(locale: DocsLocale, pages: SitePage[]): void {
  const suffix = LANG_SUFFIX[locale]
  for (const def of SECTION_DEFS) {
    const children = pages
      .filter(page => dirname(page.route) === def.dir.slice(0, -1) && page.route.endsWith(suffix + '.md'))
      .sort((a, b) => a.weight - b.weight)
      .map(page => ({ title: page.linkTitle, url: page.url }))
    const output = resolve(contentRoot, def.dir + '_index' + suffix + '.md')
    mkdirSync(dirname(output), { recursive: true })
    writeFileSync(output, frontmatter({ title: def.title[locale], weight: SECTION_WEIGHTS[def.dir] }) + autoIndexContent(urlOf(def.dir + '_index' + suffix + '.md'), children))
  }
}

/** The README as the home page: the first page of the single document. */
function writeHome(locale: DocsLocale, pages: SitePage[]): void {
  const page: SitePage = {
    locale,
    source: locale === 'root' ? 'README.zh.md' : 'README.md',
    route: '_index' + LANG_SUFFIX[locale] + '.md',
    url: urlOf('_index' + LANG_SUFFIX[locale] + '.md'),
    title: 'DeepSeek Harness',
    linkTitle: 'DeepSeek Harness',
    weight: 0,
  }
  // type: docs makes the sidebar start from the home page, so every page of
  // the site shows the whole document tree instead of only its own section.
  writePage(page, pages, { type: 'docs' })
}

rmSync(contentRoot, { recursive: true, force: true })
rmSync(staticRoot, { recursive: true, force: true })
mkdirSync(contentRoot, { recursive: true })
mkdirSync(staticRoot, { recursive: true })

for (const locale of ['root', 'en'] as DocsLocale[]) {
  const pages = buildPages(locale)
  assignWeights(pages)
  for (const page of pages) writePage(page, pages)
  writeAutoSections(locale, pages)
  writeHome(locale, pages)
}

console.log('deepseek-harness-docs: generated content/ and static/ trees from ' + upstreamDir)