import { useState } from 'react';
import { useStore } from '../store/useStore';
import { RepoPicker } from './RepoPicker';
import type { PickedConfig } from './RepoPicker';

interface Props {
  onClose: () => void;
}

// --- Shared helpers ---

const inputCls =
  'w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-blue-500 placeholder-slate-600';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function GitHubLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.1 3.3 9.42 7.87 10.95.58.1.79-.25.79-.55v-2.05c-3.2.7-3.88-1.38-3.88-1.38-.53-1.33-1.28-1.68-1.28-1.68-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.02 1.75 2.68 1.25 3.34.95.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a10.99 10.99 0 0 1 2.89-.39c.98 0 1.97.13 2.89.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.24 2.75.12 3.04.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.39-5.25 5.67.42.36.78 1.07.78 2.15v3.19c0 .3.2.66.8.55C20.2 21.41 23.5 17.1 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
    </svg>
  );
}

// --- Panel ---

export function GitHubPanel({ onClose }: Props) {
  const githubToken = useStore(s => s.githubToken);
  const githubConfig = useStore(s => s.githubConfig);
  const githubFileSha = useStore(s => s.githubFileSha);
  const isDirty = useStore(s => s.isDirty);
  const setGithubToken = useStore(s => s.setGithubToken);
  const setGitHubConfig = useStore(s => s.setGitHubConfig);
  const fetchFromGitHub = useStore(s => s.fetchFromGitHub);
  const saveAsGitHubPR = useStore(s => s.saveAsGitHubPR);

  const [picking, setPicking] = useState(!githubConfig);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const now = new Date();
  const dateSuffix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const [branchName, setBranchName] = useState(`map-edit-${dateSuffix}`);
  const [commitMsg, setCommitMsg] = useState('Update GRpluginMaps from web editor');
  const [prTitle, setPrTitle] = useState('Map data update from EuroScope Map Editor');
  const [prBody, setPrBody] = useState('Edited via the EuroScope Map Editor web app.');

  function openAuthPopup() {
    const popup = window.open(
      '/auth/login',
      'github_oauth',
      'width=900,height=700,popup=1,noopener=0'
    );
    if (!popup) {
      setError('Popup was blocked. Please allow popups and try again.');
    }
  }

  function signOut() {
    setGithubToken(null);
    setGitHubConfig(null);
    setPicking(true);
  }

  async function handlePickedFile(cfg: PickedConfig) {
    if (!githubToken) return;
    setLoading(true);
    setError(null);
    try {
      await fetchFromGitHub({ ...cfg, token: githubToken, baseBranch: cfg.branch });
      setPicking(false);
      setResult({ ok: true, msg: `Loaded ${cfg.filePath} from ${cfg.owner}/${cfg.repo}@${cfg.branch}` });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handlePR() {
    if (!branchName || !commitMsg || !prTitle) {
      setResult({ ok: false, msg: 'Branch name, commit message and PR title are required.' });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const url = await saveAsGitHubPR({ branchName, commitMessage: commitMsg, prTitle, prBody });
      setPrUrl(url);
      setResult({ ok: true, msg: 'PR created!' });
    } catch (e) {
      setResult({ ok: false, msg: String(e) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] bg-black/70 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-slate-800 rounded-xl border border-slate-600 shadow-2xl flex flex-col w-[520px] h-[640px]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-2 text-slate-300">
            <GitHubLogo />
            <span className="font-semibold text-slate-200">GitHub Integration</span>
          </div>
          <div className="flex items-center gap-2">
            {githubToken && (
              <button onClick={signOut} className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-700">
                Sign out
              </button>
            )}
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none">x</button>
          </div>
        </div>

        {/* 1. Not authenticated */}
        {!githubToken && (
          <div className="p-6 flex flex-col items-center gap-5 text-center">
            <div className="w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center text-slate-300">
              <svg viewBox="0 0 24 24" className="w-9 h-9 fill-current" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.1 3.3 9.42 7.87 10.95.58.1.79-.25.79-.55v-2.05c-3.2.7-3.88-1.38-3.88-1.38-.53-1.33-1.28-1.68-1.28-1.68-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.02 1.75 2.68 1.25 3.34.95.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a10.99 10.99 0 0 1 2.89-.39c.98 0 1.97.13 2.89.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.24 2.75.12 3.04.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.39-5.25 5.67.42.36.78 1.07.78 2.15v3.19c0 .3.2.66.8.55C20.2 21.41 23.5 17.1 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
              </svg>
            </div>
            <div>
              <div className="text-slate-200 font-semibold text-base mb-1">Sign in with GitHub</div>
              <div className="text-slate-400 text-xs max-w-xs">
                Authenticate to browse your repositories and open pull requests directly from the editor.
              </div>
            </div>
            <button
              onClick={openAuthPopup}
              className="flex items-center gap-2 px-5 py-2.5 bg-slate-100 hover:bg-white text-slate-900 rounded-lg font-semibold text-sm transition-colors shadow"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.1 3.3 9.42 7.87 10.95.58.1.79-.25.79-.55v-2.05c-3.2.7-3.88-1.38-3.88-1.38-.53-1.33-1.28-1.68-1.28-1.68-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.02 1.75 2.68 1.25 3.34.95.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.17 1.18a10.99 10.99 0 0 1 2.89-.39c.98 0 1.97.13 2.89.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.24 2.75.12 3.04.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.39-5.25 5.67.42.36.78 1.07.78 2.15v3.19c0 .3.2.66.8.55C20.2 21.41 23.5 17.1 23.5 12 23.5 5.65 18.35.5 12 .5z"/>
              </svg>
              Sign in with GitHub
            </button>
            <div className="text-xs text-slate-600">
              A popup will open for GitHub authorisation.
              Requires an OAuth App configured in .env
            </div>
            {error && (
              <div className="w-full px-3 py-2 bg-red-900/40 border border-red-700/50 rounded text-xs text-red-300 text-left">
                {error}
              </div>
            )}
          </div>
        )}

        {/* 2. Authenticated, picking file */}
        {githubToken && picking && (
          <div className="flex-1 min-h-0 flex flex-col relative">
            {error && (
              <div className="mx-3 mt-2 px-3 py-2 bg-red-900/40 border border-red-700/50 rounded text-xs text-red-300 flex-shrink-0">
                {error}
              </div>
            )}
            {loading && (
              <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center z-10 rounded-b-xl">
                <span className="text-slate-400 text-sm">Loading...</span>
              </div>
            )}
            <RepoPicker token={githubToken} onPick={handlePickedFile} />
          </div>
        )}

        {/* 3. Authenticated, file loaded, PR form */}
        {githubToken && !picking && githubConfig && (
          <div className="p-4 space-y-3 overflow-y-auto flex-1">
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-900/60 border border-slate-700 rounded text-xs">
              <span className="text-green-400">ok</span>
              <span className="text-slate-300 truncate flex-1">
                <span className="text-slate-500">{githubConfig.owner}/{githubConfig.repo} </span>
                {githubConfig.filePath}
                <span className="text-slate-500"> @ {githubConfig.baseBranch}</span>
              </span>
              <button onClick={() => { setPicking(true); setResult(null); }}
                className="text-blue-400 hover:text-blue-300 text-[10px] underline flex-shrink-0">
                change
              </button>
            </div>

            {result && (
              <div className={`rounded p-2 text-xs ${result.ok
                ? 'bg-green-900/40 text-green-400 border border-green-800'
                : 'bg-red-900/40 text-red-400 border border-red-800'}`}>
                {result.msg}
              </div>
            )}

            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider pt-1">Open Pull Request</div>

            {!githubFileSha && (
              <div className="bg-amber-900/40 border border-amber-700/50 rounded p-3 text-xs text-amber-300">
                No file SHA found. Try re-picking the file.
              </div>
            )}
            {!isDirty && githubFileSha && (
              <div className="bg-slate-700/40 border border-slate-600 rounded p-3 text-xs text-slate-400">
                No unsaved changes. Edit the map first, then open a PR.
              </div>
            )}

            <Field label="New branch name">
              <input value={branchName} onChange={e => setBranchName(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Commit message">
              <input value={commitMsg} onChange={e => setCommitMsg(e.target.value)} className={inputCls} />
            </Field>
            <Field label="PR title">
              <input value={prTitle} onChange={e => setPrTitle(e.target.value)} className={inputCls} />
            </Field>
            <Field label="PR description">
              <textarea value={prBody} onChange={e => setPrBody(e.target.value)} rows={3} className={inputCls + ' resize-none'} />
            </Field>

            <button
              onClick={handlePR}
              disabled={loading || !githubFileSha}
              className="w-full bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white py-2 rounded text-sm font-medium transition-colors"
            >
              {loading ? 'Creating PR...' : 'Create Pull Request on GitHub'}
            </button>

            {prUrl && (
              <a href={prUrl} target="_blank" rel="noopener noreferrer"
                className="block text-center text-xs text-blue-400 hover:text-blue-300 underline">
                Open PR on GitHub
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
