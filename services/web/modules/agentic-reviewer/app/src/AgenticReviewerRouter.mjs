import logger from '@overleaf/logger'

import AgenticReviewerController from './AgenticReviewerController.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'

export default {
  apply(webRouter) {
    logger.debug({}, 'Init agentic reviewer router')

    // Submit a paper for review
    webRouter.post(
      '/api/agentic-reviewer/submit',
      AuthenticationController.requireLogin(),
      AgenticReviewerController.submitPaper
    )

    // Get review status
    webRouter.get(
      '/api/agentic-reviewer/status/:reviewId',
      AuthenticationController.requireLogin(),
      AgenticReviewerController.getReviewStatus
    )

    // Get review result
    webRouter.get(
      '/api/agentic-reviewer/result/:reviewId',
      AuthenticationController.requireLogin(),
      AgenticReviewerController.getReviewResult
    )

    // List user's reviews
    webRouter.get(
      '/api/agentic-reviewer/reviews',
      AuthenticationController.requireLogin(),
      AgenticReviewerController.listReviews
    )

    // Get local papers from directory
    webRouter.get(
      '/api/agentic-reviewer/local-papers',
      AuthenticationController.requireLogin(),
      AgenticReviewerController.listLocalPapers
    )

    // Search related work (in local papers directory)
    webRouter.post(
      '/api/agentic-reviewer/search-related-work',
      AuthenticationController.requireLogin(),
      AgenticReviewerController.searchRelatedWork
    )

    // Main reviewer page
    webRouter.get(
      '/agentic-reviewer',
      AuthenticationController.requireLogin(),
      AgenticReviewerController.reviewerPage
    )
  },
}
