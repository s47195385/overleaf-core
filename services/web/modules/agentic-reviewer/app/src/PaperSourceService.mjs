import fs from 'node:fs/promises'
import path from 'node:path'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import PdfToMarkdownService from './PdfToMarkdownService.mjs'

/**
 * Paper Source Service
 * 
 * Modular service for sourcing research papers.
 * Currently supports:
 * - Local directory scanning (for user-provided papers)
 * 
 * Designed to be extensible for future sources:
 * - arXiv API integration
 * - SSRN integration
 * - RePEc integration
 * - Direct database connections
 * 
 * The local papers directory is configurable and users can dump
 * relevant finance/economics papers there for the reviewer to use
 * as related work references.
 */

// Default papers directory - can be overridden in settings
const DEFAULT_PAPERS_DIR = process.env.AGENTIC_PAPERS_DIR || '/var/lib/overleaf/papers'

/**
 * Source types for papers
 */
const SOURCE_TYPES = {
  LOCAL: 'local',
  ARXIV: 'arxiv',
  SSRN: 'ssrn',
  REPEC: 'repec',
  CUSTOM: 'custom',
}

/**
 * Paper metadata cache (in-memory, can be backed by database)
 */
const paperMetadataCache = new Map()

/**
 * Get the papers directory path
 */
function getPapersDirectory() {
  return Settings.agenticReviewer?.papersDir || DEFAULT_PAPERS_DIR
}

/**
 * List all papers in the local directory
 */
async function listLocalPapers() {
  const papersDir = getPapersDirectory()
  const papers = []

  try {
    // Check if directory exists
    try {
      await fs.access(papersDir)
    } catch {
      logger.info({ papersDir }, 'Papers directory does not exist, creating it')
      await fs.mkdir(papersDir, { recursive: true })
      return papers
    }

    const entries = await fs.readdir(papersDir, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
        const filePath = path.join(papersDir, entry.name)
        const stats = await fs.stat(filePath)

        // Check cache for metadata
        const cached = paperMetadataCache.get(filePath)
        if (cached && cached.mtime === stats.mtimeMs) {
          papers.push(cached.metadata)
          continue
        }

        // Extract basic info from filename
        const metadata = {
          filename: entry.name,
          path: filePath,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          source: SOURCE_TYPES.LOCAL,
          // These will be populated when the paper is actually read
          title: entry.name.replace(/\.pdf$/i, '').replace(/_/g, ' '),
          authors: null,
          abstract: null,
          keywords: null,
          hasFullText: true,
        }

        papers.push(metadata)
        paperMetadataCache.set(filePath, {
          mtime: stats.mtimeMs,
          metadata,
        })
      }
    }

    // Also scan subdirectories one level deep (for organization by topic)
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(papersDir, entry.name)
        const subEntries = await fs.readdir(subDir, { withFileTypes: true })

        for (const subEntry of subEntries) {
          if (subEntry.isFile() && subEntry.name.toLowerCase().endsWith('.pdf')) {
            const filePath = path.join(subDir, subEntry.name)
            const stats = await fs.stat(filePath)

            const cached = paperMetadataCache.get(filePath)
            if (cached && cached.mtime === stats.mtimeMs) {
              papers.push(cached.metadata)
              continue
            }

            const metadata = {
              filename: subEntry.name,
              path: filePath,
              size: stats.size,
              modifiedAt: stats.mtime.toISOString(),
              source: SOURCE_TYPES.LOCAL,
              category: entry.name,
              title: subEntry.name.replace(/\.pdf$/i, '').replace(/_/g, ' '),
              authors: null,
              abstract: null,
              keywords: null,
              hasFullText: true,
            }

            papers.push(metadata)
            paperMetadataCache.set(filePath, {
              mtime: stats.mtimeMs,
              metadata,
            })
          }
        }
      }
    }

    logger.debug({ count: papers.length }, 'Listed local papers')
    return papers
  } catch (err) {
    logger.error({ papersDir, err }, 'Error listing local papers')
    throw err
  }
}

/**
 * Load full paper metadata (extract from PDF if needed)
 */
async function loadPaperMetadata(paperPath) {
  const cached = paperMetadataCache.get(paperPath)
  
  // If we have complete metadata (with abstract), return it
  if (cached?.metadata?.abstract) {
    return cached.metadata
  }

  try {
    // Convert PDF to markdown to extract metadata
    const markdown = await PdfToMarkdownService.convert(paperPath)
    
    // Extract metadata from markdown
    const metadata = await extractMetadataFromMarkdown(markdown, paperPath)
    
    // Update cache
    const stats = await fs.stat(paperPath)
    paperMetadataCache.set(paperPath, {
      mtime: stats.mtimeMs,
      metadata: {
        ...metadata,
        path: paperPath,
        source: SOURCE_TYPES.LOCAL,
        hasFullText: true,
      },
    })

    return paperMetadataCache.get(paperPath).metadata
  } catch (err) {
    logger.error({ paperPath, err }, 'Error loading paper metadata')
    throw err
  }
}

/**
 * Extract metadata from markdown content
 */
async function extractMetadataFromMarkdown(markdown, paperPath) {
  // Simple extraction - can be enhanced with LLM
  const lines = markdown.split('\n')
  
  // Try to find title (usually first major heading)
  let title = null
  for (const line of lines) {
    if (line.startsWith('# ')) {
      title = line.substring(2).trim()
      break
    }
  }

  // Try to find abstract
  let abstract = null
  const abstractMatch = markdown.match(/(?:^|\n)(?:abstract|summary)[\s:]*\n([\s\S]*?)(?:\n\n|\n#)/i)
  if (abstractMatch) {
    abstract = abstractMatch[1].trim()
  }

  // Extract any keywords
  let keywords = null
  const keywordsMatch = markdown.match(/(?:keywords?|key\s*words?)[\s:]*([^\n]+)/i)
  if (keywordsMatch) {
    keywords = keywordsMatch[1]
      .split(/[,;]/)
      .map(k => k.trim())
      .filter(k => k.length > 0)
  }

  // Extract filename as fallback title
  if (!title) {
    title = path.basename(paperPath, '.pdf').replace(/_/g, ' ')
  }

  return {
    title,
    abstract,
    keywords,
    fullText: markdown,
  }
}

/**
 * Search for related work based on queries
 * Searches local papers directory using keyword matching
 */
async function searchRelatedWork({ queries, paperTitle }) {
  const papers = await listLocalPapers()
  const results = []
  const seenPaths = new Set()

  // Normalize paper title for comparison
  const normalizedPaperTitle = paperTitle?.toLowerCase() || ''

  for (const paper of papers) {
    // Skip the paper being reviewed
    if (normalizedPaperTitle && paper.title.toLowerCase().includes(normalizedPaperTitle)) {
      continue
    }

    // Calculate relevance score based on query matches
    let relevanceScore = 0
    const matchedQueries = []

    for (const query of queries) {
      const queryTerms = query.toLowerCase().split(/\s+/)
      const titleLower = paper.title.toLowerCase()
      
      for (const term of queryTerms) {
        if (term.length > 2 && titleLower.includes(term)) {
          relevanceScore += 1
          if (!matchedQueries.includes(query)) {
            matchedQueries.push(query)
          }
        }
      }

      // Check keywords if available
      if (paper.keywords) {
        for (const keyword of paper.keywords) {
          if (queryTerms.some(term => keyword.toLowerCase().includes(term))) {
            relevanceScore += 0.5
          }
        }
      }
    }

    // Only include papers with some relevance
    if (relevanceScore > 0 && !seenPaths.has(paper.path)) {
      seenPaths.add(paper.path)
      results.push({
        ...paper,
        relevanceScore,
        matchedQueries,
      })
    }
  }

  // Sort by relevance score
  results.sort((a, b) => b.relevanceScore - a.relevanceScore)

  // Return top results
  const topResults = results.slice(0, 20)

  // Load full metadata for top results if needed
  const enrichedResults = []
  for (const paper of topResults) {
    try {
      const fullMetadata = await loadPaperMetadata(paper.path)
      enrichedResults.push({
        ...paper,
        ...fullMetadata,
      })
    } catch {
      enrichedResults.push(paper)
    }
  }

  logger.debug({ 
    queryCount: queries.length, 
    resultCount: enrichedResults.length 
  }, 'Searched related work')

  return enrichedResults
}

/**
 * Get paper content (full text)
 */
async function getPaperContent(paperPath) {
  const cached = paperMetadataCache.get(paperPath)
  if (cached?.metadata?.fullText) {
    return cached.metadata.fullText
  }

  const markdown = await PdfToMarkdownService.convert(paperPath)
  return markdown
}

/**
 * Clear metadata cache
 */
function clearCache() {
  paperMetadataCache.clear()
  logger.debug({}, 'Paper metadata cache cleared')
}

/**
 * Add a paper source configuration
 * Placeholder for future extensibility
 */
async function addPaperSource(sourceConfig) {
  // Future: Support adding external paper sources
  // - arXiv API credentials
  // - SSRN API credentials
  // - Database connections
  logger.info({ sourceConfig }, 'Paper source configuration registered')
  return true
}

const PaperSourceService = {
  listLocalPapers,
  loadPaperMetadata,
  searchRelatedWork,
  getPaperContent,
  getPapersDirectory,
  clearCache,
  addPaperSource,
  SOURCE_TYPES,
}

export default PaperSourceService
