'use client';

import { useEffect, useState, useRef, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { deploymentsApi } from '@/lib/api';
import { io, Socket } from 'socket.io-client';
import {
  Zap, ArrowLeft, CheckCircle2, XCircle, Clock, Loader2,
  Activity, Terminal, StopCircle, ChevronDown,
} from 'lucide-react';
import Loading from '@/components/ui/Loading';
import ErrorMessage from '@/components/ui/ErrorMessage';
import { formatDistanceToNow, format } from 'date-fns';

interface LogLine {
  id?: string; message: string; level: string; timestamp: string;
}
interface Deployment {
  id: string; projectId: string; status: string; commitMessage: string | null;
  commitSha: string | null; duration: number | null; createdAt: string;
  startedAt: string | null; completedAt: string | null; error: string | null;
  previewScreenshotPath: string | null; previewScreenshotUrl: string | null;
  previewScreenshotCapturedAt: string | null;
}

const ACTIVE_STATUSES = ['QUEUED', 'CLONING', 'VALIDATING', 'BUILDING', 'HEALTH_CHECK'];

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  QUEUED:       { label: 'Queued',      color: 'text-yellow-400', bg: 'bg-yellow-400/10', icon: <Clock size={14} /> },
  CLONING:      { label: 'Cloning',     color: 'text-blue-400',   bg: 'bg-blue-400/10',   icon: <Loader2 size={14} className="animate-spin" /> },
  VALIDATING:   { label: 'Validating',  color: 'text-blue-400',   bg: 'bg-blue-400/10',   icon: <Loader2 size={14} className="animate-spin" /> },
  BUILDING:     { label: 'Building',    color: 'text-blue-400',   bg: 'bg-blue-400/10',   icon: <Loader2 size={14} className="animate-spin" /> },
  HEALTH_CHECK: { label: 'Health Check',color: 'text-blue-400',   bg: 'bg-blue-400/10',   icon: <Loader2 size={14} className="animate-spin" /> },
  HEALTHY:      { label: 'Healthy',     color: 'text-green-400',  bg: 'bg-green-400/10',  icon: <CheckCircle2 size={14} /> },
  FAILED:       { label: 'Failed',      color: 'text-red-400',    bg: 'bg-red-400/10',    icon: <XCircle size={14} /> },
  CANCELLED:    { label: 'Cancelled',   color: 'text-zinc-400',   bg: 'bg-zinc-400/10',   icon: <XCircle size={14} /> },
};

const LOG_COLORS: Record<string, string> = {
  info:    'text-zinc-300',
  warn:    'text-yellow-400',
  error:   'text-red-400',
  success: 'text-green-400',
};

const PIPELINE_STEPS = ['QUEUED', 'CLONING', 'VALIDATING', 'BUILDING', 'HEALTH_CHECK', 'HEALTHY'];

function PipelineProgress({ status }: { status: string }) {
  const currentIdx = PIPELINE_STEPS.indexOf(status);
  const isFailed = status === 'FAILED' || status === 'CANCELLED';

  return (
    <div className="flex items-center gap-1">
      {PIPELINE_STEPS.slice(1, -1).map((step, i) => {
        const stepIdx = i + 1;
        const done = !isFailed && currentIdx > stepIdx;
        const active = !isFailed && currentIdx === stepIdx;
        const failed = isFailed && stepIdx <= Math.max(currentIdx, 1);
        return (
          <div key={step} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full transition-all duration-500 ${
              failed ? 'bg-red-400' :
              done ? 'bg-green-400' :
              active ? 'bg-blue-400 animate-pulse' :
              'bg-zinc-700'}`}
            />
            {i < 3 && <div className={`h-px w-6 transition-all duration-500 ${done ? 'bg-green-400' : 'bg-zinc-700'}`} />}
          </div>
        );
      })}
      {status === 'HEALTHY' && <div className="w-2 h-2 rounded-full bg-green-400" />}
    </div>
  );
}

export default function DeploymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [previewImageFailed, setPreviewImageFailed] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  // Load initial deployment data + existing logs
  useEffect(() => {
    if (!isAuthenticated) return;
    Promise.all([
      deploymentsApi.get(id),
      deploymentsApi.getLogs(id, { limit: 100 }),
    ]).then(([depRes, logRes]) => {
      setDeployment(depRes.data.data.deployment);
      setLogs(logRes.data.data.data);
    }).finally(() => setIsLoading(false));
  }, [isAuthenticated, id]);

  // WebSocket connection for live logs
  useEffect(() => {
    if (!deployment) return;
    if (!ACTIVE_STATUSES.includes(deployment.status)) return;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    const socket = io(apiUrl, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      socket.emit('deployment:subscribe', id);
    });

    socket.on('disconnect', () => setIsConnected(false));

    socket.on('deployment:log', (event: { log: LogLine }) => {
      setLogs((prev) => [...prev, event.log]);
    });

    socket.on('deployment:status', (event: { status: string }) => {
      setDeployment((prev) => prev ? { ...prev, status: event.status } : prev);
      if (!ACTIVE_STATUSES.includes(event.status)) {
        socket.emit('deployment:unsubscribe', id);
        // Refresh final data
        deploymentsApi.get(id).then((res) => setDeployment(res.data.data.deployment));
      }
    });

    // Listen for preview capture events and update deployment preview fields
    socket.on('deployment:preview', (event: { previewScreenshotUrl?: string; previewScreenshotCapturedAt?: string }) => {
      setDeployment((prev) => prev ? {
        ...prev,
        previewScreenshotUrl: event.previewScreenshotUrl ?? prev.previewScreenshotUrl,
        previewScreenshotCapturedAt: event.previewScreenshotCapturedAt ?? prev.previewScreenshotCapturedAt,
      } : prev);
    });

    return () => {
      socket.emit('deployment:unsubscribe', id);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [deployment?.status, id]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // Detect manual scroll up = disable autoscroll
  const handleScroll = () => {
    const el = logsContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setAutoScroll(atBottom);
  };

  const handleCancel = async () => {
    await deploymentsApi.cancel(id);
    setDeployment((prev) => prev ? { ...prev, status: 'CANCELLED' } : prev);
  };

  const status = deployment?.status ?? 'QUEUED';
  const statusCfg = STATUS_CONFIG[status] ?? { label: status, color: 'text-zinc-400', bg: 'bg-zinc-400/10', icon: <Activity size={14} /> };
  const isActive = ACTIVE_STATUSES.includes(status);
  const previewImageUrl = deployment?.previewScreenshotUrl;
  const hasPreviewImage = Boolean(previewImageUrl) && !previewImageFailed;
  const previewImageSrc = previewImageUrl ?? '';

  if (isLoading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loading size={28} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Navbar */}
      <nav className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10 flex-shrink-0">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/dashboard" className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary text-primary-foreground">
            <Zap size={14} strokeWidth={2.5} />
          </Link>
          <span className="text-muted-foreground">/</span>
          <Link href={`/projects/${deployment?.projectId}`} className="text-sm hover:text-foreground text-muted-foreground transition">
            Project
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-mono text-sm">{id.slice(0, 8)}…</span>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-6 flex-1 flex flex-col gap-5 w-full">
        {/* Back */}
        <Link href={`/projects/${deployment?.projectId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition">
          <ArrowLeft size={14} /> Back to project
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${statusCfg.bg} ${statusCfg.color}`}>
                {statusCfg.icon}
                {statusCfg.label}
              </span>
              {isConnected && isActive && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  Live
                </span>
              )}
            </div>
            <PipelineProgress status={status} />
          </div>

          {isActive && (
            <button onClick={handleCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50 transition">
              <StopCircle size={14} /> Cancel
            </button>
          )}
        </div>

        {/* Metadata */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Commit', value: deployment?.commitSha ? deployment.commitSha.slice(0, 7) : '—', mono: true },
            { label: 'Message', value: deployment?.commitMessage ?? 'Manual deployment' },
            { label: 'Duration', value: deployment?.duration ? `${deployment.duration}s` : isActive ? 'Running…' : '—' },
            { label: 'Triggered', value: deployment ? formatDistanceToNow(new Date(deployment.createdAt), { addSuffix: true }) : '—' },
          ].map(({ label, value, mono }) => (
            <div key={label} className="bg-card border border-border rounded-xl px-4 py-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`text-sm font-medium mt-0.5 truncate ${mono ? 'font-mono' : ''}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Error display */}
        {deployment?.error && (
          <ErrorMessage>{deployment.error}</ErrorMessage>
        )}

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
            <h2 className="font-semibold text-sm">Deployment preview</h2>
            {deployment?.previewScreenshotCapturedAt && (
              <span className="text-xs text-muted-foreground">
                Captured {formatDistanceToNow(new Date(deployment.previewScreenshotCapturedAt), { addSuffix: true })}
              </span>
            )}
          </div>
          {hasPreviewImage ? (
            <img
              src={previewImageSrc}
              alt="Deployment preview screenshot"
              className="block w-full max-h-[560px] object-cover bg-zinc-950"
              onError={() => setPreviewImageFailed(true)}
            />
          ) : (
            <div className="px-4 py-12 text-center">
              <p className="text-sm font-medium">No preview screenshot available</p>
              <p className="text-xs text-muted-foreground mt-1">
                A preview will appear here after a successful deployment capture.
              </p>
            </div>
          )}
        </div>

        {/* Terminal Log Viewer */}
        <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden flex flex-col min-h-[400px]">
          {/* Terminal header */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-900 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/80" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                <div className="w-3 h-3 rounded-full bg-green-500/80" />
              </div>
              <Terminal size={13} className="text-zinc-500 ml-2" />
              <span className="text-xs text-zinc-500 font-mono">deployment logs</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-600 font-mono">{logs.length} lines</span>
              {!autoScroll && (
                <button
                  onClick={() => { setAutoScroll(true); logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
                  className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700">
                  <ChevronDown size={12} /> Scroll to bottom
                </button>
              )}
            </div>
          </div>

          {/* Log lines */}
          <div
            ref={logsContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed space-y-0.5"
          >
            {logs.length === 0 ? (
              <div className="flex items-center gap-2 text-zinc-600">
                <Loading size={12} className="text-zinc-600" />
                <span>Waiting for pipeline to start…</span>
              </div>
            ) : (
              logs.map((log, i) => (
                <div key={log.id ?? i} className="flex gap-3 group">
                  <span className="text-zinc-600 flex-shrink-0 select-none w-16">
                    {format(new Date(log.timestamp), 'HH:mm:ss')}
                  </span>
                  <span className={LOG_COLORS[log.level] ?? 'text-zinc-300'}>
                    {log.message}
                  </span>
                </div>
              ))
            )}
            {isActive && (
              <div className="flex items-center gap-2 text-zinc-600 pt-1">
                <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse" />
              </div>
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      </main>
    </div>
  );
}
