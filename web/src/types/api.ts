// Auth
export interface RegisterRequest {
  userId: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface RegisterResponse {
  success: boolean;
  user: {
    user_id: string;
    email: string | null;
    display_name: string;
    avatar_url: string | null;
  };
}

// Projects
export interface GenerateRequest {
  prompt: string;
  userId: string;
  userName?: string;
  framework?: string;
  referenceImage?: string;
  deviceToken?: string;
}

export interface SaveProjectRequest {
  title: string;
  description?: string;
  bundle: string;
  creatorId: string;
  creatorName: string;
  initialPrompt: string;
  isPublic?: boolean;
}

export interface SaveProjectResponse {
  success: boolean;
  projectId: string;
  githubRepo?: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  description: string | null;
  creator_id?: string;
  creator_name: string;
  project_type: string;
  play_count: number;
  fork_count: number;
  created_at: string;
  updated_at?: string;
  is_public: boolean;
  published_url: string | null;
  thumbnail_url?: string | null;
}

export interface BrowseResponse {
  success: boolean;
  projects: ProjectSummary[];
  totalCount: number;
  hasMore: boolean;
}

export interface MyProjectsResponse {
  success: boolean;
  projects: ProjectSummary[];
  totalCount: number;
  hasMore: boolean;
}

export interface ProjectDetail {
  id: string;
  title: string;
  description: string | null;
  bundle: string | null;
  githubRepo: string | null;
  creatorId: string;
  creatorName: string;
  projectType: string;
  playCount: number;
  forkCount: number;
  createdAt: string;
  updatedAt: string;
  isPublic: boolean;
  publishedUrl: string | null;
  freeTweaksRemaining: number;
  initialPrompt: string | null;
}

export interface ProjectDetailResponse {
  success: boolean;
  project: ProjectDetail;
}

export interface TweakRequest {
  userId: string;
  tweakDescription: string;
}

export interface ForkRequest {
  userId: string;
  userName?: string;
  newTitle?: string;
}

export interface ForkResponse {
  success: boolean;
  projectId: string;
  title: string;
  tier: string;
}

// Versions
export interface ProjectVersion {
  sha: string;
  message: string;
  date: string;
  author: string;
}

export interface VersionsResponse {
  success: boolean;
  versions: ProjectVersion[];
  hasRepo: boolean;
}

export interface RevertResponse {
  success: boolean;
  commitSha: string;
  bundle: string;
  bundleSize: number;
}

// Deploy
export interface DeployRequest {
  userId: string;
  subdomain: string;
}

export interface DeployResponse {
  success: boolean;
  url: string;
}

export interface DeploymentInfoResponse {
  success: boolean;
  deployed: boolean;
  subdomain?: string;
  url?: string;
  deployedAt?: string;
}

// Subscriptions
export interface SubscriptionStatus {
  success: boolean;
  tier: string;
  status: string;
  expiresAt: string | null;
  platform: string | null;
  limits: {
    dailyGenerations: number | string;
    tweaksPerProject: number | string;
    privateProjects: boolean;
    priorityQueue: boolean;
  };
}

export interface SubscriptionPlan {
  tier: string;
  name: string;
  price: string;
  features: {
    dailyGenerations: number | string;
    tweaksPerProject: number | string;
    privateProjects: boolean;
    priorityQueue: boolean;
    collaboration: boolean;
  };
}

export interface PlansResponse {
  success: boolean;
  plans: SubscriptionPlan[];
}

// Suggestions
export interface Suggestion {
  label: string;
  prompt: string;
}

export interface SuggestionsResponse {
  success: boolean;
  suggestions: Suggestion[];
}

// Domains
export interface AddDomainResponse {
  success: boolean;
  domain: string;
  status: string;
  cnameTarget: string;
  verificationToken: string;
}

export interface DomainStatusResponse {
  success: boolean;
  hasDomain: boolean;
  domain: string | null;
  status: string | null;
  cnameTarget: string | null;
  txtRecord: string | null;
  txtValue: string | null;
  sslCertificateId: string | null;
  lastCheckedAt: string | null;
  createdAt: string | null;
}

export interface VerifyDomainResponse {
  success: boolean;
  status: string;
  message: string;
}

// Error
export interface ApiError {
  error: string;
  used?: number;
  limit?: number;
  remaining?: number;
  requiresTier?: string;
  currentTier?: string;
}
