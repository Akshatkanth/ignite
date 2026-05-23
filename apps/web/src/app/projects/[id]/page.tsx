'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { projectsApi, deploymentsApi } from '@/lib/api';
import {
  Zap, ArrowLeft, Play, Loader2, GitBranch, CheckCircle2, XCircle,
  Clock, Activity, ExternalLink, RefreshCw, AlertCircle,
} from 'lucide-react';
import { Edit, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Deployment {
  id: string; status: string; commitMessage: string | null;
  commitSha: string | null; duration: number | null; createdAt: string;
  triggeredBy: string | null; error: string | null;
}
interface Project {
  id: string; name: string; repoUrl: string; branch: string;
  description: string | null; deploymentCount: number; lastDeployment: Deployment | null;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  HEALTHY: <CheckCircle2 size={14} className="text-green-400" />,
  FAILED: <XCircle size={14} className="text-red-400" />,
  CANCELLED: <XCircle size={14} className="text-zinc-400" />,
  QUEUED: <Clock size={14} className="text-yellow-400" />,
  BUILDING: <Loader2 size={14} className="text-blue-400 animate-spin" />,
  CLONING: <Loader2 size={14} className="text-blue-400 animate-spin" />,
  VALIDATING: <Loader2 size={14} className="text-blue-400 animate-spin" />,
  HEALTH_CHECK: <Loader2 size={14} className="text-blue-400 animate-spin" />,
};

const STATUS_LABEL: Record<string, string> = {
  HEALTHY: 'Healthy', FAILED: 'Failed', CANCELLED: 'Cancelled',
  QUEUED: 'Queued', BUILDING: 'Building', CLONING: 'Cloning',
  VALIDATING: 'Validating', HEALTH_CHECK: 'Health check',
};

const ACTIVE_STATUSES = ['QUEUED', 'CLONING', 'VALIDATING', 'BUILDING', 'HEALTH_CHECK'];

function DeploymentRow({ deployment }: { deployment: Deployment }) {
  const isActive = ACTIVE_STATUSES.includes(deployment.status);
  return (
    <Link href={`/deployments/${deployment.id}`}
      className="flex items-center justify-between px-4 py-3.5 hover:bg-accent/50 transition-colors group">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex-shrink-0">{STATUS_ICON[deployment.status] ?? <Activity size={14} />}</div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${isActive ? 'text-blue-400' : ''}`}>
              {STATUS_LABEL[deployment.status] ?? deployment.status}
            </span>
            {deployment.commitSha && (
              <span className="text-xs font-mono text-muted-foreground bg-accent px-1.5 py-0.5 rounded">
                {deployment.commitSha.slice(0, 7)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {deployment.commitMessage ?? 'Manual deployment'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4 flex-shrink-0 ml-4">
        {deployment.duration && (
          <span className="text-xs text-muted-foreground hidden sm:block">{deployment.duration}s</span>
        )}
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(deployment.createdAt), { addSuffix: true })}
        </span>
        <ExternalLink size={13} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
      </div>
    </Link>
  );
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployError, setDeployError] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', repoUrl: '', branch: '', description: '' });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  const loadData = async () => {
    try {
      const [projRes, depRes] = await Promise.all([
        projectsApi.get(id),
        projectsApi.getDeployments(id, { limit: 20 }),
      ]);
      setProject(projRes.data.data.project);
      setDeployments(depRes.data.data.data);
    } catch {
      router.push('/dashboard');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { if (isAuthenticated) loadData(); }, [isAuthenticated, id]);

  useEffect(() => {
    if (project) {
      setEditForm({ name: project.name, repoUrl: project.repoUrl, branch: project.branch, description: project.description ?? '' });
    }
  }, [project]);

  const handleDeploy = async () => {
    setDeployError('');
    setIsDeploying(true);
    try {
      const res = await deploymentsApi.trigger(id);
      router.push(`/deployments/${res.data.data.deployment.id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to trigger deployment';
      setDeployError(msg);
      setIsDeploying(false);
    }
  };

  const repoName = project?.repoUrl.split('/').slice(-2).join('/');

  if (isLoading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/" className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary text-primary-foreground">
            <Zap size={14} strokeWidth={2.5} />
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium text-sm">{project?.name}</span>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition mb-6">
          <ArrowLeft size={14} /> All projects
        </Link>

        {/* Project header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            {!isEditing ? (
              <>
                <h1 className="text-2xl font-bold tracking-tight">{project?.name}</h1>
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-sm text-muted-foreground font-mono">{repoName}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <GitBranch size={12} />{project?.branch}
                  </span>
                </div>
                {project?.description && <p className="text-sm text-muted-foreground mt-2">{project.description}</p>}
              </>
            ) : (
              <div className="space-y-3">
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-input border border-border" />
                <input value={editForm.repoUrl} onChange={(e) => setEditForm({ ...editForm, repoUrl: e.target.value })} className="w-full px-3 py-2 rounded-lg bg-input border border-border" />
                <div className="flex gap-2">
                  <input value={editForm.branch} onChange={(e) => setEditForm({ ...editForm, branch: e.target.value })} className="flex-1 px-3 py-2 rounded-lg bg-input border border-border" />
                  <input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="flex-1 px-3 py-2 rounded-lg bg-input border border-border" placeholder="Short description" />
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <a href={project?.repoUrl} target="_blank" rel="noopener noreferrer" title="Open repository" className="p-2 rounded-lg border border-border hover:bg-accent transition">
              <ExternalLink size={14} />
            </a>
            <button onClick={loadData} className="p-2 rounded-lg border border-border hover:bg-accent transition" title="Refresh">
              <RefreshCw size={14} />
            </button>
            {!isEditing ? (
              <button onClick={() => setIsEditing(true)} title="Edit project" className="p-2 rounded-lg border border-border hover:bg-accent transition">
                <Edit size={14} />
              </button>
            ) : (
              <>
                <button onClick={async () => {
                  try {
                    setIsDeploying(true);
                    await projectsApi.update(id, { name: editForm.name, description: editForm.description || undefined, repoUrl: editForm.repoUrl, branch: editForm.branch });
                    await loadData();
                    setIsEditing(false);
                  } catch (e) {
                    // ignore errors for now
                  } finally {
                    setIsDeploying(false);
                  }
                }} className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm">Save</button>
                <button onClick={() => { setIsEditing(false); setEditForm({ name: project?.name ?? '', repoUrl: project?.repoUrl ?? '', branch: project?.branch ?? '', description: project?.description ?? '' }); }} className="px-3 py-2 rounded-lg border border-border text-sm">Cancel</button>
              </>
            )}

            <button onClick={handleDeploy} disabled={isDeploying}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition">
              {isDeploying ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {isDeploying ? 'Deploying...' : 'Deploy'}
            </button>

            <button onClick={async () => {
              if (!confirm('Delete this project? This cannot be undone.')) return;
              try {
                await projectsApi.delete(id);
                router.push('/');
              } catch (err) {
                // noop
              }
            }} title="Delete project" className="p-2 rounded-lg border border-destructive text-destructive hover:bg-destructive/10 transition">
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {deployError && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm mb-6">
            <AlertCircle size={14} />{deployError}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Total Deployments', value: project?.deploymentCount ?? 0 },
            { label: 'Last Status', value: project?.lastDeployment ? STATUS_LABEL[project.lastDeployment.status] ?? project.lastDeployment.status : '—' },
            { label: 'Last Duration', value: project?.lastDeployment?.duration ? `${project.lastDeployment.duration}s` : '—' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-xl font-bold mt-1">{String(value)}</p>
            </div>
          ))}
        </div>

        {/* Deployments list */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="font-semibold text-sm">Deployment History</h2>
          </div>
          {deployments.length === 0 ? (
            <div className="px-4 py-12 text-center text-muted-foreground text-sm">
              No deployments yet — click <strong>Deploy</strong> to run the pipeline
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {deployments.map((d) => <DeploymentRow key={d.id} deployment={d} />)}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
