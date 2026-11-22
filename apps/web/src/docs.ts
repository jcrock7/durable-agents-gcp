// The public repository's design documents, linked where the portal names them.
export const DOCS = {
  repo: "https://github.com/jcrock7/durable-agents-gcp",
  architecture: "https://github.com/jcrock7/durable-agents-gcp/blob/main/docs/architecture.html",
  adrs: "https://github.com/jcrock7/durable-agents-gcp/tree/main/docs/adr",
};

/** A file under docs/ in the repository. */
export const docLink = (path: string) => `${DOCS.repo}/blob/main/docs/${path}`;

/** Any file in the repository, by its path from the root. */
export const repoLink = (path: string) => `${DOCS.repo}/blob/main/${path}`;
