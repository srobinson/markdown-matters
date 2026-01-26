/**
 * Duplicate detection module exports
 */

export type {
  CollapsedResult,
  CollapseOptions,
  DuplicateDetectionOptions,
  DuplicateDetectionResult,
  DuplicateGroup,
  DuplicateSectionInfo,
} from './detector.js'

export {
  collapseDuplicates,
  detectDuplicates,
  detectExactDuplicates,
} from './detector.js'
