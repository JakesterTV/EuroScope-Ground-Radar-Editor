import { useState, useEffect, useMemo } from 'react';

// ─── GitHub API types ─────────────────────────────────────────────────────────

interface GHUser { login: string; avatar_url: string; name: string | null; }
interface GHRepo {
  id: number; name: string; full_name: string;
  owner: { login: string };
  private: boolean; updated_at: string;
  description: string | null; default_branch: string;
}
interface GHOrg { login: string; }
interface GHBranch { name: string; commit: { sha: string }; }
interface GHTreeItem { path: string; type: 'blob' | 'tree'; }

// ─── Proxy helper ─────────────────────────────────────────────────────────────

const API = 'https://api.github.com';
const PROXY = '/api/github-proxy';

async function ghGet<T>(url: string, token: string): Promise<T> {
  const res = await fetch(PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, token, method: 'GET' }),
  });
  if (!res.ok) throw new Error(`Proxy error ${res.status}`);
  const result = await res.json() as { ok: boolean; status: number; data: T; error?: string };
  if (result.error) throw new Error(result.error);
  if (!result.ok) {
    const d = result.data as Record<string, unknown>;
    throw new Error(`GitHub ${result.status}: ${String(d?.message ?? 'unknown error')}`);
  }
  return result.data;
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface PickedConfig {
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
}

interface Props {
  token: string;
  onPick: (cfg: PickedConfig) => void;
}

// ─── File tree helpers ────────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  fullPath: string;
  type: 'blob' | 'tree';
  children: TreeNode[];
}

function buildTree(items: GHTreeItem[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const item of items) {
    const parts = item.path.split('/');
    let nodes = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      let node = nodes.find(n => n.name === part);
      if (!node) {
        node = { name: part, fullPath: parts.slice(0, i + 1).join('/'), type: i === parts.length - 1 ? item.type : 'tree', children: [] };
        nodes.push(node);
      }
      nodes = node.children;
    }
  }
  // Sort: folders first, then files
  const sortNodes = (ns: TreeNode[]) => {
    ns.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'tree' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    ns.forEach(n => sortNodes(n.children));
  };
  sortNodes(root);
  return root;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function FileTreeNode({
  node, depth, expanded, onToggle, onSelect, search,
}: {
  node: TreeNode; depth: number;
  expanded: Set<string>; onToggle: (p: string) => void;
  onSelect: (p: string) => void; search: string;
}) {
  const isTxt = node.type === 'blob' && node.name.endsWith('.txt');
  const isFile = node.type === 'blob';
  const isOpen = node.type === 'tree' && expanded.has(node.fullPath);

  // When searching, hide nodes that don't match
  if (search && node.type === 'blob') {
    if (!node.fullPath.toLowerCase().includes(search.toLowerCase())) return null;
  }

  return (
    <div>
      <div
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        className={`flex items-center gap-1.5 py-0.5 px-1 rounded text-xs cursor-pointer select-none
          ${isTxt ? 'hover:bg-blue-700/30 text-slate-200' : isFile ? 'text-slate-500 cursor-default' : 'hover:bg-slate-700/40 text-slate-400'}`}
        onClick={() => {
          if (node.type === 'tree') onToggle(node.fullPath);
          else if (isTxt) onSelect(node.fullPath);
        }}
      >
        <span className="flex-shrink-0 w-3.5 text-center">
          {node.type === 'tree' ? (isOpen ? '▾' : '▸') : (isTxt ? '📄' : '·')}
        </span>
        <span className={`truncate ${isTxt ? 'font-medium' : ''}`}>{node.name}</span>
        {isTxt && (
          <span className="ml-auto text-blue-400 text-[10px] flex-shrink-0 pr-1">select</span>
        )}
      </div>
      {isOpen && node.children.map(child => (
        <FileTreeNode
          key={child.fullPath} node={child} depth={depth + 1}
          expanded={expanded} onToggle={onToggle}
          onSelect={onSelect} search={search}
        />
      ))}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

type Step = 'repo' | 'branch' | 'file';

export function RepoPicker({ token, onPick }: Props) {
  const [step, setStep] = useState<Step>('repo');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Repo step
  const [user, setUser] = useState<GHUser | null>(null);
  const [repos, setRepos] = useState<GHRepo[]>([]);
  const [repoSearch, setRepoSearch] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GHRepo | null>(null);

  // Branch step
  const [branches, setBranches] = useState<GHBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);

  // File step
  const [treeItems, setTreeItems] = useState<GHTreeItem[]>([]);
  const [fileSearch, setFileSearch] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // ── Load user + repos on mount ──────────────────────────────────────────────

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [userData, repoData, orgData] = await Promise.all([
          ghGet<GHUser>(`${API}/user`, token),
          ghGet<GHRepo[]>(`${API}/user/repos?per_page=100&sort=updated&type=all`, token),
          ghGet<GHOrg[]>(`${API}/user/orgs`, token),
        ]);
        if (cancelled) return;
        setUser(userData);
        let allRepos = [...repoData];
        // Load org repos in parallel
        const orgRepoArrays = await Promise.all(
          orgData.map(org =>
            ghGet<GHRepo[]>(`${API}/orgs/${org.login}/repos?per_page=100&sort=updated`, token)
              .catch(() => [] as GHRepo[])
          )
        );
        if (cancelled) return;
        for (const or of orgRepoArrays) allRepos = [...allRepos, ...or];
        // Deduplicate by id, sort by last updated
        const seen = new Set<number>();
        allRepos = allRepos.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
        allRepos.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        setRepos(allRepos);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [token]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  async function pickRepo(repo: GHRepo) {
    setSelectedRepo(repo);
    setLoading(true);
    setError(null);
    try {
      const branchData = await ghGet<GHBranch[]>(`${API}/repos/${repo.full_name}/branches?per_page=100`, token);
      setBranches(branchData);
      setSelectedBranch(repo.default_branch);
      setStep('branch');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function pickBranch(branch: GHBranch) {
    setSelectedBranch(branch.name);
    setLoading(true);
    setError(null);
    try {
      const treeData = await ghGet<{ tree: GHTreeItem[]; truncated: boolean }>(
        `${API}/repos/${selectedRepo!.full_name}/git/trees/${branch.commit.sha}?recursive=1`,
        token
      );
      setTreeItems(treeData.tree.filter(i => i.type === 'blob' || i.type === 'tree'));
      // Auto-expand root
      const rootFolders = new Set(
        treeData.tree.filter(i => i.type === 'tree' && !i.path.includes('/')).map(i => i.path)
      );
      setExpandedFolders(rootFolders);
      setStep('file');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function pickFile(filePath: string) {
    onPick({ owner: selectedRepo!.owner.login, repo: selectedRepo!.name, branch: selectedBranch!, filePath });
  }

  function toggleFolder(path: string) {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }

  // ── Derived data ─────────────────────────────────────────────────────────────

  const filteredRepos = useMemo(() =>
    repos.filter(r => r.full_name.toLowerCase().includes(repoSearch.toLowerCase()) ||
      (r.description ?? '').toLowerCase().includes(repoSearch.toLowerCase())),
    [repos, repoSearch]
  );

  const fileTree = useMemo(() => buildTree(treeItems), [treeItems]);

  // ── Shared header ─────────────────────────────────────────────────────────────

  const crumbs = [
    { label: user ? `@${user.login}` : 'Repos', active: step === 'repo', onClick: step !== 'repo' ? () => setStep('repo') : undefined },
    ...(selectedRepo ? [{ label: selectedRepo.name, active: step === 'branch', onClick: step === 'file' ? () => setStep('branch') : undefined }] : []),
    ...(selectedBranch && step === 'file' ? [{ label: selectedBranch, active: true, onClick: undefined }] : []),
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Breadcrumb nav */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-700 text-xs flex-shrink-0">
        {user && (
          <img src={user.avatar_url} alt="" className="w-5 h-5 rounded-full mr-1 flex-shrink-0" />
        )}
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-slate-600">/</span>}
            <span
              className={`${c.active ? 'text-slate-200 font-medium' : 'text-blue-400 hover:underline cursor-pointer'}`}
              onClick={c.onClick}
            >{c.label}</span>
          </span>
        ))}
        {loading && <span className="ml-auto text-slate-500 animate-pulse">Loading…</span>}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-3 mt-2 px-3 py-2 bg-red-900/40 border border-red-700/50 rounded text-xs text-red-300 flex-shrink-0">
          {error}
        </div>
      )}

      {/* ── Step: Repos ─────────────────────────────────────────────────── */}
      {step === 'repo' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="px-3 py-2 flex-shrink-0">
            <input
              value={repoSearch}
              onChange={e => setRepoSearch(e.target.value)}
              placeholder="Search repositories…"
              className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500"
              autoFocus
            />
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
            {loading && repos.length === 0 && (
              <div className="text-slate-500 text-xs text-center py-8">Fetching repositories…</div>
            )}
            {!loading && filteredRepos.length === 0 && repos.length > 0 && (
              <div className="text-slate-500 text-xs text-center py-6">No repos match "{repoSearch}"</div>
            )}
            {filteredRepos.map(repo => (
              <button key={repo.id} onClick={() => pickRepo(repo)}
                className="w-full text-left px-3 py-2.5 rounded bg-slate-800/50 hover:bg-slate-700/60 border border-slate-700/50 hover:border-slate-600 transition-colors group">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-200 truncate flex-1">
                    {repo.owner.login !== user?.login && (
                      <span className="text-slate-500">{repo.owner.login}/</span>
                    )}
                    {repo.name}
                  </span>
                  {repo.private && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-slate-700 text-slate-400 flex-shrink-0">private</span>
                  )}
                  <span className="text-slate-500 text-[10px] flex-shrink-0 opacity-0 group-hover:opacity-100">→</span>
                </div>
                {repo.description && (
                  <div className="text-[10px] text-slate-500 mt-0.5 truncate">{repo.description}</div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step: Branches ──────────────────────────────────────────────── */}
      {step === 'branch' && selectedRepo && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="px-3 pt-2 pb-1 text-xs text-slate-500 flex-shrink-0">
            Select a branch from <span className="text-slate-300 font-medium">{selectedRepo.full_name}</span>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
            {loading && branches.length === 0 && (
              <div className="text-slate-500 text-xs text-center py-8">Fetching branches…</div>
            )}
            {branches.map(branch => (
              <button key={branch.name} onClick={() => pickBranch(branch)}
                className={`w-full text-left px-3 py-2 rounded border transition-colors text-xs
                  ${branch.name === selectedRepo.default_branch
                    ? 'bg-blue-900/30 border-blue-700/50 text-blue-200 hover:bg-blue-800/40'
                    : 'bg-slate-800/50 border-slate-700/50 text-slate-300 hover:bg-slate-700/60 hover:border-slate-600'
                  }`}>
                <div className="flex items-center gap-2">
                  <span className="font-medium flex-1 truncate">{branch.name}</span>
                  {branch.name === selectedRepo.default_branch && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-blue-900/60 text-blue-300 flex-shrink-0">default</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step: File tree ──────────────────────────────────────────────── */}
      {step === 'file' && (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="px-3 py-2 flex-shrink-0 border-b border-slate-700/50">
            <input
              value={fileSearch}
              onChange={e => { setFileSearch(e.target.value); }}
              placeholder="Filter files…"
              className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500"
              autoFocus
            />
            <div className="text-[10px] text-slate-600 mt-1">Only .txt files are selectable</div>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {loading && treeItems.length === 0 && (
              <div className="text-slate-500 text-xs text-center py-8">Loading file tree…</div>
            )}
            {fileSearch
              ? /* Flat filtered list when searching */
              treeItems
                .filter(i => i.type === 'blob' && i.path.toLowerCase().includes(fileSearch.toLowerCase()))
                .map(i => {
                  const isTxt = i.path.endsWith('.txt');
                  return (
                    <div key={i.path}
                      className={`flex items-center gap-2 px-3 py-1 text-xs rounded mx-1
                        ${isTxt ? 'cursor-pointer hover:bg-blue-700/30 text-slate-200' : 'text-slate-500 cursor-default'}`}
                      onClick={() => isTxt && pickFile(i.path)}>
                      <span className="w-3.5 text-center flex-shrink-0">{isTxt ? '📄' : '·'}</span>
                      <span className="truncate">{i.path}</span>
                      {isTxt && <span className="ml-auto text-blue-400 text-[10px] flex-shrink-0">select</span>}
                    </div>
                  );
                })
              : /* Tree view when not searching */
              fileTree.map(node => (
                <FileTreeNode
                  key={node.fullPath} node={node} depth={0}
                  expanded={expandedFolders} onToggle={toggleFolder}
                  onSelect={pickFile} search=""
                />
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}
