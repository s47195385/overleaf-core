/**
 * Jupyter Notebook to LaTeX Converter
 * Converts .ipynb files to .tex format for Overleaf projects
 * 
 * Based on the Python wrap_tex.py converter
 */

import fs from 'fs-extra'
import path from 'path'
import { execSync } from 'child_process'

// Global ROOT directory (set during conversion)
let ROOT = ''

// ============================================================================
// LaTeX Header Template (Josh's article template)
// ============================================================================
const LATEX_HEADER = String.raw`\documentclass[letterpaper,12pt,notitlepage]{article}

% --- language and page layout ---
\usepackage[english]{babel}
\usepackage[bottom=-0.5in,top=1.0in]{geometry}
\setlength{\textwidth}{6in}
\setlength{\textheight}{8.58in}
\setlength{\oddsidemargin}{.3in}

% --- core maths / layout packages ---
\usepackage{amsmath,amssymb,mathtools}
\usepackage{amsthm}
\usepackage{rotating}
\usepackage{delarray,dcolumn}
\usepackage{graphics,epsfig}
\usepackage{soul}
\usepackage{longtable,lscape,multirow,array}
\usepackage{caption}
\usepackage{anyfontsize}
\usepackage{float}
\usepackage[usenames,dvipsnames]{color}
\usepackage{booktabs}
\usepackage{siunitx}
\sisetup{
  input-symbols = {()},
  group-digits  = false
}

% --- spacing ---
\usepackage{verbatim}
\usepackage{setspace}
\doublespacing

\usepackage{footmisc}
\renewcommand\footnotelayout{\fontsize{10}{12}\selectfont}

\usepackage{arydshln}
\setcounter{secnumdepth}{3}
\setcounter{tocdepth}{3}
\usepackage[titletoc,toc,page]{appendix}
\usepackage{authblk}

% --- theorem environments ---
\theoremstyle{definition}
\newtheorem{exmp}{Example}[subsection]
\newtheorem{proposition}{Proposition}

% --- penalties and float parameters ---
\setlength{\parskip}{3mm}
\widowpenalty=20000
\displaywidowpenalty=20000
\clubpenalty=100000
\def\floatpagefraction{0.98}
\renewcommand{\textfraction}{0.01}
\renewcommand{\topfraction}{0.99}
\renewcommand{\bottomfraction}{0.99}

% --- algorithms ---
\usepackage{algorithm}
\usepackage[noend]{algpseudocode}

%%%%%%%%%%%%%%%% Converter helpers
\graphicspath{{images/}}

\usepackage{adjustbox}
\usepackage{booktabs,longtable}
\usepackage{caption}
\captionsetup{font=small}
\newcommand{\compactnotes}[2][Notes.]{%
  \par\vspace{0.25em}%
  \begingroup\footnotesize\emph{#1}~#2\par\endgroup%
}

\usepackage{listings}
\lstset{
  basicstyle=\ttfamily\small,
  columns=fullflexible,
  keepspaces=true,
  breaklines=true,
  upquote=true,
}
\newcommand{\codecell}[1]{\lstinline[columns=fullflexible]!#1!}

\providecommand{\tightlist}{\setlength{\itemsep}{0pt}\setlength{\parskip}{0pt}}

% --- Bibliography ---
\usepackage{etoolbox}
\makeatletter
\renewcommand\@biblabel[1]{}
\@ifpackageloaded{biblatex}{%
  \AtBeginBibliography{\clearpage}
  \setlength\bibhang{1.5em}
  \defbibenvironment{bibliography}
    {\list{}{\setlength{\leftmargin}{\bibhang}%
             \setlength{\itemindent}{-\leftmargin}%
             \setlength{\itemsep}{0.25\baselineskip}}}
    {\endlist}
    {\item}
}{%
  \pretocmd{\thebibliography}{\clearpage}{}{}
  \patchcmd{\@bibitem}{\ignorespaces}{\hangindent=1.5em\hangafter=1\ignorespaces}{}{}
  \patchcmd{\@lbibitem}{\ignorespaces}{\hangindent=1.5em\hangafter=1\ignorespaces}{}{}
}
\makeatother

\usepackage[round,authoryear]{natbib}
\usepackage[colorlinks=true,allcolors=blue]{hyperref}

`

// ============================================================================
// Basic Helpers
// ============================================================================

/**
 * Read text from a file (relative to ROOT or absolute)
 */
function readText(filePath) {
  const p = path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath)
  if (!fs.existsSync(p)) return ''
  return fs.readFileSync(p, 'utf8')
}

/**
 * Sanitize punctuation for LaTeX
 */
function texSanitisePunct(s) {
  if (!s) return ''
  return s.replace(/…/g, '\\ldots')
}

/**
 * Escape special LaTeX characters
 */
export function texEscape(s) {
  if (s === null || s === undefined) return ''
  
  // Normalize unicode
  s = s
    .replace(/\u00A0/g, ' ')
    .replace(/\u202F/g, ' ')
    .replace(/–/g, '--')
    .replace(/—/g, '---')
    .replace(/'/g, "'")
    .replace(/'/g, "'")
    .replace(/"/g, '"')
    .replace(/"/g, '"')
    .replace(/−/g, '-')
    .replace(/∼/g, '~')
  
  // Math symbols
  s = s
    .replace(/×/g, '$\\times$')
    .replace(/≤/g, '$\\le$')
    .replace(/≥/g, '$\\ge$')
    .replace(/≈/g, '$\\approx$')
    .replace(/°/g, '$^\\circ$')
  
  // Protect existing \&
  s = s.replace(/\\&/g, '<<AMP>>')
  
  // Escape special chars
  const repl = {
    '&': '\\&',
    '%': '\\%',
    '$': '\\$',
    '#': '\\#',
    '_': '\\_',
    '{': '\\{',
    '}': '\\}',
    '~': '\\textasciitilde{}',
    '^': '\\textasciicircum{}',
  }
  
  for (const [k, v] of Object.entries(repl)) {
    s = s.split(k).join(v)
  }
  
  return s.replace(/<<AMP>>/g, '\\&')
}

/**
 * Unescape markdown attribute escapes
 */
function unescapeMdAttr(s) {
  if (!s) return s
  return s.replace(/\\([\\`*_{}\[\]()#+-\.!~|])/g, '$1')
}

// ============================================================================
// Email and Person Parsing
// ============================================================================

const EMAIL_RX = /<([^>]+@[^>]+)>|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g

/**
 * Parse a person notation into name, email, affiliation
 */
function parsePerson(payload) {
  payload = (payload || '').trim()
  let email = ''
  
  // Extract email
  const emailMatch = payload.match(EMAIL_RX)
  if (emailMatch) {
    email = emailMatch[0].replace(/[<>]/g, '').trim()
    payload = payload.replace(EMAIL_RX, '').replace(/<>/g, '').trim()
  }
  
  let name = ''
  let affil = ''
  
  if (payload.includes('|')) {
    const parts = payload.split('|').map(p => p.trim()).filter(Boolean)
    name = parts[0] || ''
    affil = parts[1] || ''
  } else {
    const mp = payload.match(/^(.*?)\s*\((.*?)\)\s*$/)
    if (mp) {
      name = mp[1].trim()
      affil = mp[2].trim()
    } else {
      const parts = payload.split(/,\s*/).map(p => p.trim())
      name = parts[0] || ''
      affil = parts[1] || ''
    }
  }
  
  return { name, email, affil }
}

// ============================================================================
// Metadata Parsing
// ============================================================================

/**
 * Parse metadata from the first markdown cell
 */
export function parseMetaFromFirstMd(nbjson) {
  const cells = nbjson.cells || []
  const mdIndices = cells
    .map((c, i) => c.cell_type === 'markdown' ? i : -1)
    .filter(i => i >= 0)
  
  const firstMdIdx = mdIndices.length > 0 ? mdIndices[0] : null
  
  const meta = {
    title: '',
    subtitle: '',
    authors: [],
    supervisors: [],
    date: '\\the\\year',
    currentdegrees: '',
    orcid: '',
    submittedfor: '',
    school: '',
    keywords: '',
    disclaimer: '',
    abstract: '',
    declaration: '',
    acknowledgements: '',
  }
  
  if (firstMdIdx === null) {
    return { meta, firstMdIdx: null }
  }
  
  const src = Array.isArray(cells[firstMdIdx].source) 
    ? cells[firstMdIdx].source.join('') 
    : cells[firstMdIdx].source || ''
  
  const lines = src.split('\n').map(ln => ln.replace(/\r$/, ''))
  
  let keyCollect = null
  const buffers = {
    disclaimer: [],
    abstract: [],
    declaration: [],
    acknowledgements: [],
  }
  
  function flushKey() {
    if (keyCollect && buffers[keyCollect]) {
      meta[keyCollect] = buffers[keyCollect].join('\n').trim()
      buffers[keyCollect] = []
    }
    keyCollect = null
  }
  
  for (const raw of lines) {
    const s = raw.trim()
    
    if (keyCollect) {
      // Check if new key starts
      if (/^(title|subtitle|authors?|supervisors?|date|currentdegrees|orcid|submittedfor|school|keywords?|disclaimers?|abstract|declaration|acknowledgements?)\s*:/i.test(s)) {
        flushKey()
      } else {
        if (buffers[keyCollect]) {
          buffers[keyCollect].push(raw)
        }
        continue
      }
    }
    
    const m = s.match(/^\s*(\w+)\s*:\s*(.*)$/)
    if (m) {
      const k = m[1].toLowerCase()
      const v = m[2].trim()
      
      if (['title', 'subtitle', 'date', 'currentdegrees', 'orcid', 'submittedfor', 'school', 'keywords'].includes(k)) {
        if (k === 'title' && !meta.title) meta.title = v
        else if (k === 'subtitle' && !meta.subtitle) meta.subtitle = v
        else if (k === 'date') meta.date = v || '\\the\\year'
        else if (k === 'currentdegrees') meta.currentdegrees = v
        else if (k === 'orcid') meta.orcid = v
        else if (k === 'submittedfor') meta.submittedfor = v
        else if (k === 'school') meta.school = v
        else if (k === 'keywords') meta.keywords = v
        continue
      }
      
      if (k === 'author' || k === 'authors') {
        if (v) meta.authors.push(parsePerson(v))
        continue
      }
      
      if (k === 'supervisor' || k === 'supervisors') {
        if (v) meta.supervisors.push(parsePerson(v))
        continue
      }
      
      if (buffers[k] !== undefined) {
        if (v) buffers[k].push(v)
        keyCollect = k
        continue
      }
    }
    
    // Markdown title headers
    const titleMatch = s.match(/^\s*#\s+(.*)$/)
    if (titleMatch && !meta.title) {
      meta.title = titleMatch[1].trim()
      continue
    }
    
    const subtitleMatch = s.match(/^\s*##\s+(.*)$/)
    if (subtitleMatch && !meta.subtitle) {
      meta.subtitle = subtitleMatch[1].trim()
      continue
    }
  }
  
  if (keyCollect) flushKey()
  
  if (meta.authors.length === 0) {
    meta.authors = [{ name: '', email: '', affil: '' }]
  }
  
  return { meta, firstMdIdx }
}

// ============================================================================
// Table and Figure Helpers
// ============================================================================

/**
 * Make a caption from title and caption
 */
function mkCaption(title, caption) {
  title = (title || '').trim()
  caption = (caption || '').trim()
  if (title && caption) return `${texEscape(title)}. ${texEscape(caption)}`
  if (title) return texEscape(title)
  return texEscape(caption)
}

/**
 * Parse rows from a markdown-style pipe table
 */
function rowsFromRawTable(text) {
  const lines = (text || '').split('\n').filter(ln => ln.trim())
  const rows = []
  
  for (const ln of lines) {
    // Skip separator lines
    if (/^[-:\s|]+$/.test(ln.replace(/\|/g, ''))) continue
    const parts = ln.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
    rows.push(parts)
  }
  
  return rows
}

/**
 * Convert rows to LaTeX tabular body (with tex escaping)
 */
function latexTableFromRows(rows, colspecOverride = '') {
  if (!rows || rows.length === 0) return { body: '', ncols: 0, colspec: '' }
  
  const ncols = Math.max(...rows.map(r => r.length))
  if (ncols === 0) return { body: '', ncols: 0, colspec: '' }
  
  const colspec = colspecOverride && colspecOverride.length === ncols 
    ? colspecOverride 
    : 'l'.repeat(ncols)
  
  const bodyLines = []
  if (rows.length > 0) {
    const head = rows[0].map(c => texEscape(c)).join(' & ') + ' \\\\'
    bodyLines.push('\\toprule')
    bodyLines.push(head)
    bodyLines.push('\\midrule')
    
    for (let i = 1; i < rows.length; i++) {
      const r = [...rows[i], ...Array(ncols).fill('')].slice(0, ncols)
      bodyLines.push(r.map(c => texEscape(c)).join(' & ') + ' \\\\')
    }
    bodyLines.push('\\bottomrule')
  }
  
  return { body: bodyLines.join('\n'), ncols, colspec }
}

/**
 * Convert rows to LaTeX tabular body (raw, no escaping)
 */
function latexRawTableFromRows(rows, colspecOverride = '') {
  if (!rows || rows.length === 0) return { body: '', ncols: 0, colspec: '' }
  
  const ncols = Math.max(...rows.map(r => r.length))
  if (ncols === 0) return { body: '', ncols: 0, colspec: '' }
  
  const colspec = colspecOverride && colspecOverride.length === ncols 
    ? colspecOverride 
    : 'l'.repeat(ncols)
  
  const bodyLines = []
  if (rows.length > 0) {
    const head = rows[0].join(' & ') + ' \\\\'
    bodyLines.push('\\toprule')
    bodyLines.push(head)
    bodyLines.push('\\midrule')
    
    for (let i = 1; i < rows.length; i++) {
      const r = [...rows[i], ...Array(ncols).fill('')].slice(0, ncols)
      bodyLines.push(r.join(' & ') + ' \\\\')
    }
    bodyLines.push('\\bottomrule')
  }
  
  return { body: bodyLines.join('\n'), ncols, colspec }
}

/**
 * Parse attributes from a directive block
 */
function parseAttrs(attrText) {
  const out = {}
  if (!attrText) return out
  
  let s = attrText.trim()
  if (s.startsWith('{') && s.endsWith('}')) {
    s = s.slice(1, -1).trim()
  }
  
  // Extract ID
  const idMatch = s.match(/#([A-Za-z0-9:_\-.]+)/)
  if (idMatch) {
    out.id = idMatch[1]
    s = s.replace(/#[A-Za-z0-9:_\-.]+/, '').trim()
  }
  
  // Parse key=value pairs
  const kvRegex = /(\w+)=("([^"]*)"|'([^']*)'|([^\s}]+))/g
  let match
  while ((match = kvRegex.exec(s)) !== null) {
    const key = match[1]
    const value = match[3] || match[4] || match[5] || ''
    out[key] = unescapeMdAttr(value.replace(/}$/, ''))
  }
  
  return out
}

/**
 * Convert a tbl block to LaTeX
 */
function convertTblBlock(attrs, innerText) {
  const src = attrs.src || attrs.path || ''
  let rows
  
  if (src) {
    const raw = readText(src)
    rows = rowsFromRawTable(raw)
  } else {
    rows = rowsFromRawTable(innerText)
  }
  
  const mathMode = ['1', 'true', 'yes', 'y'].includes((attrs.math || '').toLowerCase())
  
  let tabBody, ncols, colspec
  if (mathMode) {
    ({ body: tabBody, ncols, colspec } = latexRawTableFromRows(rows, attrs.cols || ''))
  } else {
    ({ body: tabBody, ncols, colspec } = latexTableFromRows(rows, attrs.cols || ''))
  }
  
  if (ncols === 0 || !tabBody) {
    const missing = src ? texEscape(src) : '(inline table)'
    return `\\begin{table}[H]
\\centering
{\\footnotesize \\emph{Table source not found or empty: }${missing}}
\\end{table}
`
  }
  
  const scale = attrs.scale
  const widthPart = scale ? `width=${parseFloat(scale).toFixed(3)}\\linewidth,` : ''
  const caption = mkCaption(attrs.title || '', attrs.caption || '')
  const label = attrs.id || 'tab:auto'
  const notes = (attrs.notes || '').trim()
  const useRawNotes = mathMode
  
  return [
    '\\begin{table}[H]',
    '\\centering',
    `\\caption{${caption}}\\label{${label}}`,
    `\\begin{adjustbox}{${widthPart}max width=\\linewidth}`,
    `\\begin{tabular}{${colspec}}`,
    tabBody,
    '\\end{tabular}',
    '\\end{adjustbox}',
    notes ? `\\compactnotes{${useRawNotes ? notes : texEscape(notes)}}` : '',
    '\\end{table}',
    '',
  ].filter(Boolean).join('\n')
}

/**
 * Convert a fig block to LaTeX
 */
function convertFigBlock(attrs) {
  const src = attrs.src || attrs.path || ''
  if (!src) return ''
  
  let placement = (attrs.placement || '').trim()
  if (placement.startsWith('[')) placement = placement.slice(1)
  if (placement.endsWith(']')) placement = placement.slice(0, -1)
  placement = placement.replace(/[{}\[\]]/g, '') || 'htbp'
  
  let width
  try {
    width = attrs.scale ? `width=${parseFloat(attrs.scale).toFixed(3)}\\linewidth` : 'width=\\linewidth'
  } catch {
    width = 'width=\\linewidth'
  }
  
  const caption = mkCaption(attrs.title || '', attrs.caption || '')
  const label = attrs.id || 'fig:auto'
  const notes = (attrs.notes || '').trim()
  
  return `\\begin{figure}[${placement}]
\\centering
\\includegraphics[${width}]{${texEscape(src)}}
\\caption{${caption}}\\label{${label}}
${notes ? `\\compactnotes{${texEscape(notes)}}` : ''}
\\end{figure}
`
}

/**
 * Protect string for lstinline
 */
function protectForLstinline(s) {
  if (s === null || s === undefined) return ''
  return s.replace(/\u00A0/g, ' ').replace(/\u202F/g, ' ')
}

/**
 * Convert a codetbl block to LaTeX
 */
function convertCodetblBlock(attrs, innerText) {
  const rows = rowsFromRawTable(innerText || '')
  
  if (rows.length === 0) {
    return `\\begin{table}[H]
\\centering
{\\footnotesize \\emph{Code table empty.}}
\\end{table}
`
  }
  
  const caption = mkCaption(attrs.title || '', attrs.caption || '')
  const label = attrs.id || 'tab:code'
  const scale = attrs.scale
  const widthPart = scale ? `width=${parseFloat(scale).toFixed(3)}\\linewidth,` : ''
  const notes = (attrs.notes || '').trim()
  const addLinenos = ['1', 'true', 'yes', 'y'].includes((attrs.ln || '').toLowerCase())
  
  const header = rows[0]
  const bodyRows = rows.slice(1)
  
  // Identify code columns
  const codeIdxs = new Set()
  header.forEach((h, i) => {
    if (['code', 'pseudo', 'pseudocode', 'expression'].includes(h.toLowerCase().trim())) {
      codeIdxs.add(i)
    }
  })
  if (codeIdxs.size === 0 && header.length >= 2) {
    codeIdxs.add(1)
  }
  
  let colspec = (attrs.cols || '').trim()
  if (!colspec) {
    let ncols = header.length
    if (addLinenos) ncols++
    colspec = ncols === 3 ? 'lp{0.55\\linewidth}p{0.35\\linewidth}' : 'l'.repeat(ncols)
  } else if (addLinenos) {
    colspec = 'r' + colspec
  }
  
  const out = ['\\toprule']
  out.push(header.map(c => texEscape(c)).join(' & ') + ' \\\\')
  out.push('\\midrule')
  
  let ln = 1
  for (const r of bodyRows) {
    const r2 = [...r, ...Array(header.length).fill('')].slice(0, header.length)
    const cells = []
    if (addLinenos) {
      cells.push(String(ln++))
    }
    r2.forEach((c, j) => {
      c = c.trimEnd()
      if (codeIdxs.has(j)) {
        cells.push(`\\codecell{${protectForLstinline(c)}}`)
      } else {
        cells.push(texEscape(c))
      }
    })
    out.push(cells.join(' & ') + ' \\\\')
  }
  out.push('\\bottomrule')
  
  const tabBody = out.join('\n')
  
  const wrapped = [
    '\\begin{table}[t]',
    '\\centering',
    `\\caption{${caption}}\\label{${label}}`,
    `\\begin{adjustbox}{${widthPart}max width=\\linewidth}`,
    `\\begin{tabular}{${colspec}}`,
    tabBody,
    '\\end{tabular}',
    '\\end{adjustbox}',
  ]
  if (notes) wrapped.push(`\\compactnotes{${texEscape(notes)}}`)
  wrapped.push('\\end{table}')
  
  return wrapped.join('\n') + '\n'
}

/**
 * Convert a mathtbl block to LaTeX
 */
function convertMathtblBlock(attrs, innerText) {
  const rows = rowsFromRawTable(innerText || '')
  
  if (rows.length === 0) {
    return `\\begin{table}[H]
\\centering
{\\footnotesize \\emph{Table source not found or empty.}}
\\end{table}
`
  }
  
  const caption = mkCaption(attrs.title || '', attrs.caption || '')
  const label = attrs.id || 'tab:auto'
  const colsAttr = (attrs.cols || '').trim()
  const { body: tabBody, ncols, colspec } = latexRawTableFromRows(rows, colsAttr)
  const scale = attrs.scale
  const widthPart = scale ? `width=${parseFloat(scale).toFixed(3)}\\linewidth,` : ''
  const notes = (attrs.notes || '').trim()
  const place = (attrs.place || 'H').trim()
  
  return [
    `\\begin{table}[${place}]`,
    '\\centering',
    `\\caption{${caption}}\\label{${label}}`,
    `\\begin{adjustbox}{${widthPart}max width=\\linewidth}`,
    `\\begin{tabular}{${colspec}}`,
    tabBody,
    '\\end{tabular}',
    '\\end{adjustbox}',
    notes ? `\\compactnotes{${notes}}` : '',
    '\\end{table}',
    '',
  ].filter(Boolean).join('\n')
}

// ============================================================================
// Markdown Directive Rewriting
// ============================================================================

/**
 * Rewrite markdown with directives (tables, figures, refs)
 */
export function rewriteMdWithDirectives(mdSrc) {
  let out = mdSrc
  
  // Normalize quotes
  out = out
    .replace(/"/g, '"')
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/'/g, "'")
  
  // Cross-references
  out = out.replace(/\[@\s*(tab:[A-Za-z0-9:_\-.]+)\s*\]/g, '\\ref{$1}')
  out = out.replace(/\[@\s*(fig:[A-Za-z0-9:_\-.]+)\s*\]/g, '\\ref{$1}')
  
  // tbl blocks with content
  out = out.replace(/```tbl\s*(\{[^}]*\})?\s*\n(.*?)\n```/gs, (_, attrText, inner) => {
    const attrs = parseAttrs(attrText || '')
    return '\n' + convertTblBlock(attrs, inner) + '\n'
  })
  
  // tbl blocks one-line
  out = out.replace(/```tbl\s*(\{[^}]*\})\s*```/g, (_, attrText) => {
    const attrs = parseAttrs(attrText || '')
    return '\n' + convertTblBlock(attrs, '') + '\n'
  })
  
  // tbl bare
  out = out.replace(/^[ \t]*tbl\s*(\{.*\})[ \t]*$/gm, (_, attrText) => {
    const attrs = parseAttrs(attrText || '')
    return '\n' + convertTblBlock(attrs, '') + '\n'
  })
  
  // fig blocks
  out = out.replace(/```fig\s*(\{[^}]*\})\s*```/g, (_, attrText) => {
    const attrs = parseAttrs(attrText || '')
    return '\n' + convertFigBlock(attrs) + '\n'
  })
  
  // fig bare
  out = out.replace(/^[ \t]*fig\s*(\{.*\})[ \t]*$/gm, (_, attrText) => {
    const attrs = parseAttrs(attrText || '')
    return '\n' + convertFigBlock(attrs) + '\n'
  })
  
  // codetbl blocks with content
  out = out.replace(/```codetbl\s*(\{[^}]*\})?\s*\n(.*?)\n```/gs, (_, attrText, inner) => {
    const attrs = parseAttrs(attrText || '')
    return '\n' + convertCodetblBlock(attrs, inner) + '\n'
  })
  
  // codetbl bare
  out = out.replace(/^[ \t]*codetbl\s*(\{.*\})[ \t]*$/gm, (_, attrText) => {
    const attrs = parseAttrs(attrText || '')
    return '\n' + convertCodetblBlock(attrs, '') + '\n'
  })
  
  // mathtbl blocks with content
  out = out.replace(/```mathtbl\s*(\{[^}]*\})?\s*\n(.*?)\n```/gs, (_, attrText, inner) => {
    const attrs = parseAttrs(attrText || '')
    return '\n' + convertMathtblBlock(attrs, inner) + '\n'
  })
  
  // mathtbl bare
  out = out.replace(/^[ \t]*mathtbl\s*(\{.*\})[ \t]*$/gm, (_, attrText) => {
    const attrs = parseAttrs(attrText || '')
    return '\n' + convertMathtblBlock(attrs, '') + '\n'
  })
  
  return out
}

// ============================================================================
// Footnotes
// ============================================================================

/**
 * Insert standard markdown footnotes as LaTeX footnotes
 */
export function insertStandardMarkdownFootnotes(s) {
  const definitions = new Map()
  
  // Extract definitions
  const defRx = /^\s*(?:\\?\[\s*\^|\[\s*\^)\s*(.+?)\s*\]\s*:\s*(.*?)(\n|$)/gm
  
  const bodyWithoutDefs = s.replace(defRx, (match, fnId, fnContent) => {
    definitions.set(fnId.trim(), fnContent.trim())
    return ''
  })
  
  // Replace markers
  const markerRx = /(?:\\?\[\s*\^|\[\s*\^)\s*(.+?)\s*\]/g
  
  return bodyWithoutDefs.replace(markerRx, (match, fnId) => {
    const id = fnId.trim()
    if (definitions.has(id)) {
      const content = definitions.get(id)
      return `\\footnote{${texEscape(content)}}`
    }
    return match
  })
}

// ============================================================================
// Display Math
// ============================================================================

/**
 * Ensure numbered display math environments
 */
export function ensureNumberedDisplayMath(s) {
  function wrapEq(inner) {
    return '\\begingroup\\small\\begin{equation}\n' + inner + '\n\\end{equation}\\endgroup'
  }
  
  function wrapEqAligned(inner) {
    return '\\begingroup\\small\\begin{equation}\n\\begin{aligned}\n' + inner + '\n\\end{aligned}\n\\end{equation}\\endgroup'
  }
  
  function wrapEqGathered(inner) {
    return '\\begingroup\\small\\begin{equation}\n\\begin{gathered}\n' + inner + '\n\\end{gathered}\n\\end{equation}\\endgroup'
  }
  
  function hasTag(inner) {
    return /\\tag\b|\\notag\b/.test(inner)
  }
  
  function shouldUseAligned(inner) {
    if (/\\begin\{(?:align\*?|aligned|alignedat|gather\*?|gathered|multline\*?)\}/.test(inner)) {
      return false
    }
    if (/\\begin\{array\}/.test(inner)) {
      return false
    }
    return inner.includes('\\\\') && inner.includes('&')
  }
  
  // $$ ... $$
  s = s.replace(/\$\$\s*(.*?)\s*\$\$/gs, (match, inner) => {
    if (hasTag(inner)) return match
    return shouldUseAligned(inner) ? wrapEqAligned(inner) : wrapEq(inner)
  })
  
  // \[ ... \]
  s = s.replace(/\\\[\s*(.*?)\s*\\\]/gs, (match, inner) => {
    if (hasTag(inner)) return match
    return shouldUseAligned(inner) ? wrapEqAligned(inner) : wrapEq(inner)
  })
  
  // equation* -> equation
  s = s.replace(/\\begin\{equation\*\}/g, '\\begin{equation}')
  s = s.replace(/\\end\{equation\*\}/g, '\\end{equation}')
  
  // align* -> aligned in equation
  s = s.replace(/\\begin\{align\*\}\s*(.*?)\s*\\end\{align\*\}/gs, (match, inner) => {
    if (hasTag(inner)) return match
    return wrapEqAligned(inner)
  })
  
  // gather* -> gathered in equation
  s = s.replace(/\\begin\{gather\*\}\s*(.*?)\s*\\end\{gather\*\}/gs, (match, inner) => {
    if (hasTag(inner)) return match
    return wrapEqGathered(inner)
  })
  
  // multline* -> multline
  s = s.replace(/\\begin\{multline\*\}/g, '\\begin{multline}')
  s = s.replace(/\\end\{multline\*\}/g, '\\end{multline}')
  
  return s
}

// ============================================================================
// Sections and Structure
// ============================================================================

const SECTION_RX = /^\s*\\section\*?\{\s*([^}]+)\s*\}\s*(?:\\label\{[^}]*\}\s*)?/gim

/**
 * Find all sections in document
 */
export function findSections(s) {
  const matches = [...s.matchAll(SECTION_RX)]
  const sections = []
  
  for (let idx = 0; idx < matches.length; idx++) {
    const m = matches[idx]
    const start = m.index
    const title = m[1].trim()
    const end = idx + 1 < matches.length ? matches[idx + 1].index : s.length
    sections.push([title, start, end])
  }
  
  return sections
}

/**
 * Make unnumbered section with TOC entry
 */
function makeUnnumberedWithToc(titleText) {
  return `\\section*{${texEscape(titleText)}}
\\addcontentsline{toc}{section}{${texEscape(titleText)}}
`
}

/**
 * Normalize appendix block
 */
export function normaliseAppendixBlock(block) {
  return block.replace(
    /^\s*\\section\*?\{\s*(Appendix[^}]*)\s*\}\s*(?:\\label\{[^}]*\}\s*)?/im,
    (_, title) => makeUnnumberedWithToc(title)
  )
}

/**
 * Insert content after conclusion section
 */
export function insertAfterConclusion(s, insertText) {
  const blocks = findSections(s)
  
  // Search from end for conclusion
  for (let i = blocks.length - 1; i >= 0; i--) {
    const [title, start, end] = blocks[i]
    if (title.toLowerCase() === 'conclusion') {
      return s.slice(0, end) + insertText + s.slice(end)
    }
  }
  
  return s + insertText
}

/**
 * Detect bib file in the project directory
 */
export function detectBibfile(base, root) {
  const cands = [
    path.join(root, `${path.basename(base)}.bib`),
    path.join(root, 'references.bib'),
  ]
  
  for (const c of cands) {
    if (fs.existsSync(c)) return c
  }
  
  // Search for any .bib file
  if (fs.existsSync(root)) {
    const files = fs.readdirSync(root).filter(f => f.endsWith('.bib')).sort()
    if (files.length > 0) return path.join(root, files[0])
  }
  
  return ''
}

// ============================================================================
// Frontmatter
// ============================================================================

/**
 * Build frontmatter LaTeX
 */
export function buildFrontmatter(meta) {
  const title = texEscape(meta.title || '')
  const subtitle = texEscape(meta.subtitle || '')
  const authors = meta.authors || []
  const supers = meta.supervisors || []
  
  function personBlock(p) {
    const name = texEscape(p.name || '')
    const aff = texEscape(p.affil || '')
    const email = (p.email || '').trim()
    
    let line1 = '{\\normalsize ' + name
    if (email) {
      line1 += ` \\quad {\\small(\\href{mailto:${email}}{${texEscape(email)}})}`
    }
    line1 += ' \\par}'
    
    const line2 = aff ? `{\\small ${aff} \\par}` : ''
    return line1 + (line2 ? '\n' + line2 : '')
  }
  
  const parts = ['\\begin{center}']
  
  if (title) parts.push(`{\\LARGE\\bfseries ${title} \\par}`)
  if (subtitle) parts.push(`\\vspace{0.35em}{\\large ${subtitle} \\par}`)
  parts.push('\\vspace{1.0em}')
  
  authors.forEach((a, idx) => {
    parts.push(personBlock(a))
    if (idx < authors.length - 1) parts.push('\\vspace{0.5em}')
  })
  
  if (supers.length > 0) {
    parts.push('\\vspace{0.8em}{\\small\\itshape Supervisor(s)\\par}')
    parts.push('\\vspace{0.3em}')
    supers.forEach((s, idx) => {
      parts.push(personBlock(s))
      if (idx < supers.length - 1) parts.push('\\vspace{0.4em}')
    })
  }
  
  parts.push('\\end{center}')
  parts.push('\\vspace{0.8em}')
  
  return parts.join('\n') + '\n'
}

// ============================================================================
// Abstract Processing
// ============================================================================

/**
 * Process abstract section
 */
export function processAbstract(body, meta) {
  const absHdr = /\\section\*?\{\s*(?:Abstract|\\texorpdfstring\{\s*\\textbf\{Abstract\}\s*\}\{\s*Abstract\s*\})\s*\}(?:\s*\\label\{[^}]*\})?/
  
  const mAbs = body.match(absHdr)
  if (!mAbs) return body
  
  const start = mAbs.index + mAbs[0].length
  const nextSection = body.slice(start).match(/^\s*\\section/m)
  const end = nextSection ? start + nextSection.index : body.length
  const abstractContent = body.slice(start, end).trim()
  
  let abstractTex = `
% --- Abstract ---
\\begin{center}{\\bfseries Abstract}\\end{center}
${abstractContent}
`
  
  const metaLines = []
  if (meta.date) metaLines.push(`\\noindent\\textbf{Date:} ${texEscape(meta.date)}`)
  if (meta.keywords) metaLines.push(`\\noindent\\textbf{Keywords:} ${texEscape(meta.keywords)}`)
  
  if (metaLines.length > 0) {
    abstractTex += `\\par\\medskip
{\\setlength{\\parskip}{0.25\\baselineskip}
${metaLines.join('\\par\n')}
}

`
  }
  
  return body.slice(0, mAbs.index) + abstractTex + body.slice(end)
}

/**
 * Force Introduction to start on a new page
 */
export function forceIntroNewPage(body) {
  const introPat = /(?:^|\n)\s*(?:\\hypertarget\{[^}]*\}\{\s*)?\\section\*?\{\s*Introduction\s*\}/
  
  const mIntro = body.match(introPat)
  if (!mIntro) return body
  
  const prefix = body.slice(Math.max(0, mIntro.index - 40), mIntro.index)
  if (prefix.includes('\\clearpage') || prefix.includes('\\newpage')) {
    return body
  }
  
  return body.slice(0, mIntro.index) + '\n\\clearpage\n' + body.slice(mIntro.index)
}

// ============================================================================
// Main Conversion Function
// ============================================================================

/**
 * Convert Jupyter notebook to LaTeX
 */
export async function convertNotebookToLatex(nbPath, outputPath = null, rootDir = null) {
  // Load notebook
  const nbContent = await fs.readFile(nbPath, 'utf8')
  const nb = JSON.parse(nbContent)
  
  const base = nbPath.replace(/\.ipynb$/, '')
  const outTex = outputPath || base + '.tex'
  ROOT = rootDir || path.dirname(nbPath)
  
  // Parse metadata from first markdown cell
  const { meta, firstMdIdx } = parseMetaFromFirstMd(nb)
  
  // Create temp notebook without the first md cell (prevents duplication)
  const nbTmp = JSON.parse(JSON.stringify(nb))
  if (firstMdIdx !== null && nbTmp.cells[firstMdIdx]) {
    nbTmp.cells[firstMdIdx].source = []
  }
  
  // Apply directives to markdown cells
  for (const cell of nbTmp.cells || []) {
    if (cell.cell_type === 'markdown') {
      const src = Array.isArray(cell.source) ? cell.source.join('') : cell.source || ''
      const newSrc = rewriteMdWithDirectives(src)
      cell.source = [newSrc]
    }
  }
  
  // Write temp notebook
  const tmpBase = base + '.__abstmp__'
  const tmpNbPath = tmpBase + '.ipynb'
  const tmpTexPath = tmpBase + '.tex'
  
  await fs.writeFile(tmpNbPath, JSON.stringify(nbTmp, null, 2), 'utf8')
  
  // Run nbconvert using array form to avoid command injection
  try {
    execSync('python', {
      stdio: 'pipe',
      cwd: path.dirname(tmpNbPath),
      input: '',
    })
  } catch {
    // Check if python is available, will throw if not
  }
  
  // Use spawnSync with array arguments to avoid command injection
  const { spawnSync } = await import('child_process')
  
  let result = spawnSync('python', [
    '-m', 'nbconvert',
    '--to', 'latex',
    '--output', path.basename(tmpBase),
    tmpNbPath
  ], {
    stdio: 'pipe',
    cwd: path.dirname(tmpNbPath),
  })
  
  if (result.status !== 0) {
    // Try with python3
    result = spawnSync('python3', [
      '-m', 'nbconvert',
      '--to', 'latex',
      '--output', path.basename(tmpBase),
      tmpNbPath
    ], {
      stdio: 'pipe',
      cwd: path.dirname(tmpNbPath),
    })
    
    if (result.status !== 0) {
      const errorMsg = result.stderr ? result.stderr.toString() : 'Unknown error'
      throw new Error(`nbconvert failed: ${errorMsg}`)
    }
  }
  
  // Read generated LaTeX
  const tex = await fs.readFile(tmpTexPath, 'utf8')
  
  // Extract body between \begin{document} and \end{document}
  const mBegin = tex.match(/\\begin\s*\{\s*document\s*\}/)
  const mEnd = tex.match(/\\end\s*\{\s*document\s*\}/)
  
  if (!mBegin || !mEnd) {
    throw new Error(`Could not find LaTeX document body in ${tmpTexPath}`)
  }
  
  const beginIdx = mBegin.index + mBegin[0].length
  const endIdx = tex.lastIndexOf('\\end{document}')
  
  if (endIdx <= beginIdx) {
    throw new Error(`Invalid document structure in ${tmpTexPath}`)
  }
  
  let body = tex.slice(beginIdx, endIdx)
  
  // Remove nbconvert title page
  body = body.replace(
    /^\s*(?:\\title\{.*?\}\s*)?(?:\\author\{.*?\}\s*)?(?:\\date\{.*?\}\s*)?\\maketitle\s*/s,
    ''
  )
  
  // Process abstract
  body = processAbstract(body, meta)
  
  // Force Introduction to start on new page
  body = forceIntroNewPage(body)
  
  // Ensure numbered display math
  body = ensureNumberedDisplayMath(body)
  
  // Insert standard markdown footnotes
  body = insertStandardMarkdownFootnotes(body)
  
  // Rearrange appendices
  const appendixBlocks = []
  const newBodyParts = []
  let cursor = 0
  
  for (const [title, start, end] of findSections(body)) {
    if (title.toLowerCase().startsWith('appendix')) {
      appendixBlocks.push(body.slice(start, end))
    } else {
      newBodyParts.push(body.slice(cursor, start))
      newBodyParts.push(body.slice(start, end))
    }
    cursor = end
  }
  newBodyParts.push(body.slice(cursor))
  body = newBodyParts.join('')
  
  const normalizedAppendices = appendixBlocks.map(normaliseAppendixBlock)
  
  // Build tail: BibTeX references then appendices
  const bibfile = detectBibfile(base, ROOT)
  let tail = ''
  
  if (bibfile) {
    const bibname = path.basename(bibfile, '.bib')
    tail += `
\\clearpage
\\bibliographystyle{apalike}
\\bibliography{${texEscape(bibname)}}
`
  }
  
  if (normalizedAppendices.length > 0) {
    tail += '\n\\clearpage\n' + normalizedAppendices.join('\n\\clearpage\n')
  }
  
  if (tail) {
    body = insertAfterConclusion(body, tail)
  }
  
  // Build frontmatter
  const frontmatter = buildFrontmatter(meta)
  
  // Build PDF metadata
  let pdfMeta = ''
  if (meta.title) {
    pdfMeta += `\\title{${texEscape(meta.title)}}\n`
  }
  if (meta.authors && meta.authors.length > 0) {
    const authorNames = meta.authors.map(a => a.name).filter(Boolean).join(', ')
    pdfMeta += `\\author{${texEscape(authorNames)}}\n`
  }
  pdfMeta += `\\date{${texEscape(meta.date || '\\the\\year')}}\n`
  
  // Compose final LaTeX
  const finalTex = `${LATEX_HEADER}${pdfMeta}\\begin{document}
% --- front matter ---
${frontmatter}${body.trim()}

\\end{document}
`
  
  // Write output
  await fs.writeFile(outTex, finalTex, 'utf8')
  
  // Cleanup temp files
  const tempFiles = [
    tmpNbPath,
    tmpTexPath,
    tmpBase + '.log',
    tmpBase + '.aux',
    tmpBase + '.out',
  ]
  
  for (const p of tempFiles) {
    try {
      if (await fs.pathExists(p)) await fs.remove(p)
    } catch {
      // Ignore cleanup errors
    }
  }
  
  return { outputPath: outTex, meta }
}

/**
 * Check if nbconvert is available
 */
export async function checkNbconvert() {
  const { spawnSync } = await import('child_process')
  
  let result = spawnSync('python', ['-m', 'nbconvert', '--version'], { stdio: 'pipe' })
  if (result.status === 0) return true
  
  result = spawnSync('python3', ['-m', 'nbconvert', '--version'], { stdio: 'pipe' })
  return result.status === 0
}

export default {
  convertNotebookToLatex,
  checkNbconvert,
  parseMetaFromFirstMd,
  texEscape,
  buildFrontmatter,
  rewriteMdWithDirectives,
  LATEX_HEADER,
}
