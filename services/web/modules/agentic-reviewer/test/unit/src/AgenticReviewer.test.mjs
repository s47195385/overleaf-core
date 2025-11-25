import { describe, expect, it, beforeEach, vi } from 'vitest'

/**
 * Unit tests for PdfToMarkdownService
 */
describe('PdfToMarkdownService', function () {
  describe('textToMarkdown', function () {
    beforeEach(async function (ctx) {
      // Import the module
      const PdfToMarkdownService = (
        await import('../../../app/src/PdfToMarkdownService.mjs')
      ).default
      ctx.textToMarkdown = PdfToMarkdownService.textToMarkdown
    })

    it('should identify section headers', function (ctx) {
      const text = 'Some Title\n\nAbstract\nThis is the abstract content.\n\nIntroduction\nThis is the intro.'
      const result = ctx.textToMarkdown(text)
      expect(result).toContain('## Abstract')
      expect(result).toContain('## Introduction')
    })

    it('should preserve paragraph breaks', function (ctx) {
      const text = 'First paragraph.\n\nSecond paragraph.'
      const result = ctx.textToMarkdown(text)
      expect(result).toContain('First paragraph.')
      expect(result).toContain('Second paragraph.')
    })

    it('should handle numbered sections', function (ctx) {
      const text = '1. Introduction\nContent here.\n\n2. Methods\nMore content.'
      const result = ctx.textToMarkdown(text)
      expect(result).toContain('## Introduction')
      expect(result).toContain('## Methods')
    })

    it('should detect common finance/economics section headers', function (ctx) {
      const sections = [
        'Data and Methodology',
        'Literature Review',
        'Empirical Strategy',
        'Results',
        'Conclusion',
      ]
      
      for (const section of sections) {
        const text = `${section}\nContent follows.`
        const result = ctx.textToMarkdown(text)
        // The section should be converted to a markdown header
        expect(result.toLowerCase()).toContain(section.toLowerCase())
      }
    })
  })

  describe('extractSection', function () {
    beforeEach(async function (ctx) {
      const PdfToMarkdownService = (
        await import('../../../app/src/PdfToMarkdownService.mjs')
      ).default
      ctx.extractSection = PdfToMarkdownService.extractSection
    })

    it('should extract a section by name', function (ctx) {
      const markdown = '# Title\n\n## Abstract\nThis is the abstract.\n\n## Introduction\nThis is the intro.'
      const result = ctx.extractSection(markdown, 'Abstract')
      expect(result).toContain('Abstract')
      expect(result).toContain('This is the abstract')
    })

    it('should return null if section not found', function (ctx) {
      const markdown = '# Title\n\n## Introduction\nContent.'
      const result = ctx.extractSection(markdown, 'NonExistent')
      expect(result).toBeNull()
    })
  })
})

/**
 * Unit tests for LLMService mock responses
 */
describe('LLMService', function () {
  describe('getMockResponse', function () {
    beforeEach(async function (ctx) {
      // Mock settings to not have API key
      vi.doMock('@overleaf/settings', () => ({
        default: { agenticReviewer: {} },
      }))
      vi.doMock('@overleaf/logger', () => ({
        default: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      }))
      
      const LLMService = (await import('../../../app/src/LLMService.mjs')).default
      ctx.LLMService = LLMService
    })

    it('should return mock metadata response when API key is not set', async function (ctx) {
      const response = await ctx.LLMService.extractPaperMetadata('test content')
      expect(response).toHaveProperty('isAcademicPaper')
      expect(response).toHaveProperty('title')
    })

    it('should return mock search queries', async function (ctx) {
      const queries = await ctx.LLMService.generateSearchQueries({
        paperTitle: 'Test Paper',
        paperAbstract: 'Test abstract',
        keywords: ['test'],
        domain: 'finance',
      })
      expect(Array.isArray(queries)).toBe(true)
    })
  })
})

/**
 * Unit tests for AgenticReviewerService
 */
describe('AgenticReviewerService', function () {
  describe('REVIEW_DIMENSIONS', function () {
    beforeEach(async function (ctx) {
      vi.doMock('@overleaf/settings', () => ({
        default: { agenticReviewer: {} },
      }))
      vi.doMock('@overleaf/logger', () => ({
        default: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      }))
      
      const AgenticReviewerService = (
        await import('../../../app/src/AgenticReviewerService.mjs')
      ).default
      ctx.AgenticReviewerService = AgenticReviewerService
    })

    it('should have 7 review dimensions', function (ctx) {
      expect(ctx.AgenticReviewerService.REVIEW_DIMENSIONS.length).toBe(7)
    })

    it('should have weights that sum to 1', function (ctx) {
      const totalWeight = ctx.AgenticReviewerService.REVIEW_DIMENSIONS.reduce(
        (sum, d) => sum + d.weight,
        0
      )
      expect(Math.abs(totalWeight - 1)).toBeLessThan(0.01)
    })

    it('should include all expected dimensions', function (ctx) {
      const dimensionKeys = ctx.AgenticReviewerService.REVIEW_DIMENSIONS.map(
        d => d.key
      )
      expect(dimensionKeys).toContain('originality')
      expect(dimensionKeys).toContain('research_question')
      expect(dimensionKeys).toContain('claims_supported')
      expect(dimensionKeys).toContain('experiments')
      expect(dimensionKeys).toContain('clarity')
      expect(dimensionKeys).toContain('community_value')
      expect(dimensionKeys).toContain('prior_work_context')
    })
  })

  describe('FINANCE_ECON_CRITERIA', function () {
    beforeEach(async function (ctx) {
      vi.doMock('@overleaf/settings', () => ({
        default: { agenticReviewer: {} },
      }))
      vi.doMock('@overleaf/logger', () => ({
        default: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      }))
      
      const AgenticReviewerService = (
        await import('../../../app/src/AgenticReviewerService.mjs')
      ).default
      ctx.AgenticReviewerService = AgenticReviewerService
    })

    it('should have finance/economics specific categories', function (ctx) {
      const criteria = ctx.AgenticReviewerService.FINANCE_ECON_CRITERIA
      expect(criteria).toHaveProperty('methodological_rigor')
      expect(criteria).toHaveProperty('data_quality')
      expect(criteria).toHaveProperty('theoretical_foundation')
      expect(criteria).toHaveProperty('policy_relevance')
    })

    it('should have econometrics criteria', function (ctx) {
      const criteria = ctx.AgenticReviewerService.FINANCE_ECON_CRITERIA
      const methodCriteria = criteria.methodological_rigor.join(' ')
      expect(methodCriteria.toLowerCase()).toContain('econometric')
    })
  })
})

/**
 * Unit tests for PaperSourceService
 */
describe('PaperSourceService', function () {
  describe('SOURCE_TYPES', function () {
    beforeEach(async function (ctx) {
      vi.doMock('@overleaf/settings', () => ({
        default: { agenticReviewer: {} },
      }))
      vi.doMock('@overleaf/logger', () => ({
        default: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      }))
      
      const PaperSourceService = (
        await import('../../../app/src/PaperSourceService.mjs')
      ).default
      ctx.PaperSourceService = PaperSourceService
    })

    it('should define local source type', function (ctx) {
      expect(ctx.PaperSourceService.SOURCE_TYPES.LOCAL).toBe('local')
    })

    it('should define future source types for extensibility', function (ctx) {
      const sourceTypes = ctx.PaperSourceService.SOURCE_TYPES
      expect(sourceTypes).toHaveProperty('ARXIV')
      expect(sourceTypes).toHaveProperty('SSRN')
      expect(sourceTypes).toHaveProperty('REPEC')
      expect(sourceTypes).toHaveProperty('CUSTOM')
    })
  })

  describe('getPapersDirectory', function () {
    beforeEach(async function (ctx) {
      vi.doMock('@overleaf/settings', () => ({
        default: { agenticReviewer: { papersDir: '/custom/path' } },
      }))
      vi.doMock('@overleaf/logger', () => ({
        default: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      }))
      
      const PaperSourceService = (
        await import('../../../app/src/PaperSourceService.mjs')
      ).default
      ctx.PaperSourceService = PaperSourceService
    })

    it('should return configured papers directory', function (ctx) {
      const dir = ctx.PaperSourceService.getPapersDirectory()
      expect(dir).toBe('/custom/path')
    })
  })
})
