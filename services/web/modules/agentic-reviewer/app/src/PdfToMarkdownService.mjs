import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'

/**
 * PDF to Markdown Conversion Service
 * 
 * Converts PDF documents to Markdown format for processing by LLMs.
 * 
 * Supports multiple conversion methods:
 * 1. External API (LandingAI ADE or similar)
 * 2. Local pdftotext fallback
 * 3. Simple text extraction
 * 
 * The conversion is optimized for academic papers with:
 * - Title extraction
 * - Section headers
 * - Figure/table references
 * - Citation handling
 * - Mathematical notation (basic)
 */

// Conversion method priority
const CONVERSION_METHODS = {
  API: 'api',         // External API like LandingAI ADE
  PDFTOTEXT: 'pdftotext',  // Local pdftotext utility
  SIMPLE: 'simple',   // Basic text extraction
}

/**
 * Get the preferred conversion method from settings
 */
function getConversionMethod() {
  return Settings.agenticReviewer?.pdfConversionMethod || CONVERSION_METHODS.PDFTOTEXT
}

/**
 * Convert PDF to Markdown
 */
async function convert(pdfPath) {
  logger.debug({ pdfPath }, 'Converting PDF to Markdown')

  // Verify file exists
  try {
    await fs.access(pdfPath)
  } catch {
    throw new Error(`PDF file not found: ${pdfPath}`)
  }

  const method = getConversionMethod()

  switch (method) {
    case CONVERSION_METHODS.API:
      return await convertWithApi(pdfPath)
    case CONVERSION_METHODS.PDFTOTEXT:
      return await convertWithPdftotext(pdfPath)
    case CONVERSION_METHODS.SIMPLE:
      return await convertSimple(pdfPath)
    default:
      // Try methods in order of preference
      try {
        return await convertWithPdftotext(pdfPath)
      } catch (err) {
        logger.warn({ pdfPath, err }, 'pdftotext failed, falling back to simple extraction')
        return await convertSimple(pdfPath)
      }
  }
}

/**
 * Convert using external API (e.g., LandingAI ADE)
 */
async function convertWithApi(pdfPath) {
  const apiUrl = Settings.agenticReviewer?.pdfApiUrl
  const apiKey = Settings.agenticReviewer?.pdfApiKey

  if (!apiUrl || !apiKey) {
    logger.warn({}, 'PDF API not configured, falling back to pdftotext')
    return await convertWithPdftotext(pdfPath)
  }

  try {
    const pdfBuffer = await fs.readFile(pdfPath)
    const base64Pdf = pdfBuffer.toString('base64')

    // Make API request
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        document: base64Pdf,
        output_format: 'markdown',
        options: {
          preserve_layout: true,
          extract_tables: true,
          extract_figures: true,
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }

    const result = await response.json()
    return result.markdown || result.text || result.content
  } catch (err) {
    logger.error({ pdfPath, err }, 'Error converting PDF with API')
    // Fallback to pdftotext
    return await convertWithPdftotext(pdfPath)
  }
}

/**
 * Convert using pdftotext command-line utility
 */
async function convertWithPdftotext(pdfPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-layout',    // Maintain original layout
      '-enc', 'UTF-8',
      pdfPath,
      '-',  // Output to stdout
    ]

    const proc = spawn('pdftotext', args)
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', data => {
      stdout += data.toString()
    })

    proc.stderr.on('data', data => {
      stderr += data.toString()
    })

    proc.on('close', code => {
      if (code !== 0) {
        logger.warn({ pdfPath, code, stderr }, 'pdftotext failed')
        reject(new Error(`pdftotext exited with code ${code}: ${stderr}`))
        return
      }

      // Convert plain text to markdown
      const markdown = textToMarkdown(stdout)
      resolve(markdown)
    })

    proc.on('error', err => {
      logger.error({ pdfPath, err }, 'pdftotext spawn error')
      reject(err)
    })
  })
}

/**
 * Simple text extraction fallback
 * Uses basic PDF structure parsing
 */
async function convertSimple(pdfPath) {
  // Read PDF file
  const buffer = await fs.readFile(pdfPath)
  const text = buffer.toString('utf-8', 0, Math.min(buffer.length, 1000000))

  // Extract text between stream markers (simplified PDF parsing)
  const textParts = []
  const streamRegex = /stream\s*([\s\S]*?)\s*endstream/g
  let match

  while ((match = streamRegex.exec(text)) !== null) {
    const content = match[1]
    // Try to extract readable text
    const readableText = content.replace(/[^\x20-\x7E\n]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    
    if (readableText.length > 20) {
      textParts.push(readableText)
    }
  }

  if (textParts.length === 0) {
    // If no streams found, try simple text extraction
    const simpleText = text.replace(/[^\x20-\x7E\n]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return textToMarkdown(simpleText)
  }

  return textToMarkdown(textParts.join('\n\n'))
}

/**
 * Convert plain text to Markdown format
 * Attempts to identify structure in academic papers
 */
function textToMarkdown(text) {
  const lines = text.split('\n')
  const markdownLines = []
  
  // State tracking
  let inAbstract = false
  let inReferences = false
  let lastLineWasEmpty = false

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim()

    // Skip empty lines (but preserve paragraph breaks)
    if (line === '') {
      if (!lastLineWasEmpty) {
        markdownLines.push('')
        lastLineWasEmpty = true
      }
      continue
    }
    lastLineWasEmpty = false

    // Detect section headers
    if (isSectionHeader(line)) {
      // Check if it's a numbered section
      const numberedMatch = line.match(/^(\d+\.?\s*)(.+)$/i)
      if (numberedMatch) {
        markdownLines.push(`## ${numberedMatch[2]}`)
      } else {
        markdownLines.push(`## ${line}`)
      }

      // Track special sections
      if (/^abstract$/i.test(line)) {
        inAbstract = true
      } else {
        inAbstract = false
      }
      if (/^references?$/i.test(line)) {
        inReferences = true
      }
      continue
    }

    // Detect title (usually first major text, often in all caps or larger font)
    if (i < 10 && isLikelyTitle(line, lines, i)) {
      markdownLines.push(`# ${line}`)
      continue
    }

    // Handle lists
    if (/^[\u2022\u2023\u25E6\u2043•◦]\s/.test(line)) {
      line = `- ${line.substring(2).trim()}`
    } else if (/^\d+\.\s/.test(line)) {
      // Keep numbered lists as-is
    }

    // Handle citation markers
    line = line.replace(/\[(\d+)\]/g, '[^$1]')
    
    // Handle italics hints (words in isolation, technical terms)
    // line = line.replace(/\b(et al\.)\b/g, '*$1*')

    markdownLines.push(line)
  }

  return markdownLines.join('\n')
}

/**
 * Check if a line looks like a section header
 */
function isSectionHeader(line) {
  // Common section headers in academic papers
  const sectionHeaders = [
    'abstract', 'introduction', 'background', 'related work',
    'methodology', 'method', 'methods', 'approach',
    'model', 'theoretical framework', 'literature review',
    'data', 'data and methodology', 'empirical strategy',
    'results', 'findings', 'discussion', 'analysis',
    'conclusion', 'conclusions', 'summary',
    'references', 'bibliography', 'appendix', 'appendices',
    'acknowledgments', 'acknowledgements',
  ]

  const lineLower = line.toLowerCase()
    .replace(/^\d+\.?\s*/, '')  // Remove leading numbers
    .trim()

  // Check against known headers
  if (sectionHeaders.includes(lineLower)) {
    return true
  }

  // Check if it's a numbered section (e.g., "1. Introduction")
  if (/^\d+\.?\s+[A-Z]/.test(line)) {
    return true
  }

  // Check if it's all caps (often used for headers)
  if (line.length > 3 && line.length < 50 && line === line.toUpperCase()) {
    // But not if it contains too many lowercase letters
    const upperRatio = (line.match(/[A-Z]/g) || []).length / line.length
    if (upperRatio > 0.6) {
      return true
    }
  }

  return false
}

/**
 * Check if a line is likely the paper title
 */
function isLikelyTitle(line, lines, index) {
  // Title is usually in the first few lines
  if (index > 5) return false

  // Title shouldn't be too short or too long
  if (line.length < 10 || line.length > 200) return false

  // Title often doesn't end with a period
  if (line.endsWith('.')) return false

  // Title shouldn't look like an author line
  if (line.includes('@') || line.includes('University') || line.includes('Institute')) {
    return false
  }

  // Title shouldn't be a section header
  if (isSectionHeader(line)) return false

  // Check if it's followed by author-like content
  if (index + 1 < lines.length) {
    const nextLine = lines[index + 1]
    if (nextLine.includes('@') || /^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(nextLine)) {
      return true
    }
  }

  // First substantial line is often the title
  if (index === 0 && line.length > 20) {
    return true
  }

  return false
}

/**
 * Extract specific sections from markdown
 */
function extractSection(markdown, sectionName) {
  const sectionRegex = new RegExp(
    `^##\\s*${sectionName}[\\s\\S]*?(?=^##|$)`,
    'mi'
  )
  const match = markdown.match(sectionRegex)
  return match ? match[0] : null
}

/**
 * Check if pdftotext is available
 */
async function checkPdftotextAvailable() {
  return new Promise(resolve => {
    const proc = spawn('pdftotext', ['-v'])
    proc.on('close', code => resolve(code === 0 || code === 99))  // pdftotext -v returns 99
    proc.on('error', () => resolve(false))
  })
}

const PdfToMarkdownService = {
  convert,
  convertWithApi,
  convertWithPdftotext,
  convertSimple,
  textToMarkdown,
  extractSection,
  checkPdftotextAvailable,
  CONVERSION_METHODS,
}

export default PdfToMarkdownService
