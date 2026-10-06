/**
 * Harbor Registry REST API client.
 *
 * Wraps Harbor v2.0 API for user/project/robot-account management.
 * Uses HTTP Basic Auth with admin credentials.
 */

const HARBOR_API_TIMEOUT = 30_000

export const HARBOR_HOST = "registry.gongji.cloud"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HarborUser {
  user_id: number
  username: string
  email: string
  realname: string
  admin_role_in_auth: number
  creation_time: string
}

export interface HarborProject {
  project_id: number
  name: string
  public: boolean
  creation_time: string
}

export interface HarborRobot {
  id: number
  name: string
  description: string
  creation_time: string
  expires_at: number
  secret: string
}

// ---------------------------------------------------------------------------
// Password generation
// ---------------------------------------------------------------------------

/**
 * Generate a password meeting Harbor complexity requirements:
 * - At least 8 chars
 * - At least 1 uppercase letter
 * - At least 1 lowercase letter
 * - At least 1 digit
 *
 * Format: `Gpu` + 3 random uppercase + 3 random digits + 2 random lowercase
 * = 11 chars total.
 */
export function generateHarborPassword(): string {
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
  const digits = "0123456789"
  const lowercase = "abcdefghijklmnopqrstuvwxyz"

  const rand = (chars: string, count: number) => {
    let result = ""
    for (let i = 0; i < count; i++) {
      result += chars[Math.floor(Math.random() * chars.length)]
    }
    return result
  }

  return `Gpu${rand(uppercase, 3)}${rand(digits, 3)}${rand(lowercase, 2)}`
}

// ---------------------------------------------------------------------------
// HarborClient
// ---------------------------------------------------------------------------

export class HarborClient {
  private baseUrl: string
  private authHeader: string

  constructor(baseUrl: string, adminUsername: string, adminPassword: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "")
    const credentials = Buffer.from(`${adminUsername}:${adminPassword}`).toString("base64")
    this.authHeader = `Basic ${credentials}`
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HARBOR_API_TIMEOUT)

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          Authorization: this.authHeader,
          ...options.headers,
        },
      })

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new Error(`Harbor API ${res.status} ${res.statusText}: ${body}`)
      }

      // 204 No Content — return undefined cast
      if (res.status === 204) {
        return undefined as T
      }

      return res.json() as Promise<T>
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Create a new Harbor user.
   * POST /api/v2.0/users
   */
  async createUser(
    username: string,
    password: string,
    email: string,
    realname?: string,
  ): Promise<HarborUser> {
    return this.request<HarborUser>("/api/v2.0/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        email,
        realname: realname ?? username,
      }),
    })
  }

  /**
   * Reset a user's password (admin can omit old_password).
   * PUT /api/v2.0/users/{username}/password
   */
  async resetUserPassword(
    username: string,
    newPassword: string,
  ): Promise<void> {
    await this.request(`/api/v2.0/users/${encodeURIComponent(username)}/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_password: newPassword }),
    })
  }

  /**
   * Create a new Harbor project.
   * POST /api/v2.0/projects
   */
  async createProject(projectName: string): Promise<HarborProject> {
    return this.request<HarborProject>("/api/v2.0/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_name: projectName,
        public: false,
      }),
    })
  }

  /**
   * Add a member to a project.
   * POST /api/v2.0/projects/{name}/members
   *
   * roleId: 1=Admin, 2=Developer, 3=Guest
   */
  async addProjectMember(
    projectName: string,
    username: string,
    roleId: number,
  ): Promise<void> {
    await this.request(
      `/api/v2.0/projects/${encodeURIComponent(projectName)}/members`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role_id: roleId,
          member_user: { username },
        }),
      },
    )
  }

  /**
   * Check if a user exists by username.
   * GET /api/v2.0/users/search?username={name}
   */
  async userExists(username: string): Promise<boolean> {
    const users = await this.request<HarborUser[]>(
      `/api/v2.0/users/search?username=${encodeURIComponent(username)}`,
    )
    return users.some((u) => u.username === username)
  }

  /**
   * Create a robot account under a project.
   * POST /api/v2.0/robots
   */
  async createRobotAccount(
    name: string,
    projectName: string,
    description?: string,
  ): Promise<HarborRobot> {
    return this.request<HarborRobot>("/api/v2.0/robots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description: description ?? `Robot account for ${projectName}`,
        duration: -1, // no expiration
        level: "project",
        permissions: [
          {
            namespace: projectName,
            kind: "project",
            access: [
              { resource: "repository", action: "pull" },
              { resource: "repository", action: "push" },
              { resource: "artifact", action: "read" },
              { resource: "artifact", action: "list" },
              { resource: "tag", action: "list" },
            ],
          },
        ],
      }),
    })
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let clientInstance: HarborClient | null = null

/**
 * Get or create the singleton HarborClient.
 * Reads from env: HARBOR_URL, HARBOR_ADMIN_USERNAME, HARBOR_ADMIN_PASSWORD.
 */
export function getHarborClient(): HarborClient {
  if (clientInstance) return clientInstance

  const url = process.env.HARBOR_URL
  const username = process.env.HARBOR_ADMIN_USERNAME
  const password = process.env.HARBOR_ADMIN_PASSWORD

  if (!url || !username || !password) {
    throw new Error(
      "Missing Harbor env vars: HARBOR_URL, HARBOR_ADMIN_USERNAME, HARBOR_ADMIN_PASSWORD",
    )
  }

  clientInstance = new HarborClient(url, username, password)
  return clientInstance
}
