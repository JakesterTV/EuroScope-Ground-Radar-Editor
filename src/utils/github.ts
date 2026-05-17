/**
 * GitHub REST API helpers for:
 *  - fetching a file's content and its blob SHA
 *  - creating a branch from another ref
 *  - committing an updated file onto a branch
 *  - opening a Pull Request
 *
 * All GitHub requests are routed through /api/github-proxy (the local Express
 * server) to avoid CORS preflight failures in the browser.
 */

export interface GitHubConfig {
  owner: string;
  repo: string;
  /** Path inside the repo, e.g. "maps/GRpluginMaps.txt" */
  filePath: string;
  /** Personal Access Token with repo scope */
  token: string;
  /** Branch to read from (default: "main") */
  baseBranch: string;
}

export interface FetchedFile {
  content: string;
  sha: string;
  /** The download URL (raw.githubusercontent.com) */
  downloadUrl: string;
}

const API = 'https://api.github.com';
/** Route all GitHub calls through the local server to avoid CORS. */
const PROXY = '/api/github-proxy';

/**
 * Core proxy call. Sends { url, method, body, token } to the local Express
 * server which forwards to GitHub and returns { ok, status, data }.
 */
async function ghFetch<T = unknown>(
  url: string,
  token: string,
  method = 'GET',
  body?: unknown
): Promise<T> {
  const res = await fetch(PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, method, body, token }),
  });

  if (!res.ok) {
    let msg = `Proxy error ${res.status}`;
    try {
      const e = await res.json() as { error?: string };
      if (e.error) msg = e.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const result = await res.json() as { ok: boolean; status: number; data: T };
  if (!result.ok) {
    let msg = `GitHub API ${result.status}`;
    const d = result.data as Record<string, unknown>;
    if (d && typeof d === 'object' && 'message' in d) {
      msg += `: ${d.message}`;
    }
    throw new Error(msg);
  }
  return result.data;
}

/**
 * Fetch a file from a GitHub repository.
 * Uses the Contents API to get the blob SHA, then fetches raw content via
 * the download_url (handles files of any size; avoids base64 decode issues).
 */
export async function githubFetchFile(cfg: GitHubConfig): Promise<FetchedFile> {
  const metaUrl = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.filePath}?ref=${encodeURIComponent(cfg.baseBranch)}`;
  const meta = await ghFetch<{ sha: string; download_url: string }>(metaUrl, cfg.token);

  // Always fetch raw content via download_url — works for any file size
  const content = await ghFetch<string>(meta.download_url, cfg.token);

  return { content, sha: meta.sha, downloadUrl: meta.download_url };
}

/**
 * Get the SHA of a branch tip (used to create a new branch from it).
 */
async function getBranchSha(cfg: GitHubConfig, branchName: string): Promise<string> {
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/git/ref/heads/${encodeURIComponent(branchName)}`;
  const data = await ghFetch<{ object: { sha: string } }>(url, cfg.token);
  return data.object.sha;
}

/**
 * Create a new branch from the base branch.
 * Returns the new branch name.
 */
export async function githubCreateBranch(
  cfg: GitHubConfig,
  newBranchName: string
): Promise<string> {
  const sha = await getBranchSha(cfg, cfg.baseBranch);
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/git/refs`;
  await ghFetch(url, cfg.token, 'POST', {
    ref: `refs/heads/${newBranchName}`,
    sha,
  });
  return newBranchName;
}

/**
 * Commit an updated file to a branch.
 * @param fileSha  The blob SHA of the existing file (from githubFetchFile).
 *
 * The raw content string is sent to the proxy with the special key __rawContent.
 * The proxy base64-encodes it via Buffer.from(…, 'utf-8') before forwarding to
 * GitHub, which correctly handles any Unicode characters.
 */
export async function githubCommitFile(
  cfg: GitHubConfig,
  branch: string,
  content: string,
  fileSha: string,
  commitMessage: string
): Promise<void> {
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.filePath}`;
  await ghFetch(url, cfg.token, 'PUT', {
    message: commitMessage,
    __rawContent: content,   // proxy will base64-encode this via Node Buffer
    sha: fileSha,
    branch,
  });
}

/**
 * Open a Pull Request from the given branch into the base branch.
 * Returns the PR URL.
 */
export async function githubCreatePR(
  cfg: GitHubConfig,
  head: string,
  title: string,
  body: string
): Promise<string> {
  const url = `${API}/repos/${cfg.owner}/${cfg.repo}/pulls`;
  const data = await ghFetch<{ html_url: string }>(url, cfg.token, 'POST', {
    title,
    body,
    head,
    base: cfg.baseBranch,
  });
  return data.html_url;
}

/**
 * Convenience: create branch → commit → open PR in one call.
 * Returns the PR URL.
 */
export async function githubPushAsPR(
  cfg: GitHubConfig,
  content: string,
  fileSha: string,
  opts: {
    branchName: string;
    commitMessage: string;
    prTitle: string;
    prBody: string;
  }
): Promise<string> {
  await githubCreateBranch(cfg, opts.branchName);
  await githubCommitFile(cfg, opts.branchName, content, fileSha, opts.commitMessage);
  return githubCreatePR(cfg, opts.branchName, opts.prTitle, opts.prBody);
}
