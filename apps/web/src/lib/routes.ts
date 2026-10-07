import { websiteConfig } from './config/website'

export const API_ROUTE_CHAT = '/api/chat'
export const API_ROUTE_CREATE_CHAT = '/api/create-chat'

/**
 * The routes for the application
 */
export enum Routes {
  Root = '/',
  Workflows = '/workflows',
  Skills = '/skills',
  SkillSubmit = '/skills/submit',
  Personas = '/personas',
  A2A = '/a2a',
  A2ASubmit = '/a2a/submit',
  MCP = '/mcp',
  McpSubmit = '/mcp/submit',
  OpenPay = '/openpay',
  Clawsourcing = '/clawsourcing',
  Start = '/start',

  // marketing pages
  FAQ = '/#faq',
  Features = '/#features',
  Pricing = '/pricing',
  Rankings = '/ranking',
  Categories = '/categories',
  Authors = '/authors',
  Blog = '/blog',
  Chat = 'https://chat.openroute.cn',
  Docs = '/docs',
  About = '/about',
  Contact = '/contact',
  Waitlist = '/waitlist',
  Changelog = '/changelog',
  Roadmap = '/blog/roadmap',
  CookiePolicy = '/cookie',
  PrivacyPolicy = '/privacy',
  TermsOfService = '/terms',

  // auth routes
  Login = '/sign-in',
  Register = '/sign-up',
  AuthError = '/auth/error',
  ForgotPassword = '/forgot-password',
  ResetPassword = '/reset-password',

  // dashboard routes
  Dashboard = '/dashboard',
  AdminUsers = '/admin/users',
  AdminRechargeOrders = '/admin/recharge-orders',
  AdminBankTransfers = '/admin/payments/bank-transfers',
  AdminNewsletterSubscriptions = '/admin/newsletter-subscriptions',
  AdminSessions = '/admin/sessions',
  AdminWorkflows = '/admin/workflows',
  AdminAuthors = '/admin/authors',
  AdminCategories = '/admin/categories',
  AdminUserSubmissions = '/admin/user-submissions',
  AdminProviderApplications = '/admin/providers',
  AdminProviderPayouts = '/admin/provider-payouts',
  AdminA2aAgents = '/admin/a2a-agents',
  AdminMcpServers = '/admin/mcp-servers',
  AdminSecurityReview = '/admin/security-review',
  AdminSecurityReviewRejected = '/admin/security-review/rejected',
  AdminSecurityReviewHistory = '/admin/security-review/history',
  ApiKeys = '/dashboard/apikeys',
  MyWorkflows = '/dashboard/workflows',
  MyFavorites = '/dashboard/favorites',
  MyInstalls = '/dashboard/installs',
  MyRelations = '/dashboard/relations',
  MyAssetsMCP = '/dashboard/assets/mcp',
  MyAssetsA2A = '/dashboard/assets/a2a',
  MyAssetsSkills = '/dashboard/assets/skills',
  DashboardUsage = '/dashboard/usage',
  DashboardMonthlyBilling = '/dashboard/billing/monthly',
  DashboardEarnings = '/dashboard/earnings',

  /** Public landing page, intentionally outside `userConsoleRoutes`. */
  UserGuide = '/guide',

  SettingsOverview = '/settings',
  SettingsSetup = '/settings/setup',
  SettingsProfile = '/settings/profile',
  SettingsRecharge = '/settings/recharge',
  SettingsRechargeHistory = '/settings/recharge/history',
  SettingsNotifications = '/settings/notifications',
  SettingsBills = '/settings/bills',
  SettingsIncome = '/settings/income',
  SettingsOrganization = '/settings/organization',
  SettingsInvoice = '/settings/invoice',
  ProviderOnboarding = '/provider/onboarding',
  ProviderOnboardingIndividual = '/provider/onboarding/individual',
  ProviderOnboardingCompany = '/provider/onboarding/company',
  ProviderPayout = '/provider/payout',

  CMSDocs = '/admin/docs',
  CMSBlog = '/admin/blog/posts',
  CMSBlogCategories = '/admin/blog/categories',
  CMSBlogAuthors = '/admin/blog/authors',

  // AI routes
  AIText = '/ai/text',
  AIImage = '/ai/image',
  AIVideo = '/ai/video',
  AIAudio = '/ai/audio',

  Home = '/home',
}

/** Routes that a signed-in user must not visit. */
export const routesNotAllowedByLoggedInUsers = [Routes.Login, Routes.Register]

/**
 * Admin console routes.
 *
 * Kept separate from `userConsoleRoutes` because the two consoles have
 * different gates: a session for the user console, and the `admin` role on top
 * of it for this list. Merging them into one array is what previously let a
 * signed-in non-admin reach `/admin/*` and see a console whose every query
 * 401'd.
 *
 * Membership here is not authorization. `adminProcedure` re-checks the role on
 * every procedure, and the `/admin` layout redirects non-admins to the
 * dashboard, so this list exists for routing and navigation, not for trust.
 */
export const adminRoutes = [
  Routes.AdminUsers,
  Routes.AdminSessions,
  Routes.AdminRechargeOrders,
  Routes.AdminBankTransfers,
  Routes.AdminWorkflows,
  Routes.AdminAuthors,
  Routes.AdminCategories,
  Routes.AdminNewsletterSubscriptions,
  Routes.AdminUserSubmissions,
  Routes.AdminProviderApplications,
  Routes.AdminProviderPayouts,
  Routes.AdminA2aAgents,
  Routes.AdminMcpServers,
  Routes.AdminSecurityReview,
  Routes.AdminSecurityReviewRejected,
  Routes.AdminSecurityReviewHistory,
  Routes.CMSBlog,
  Routes.CMSBlogCategories,
  Routes.CMSBlogAuthors,
]

/** End-user console routes: a session is all these require. */
export const userConsoleRoutes = [
  Routes.Dashboard,
  Routes.ApiKeys,
  Routes.SettingsOverview,
  Routes.SettingsSetup,
  Routes.SettingsProfile,
  Routes.SettingsRecharge,
  Routes.SettingsRechargeHistory,
  Routes.SettingsNotifications,
  Routes.SettingsBills,
  Routes.SettingsIncome,
  Routes.SettingsOrganization,
  Routes.SettingsInvoice,
  Routes.DashboardUsage,
  Routes.DashboardMonthlyBilling,
  Routes.DashboardEarnings,
  Routes.MyFavorites,
  Routes.MyInstalls,
  Routes.MyRelations,
  Routes.MyAssetsMCP,
  Routes.MyAssetsA2A,
  Routes.MyAssetsSkills,
]

/** Routes that require a session: the user console plus the admin console. */
export const protectedRoutes = [...userConsoleRoutes, ...adminRoutes]

/** True when `pathname` is, or lives under, any of `routes`. */
export function matchesRoute(pathname: string, routes: readonly string[]): boolean {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}

/** Where to send the user after signing in. */
export const DEFAULT_LOGIN_REDIRECT =
  websiteConfig.routes.defaultLoginRedirect ?? Routes.Dashboard
