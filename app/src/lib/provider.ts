// Hosting provider abstraction. GitHub is the only implementation today; GitLab, Codeberg and
// others can be added by implementing this interface.

export interface ProviderUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  id: number;
}

export interface RepoSummary {
  fullName: string;
  name: string;
  owner: string;
  private: boolean;
  description: string | null;
  updatedAt: string;
  isRelevance: boolean;
  defaultBranch: string;
  htmlUrl: string;
}

export interface FileChange {
  path: string;
  /** string = utf8 text, Uint8Array = binary, null = delete */
  content: string | Uint8Array | null;
}

export interface WorkflowRun {
  id: number;
  name: string;
  displayTitle: string;
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'timed_out' | 'neutral' | null;
  createdAt: string;
  updatedAt: string;
  runStartedAt?: string;
  htmlUrl: string;
  workflowPath: string;
  event: string;
  /** app id parsed from the run title, if a build */
  appId?: string;
  kind: 'build' | 'publish' | 'updates' | 'other';
}

export interface JobStep {
  name: string;
  id?: string;
  status: 'queued' | 'in_progress' | 'completed' | 'pending';
  conclusion: string | null;
  number: number;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface Job {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  steps: JobStep[];
  htmlUrl: string;
}

export interface Release {
  id: number;
  tag: string;
  uploadUrl: string;
  assets: { id: number; name: string; size: number; url: string }[];
}

export interface HostingProvider {
  readonly id: 'github';
  readonly label: string;
  me(): Promise<ProviderUser>;
  scopes(): string[];
  listRepos(): Promise<RepoSummary[]>;
  createRepo(name: string, isPrivate: boolean): Promise<RepoSummary>;
  getRepo(fullName: string): Promise<RepoSummary>;
  markRelevance(fullName: string): Promise<void>;
  setVisibility(fullName: string, isPrivate: boolean): Promise<void>;

  readText(repo: string, path: string): Promise<{ text: string; sha: string } | null>;
  listDir(repo: string, path: string): Promise<{ name: string; path: string; sha: string; type: string }[]>;
  rawUrl(repo: string, path: string): string;
  readBlobUrl(repo: string, path: string): Promise<string | null>;
  commit(repo: string, files: FileChange[], message: string): Promise<string>;

  setSecret(repo: string, name: string, value: string): Promise<void>;
  listSecrets(repo: string): Promise<string[]>;
  enablePages(repo: string): Promise<string | null>;
  pagesUrl(repo: string): Promise<string | null>;

  dispatch(repo: string, workflow: string, inputs: Record<string, string>): Promise<void>;
  listRuns(repo: string, opts?: { perPage?: number; workflow?: string; status?: string }): Promise<WorkflowRun[]>;
  getRun(repo: string, id: number): Promise<WorkflowRun>;
  getJobs(repo: string, runId: number): Promise<Job[]>;
  cancelRun(repo: string, id: number): Promise<void>;
  jobLog(repo: string, jobId: number): Promise<string>;
  latestPagesArtifact(repo: string): Promise<{ id: number; size: number; createdAt: string } | null>;

  createRelease(repo: string, tag: string, name: string, body: string): Promise<Release>;
  uploadAsset(repo: string, releaseId: number, name: string, data: Blob, onProgress?: (p: number) => void): Promise<{ url: string; size: number }>;
}
