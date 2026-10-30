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
} from './errors.js';

export { postFrontmatterSchema } from './schema.js';
export type { ValidatedPostFrontmatter } from './schema.js';

export { parsePostFile, serializePostFile, MalformedPostFileError } from './markdown.js';

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
} from './types.js';
