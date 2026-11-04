export { GitHubPostsClient } from './github-client.js';
export type { GitHubPostsClientConfig } from './github-client.js';

export {
  GitHubClientError,
  PostNotFoundError,
  PostAlreadyExistsError,
  ShaConflictError,
  RateLimitError,
  ValidationError,
  GitHubApiError,
  PageNotFoundError,
  PageShaConflictError,
} from './errors.js';

export { postFrontmatterSchema, pageFrontmatterSchema } from './schema.js';
export type { ValidatedPostFrontmatter, ValidatedPageFrontmatter } from './schema.js';

export { parsePostFile, serializePostFile, parsePageFile, serializePageFile, MalformedPostFileError } from './markdown.js';

export { CATEGORIES, AFFILIATE_PROVIDERS } from './types.js';
export type {
  Category,
  AffiliateProvider,
  FaqItem,
  AffiliateLink,
  PostFrontmatter,
  PostListItem,
  PostRecord,
  WriteResult,
  RenamePostResult,
  PageFrontmatter,
  PageListItem,
  PageRecord,
} from './types.js';
