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
  Welcome = '/auth/welcome',

  // dashboard routes
  Dashboard = '/dashboard',
  AdminUsers = '/admin/users',
  AdminRechargeOrders = '/admin/recharge-orders',
  AdminBankTransfers = '/admin/payments/bank-transfers',
  AdminNewsletterSubscriptions = '/admin/newsletter-subscriptions',
  AdminPayments = '/admin/payments',
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
  MyDownloads = '/dashboard/downloads',
  MyInstalls = '/dashboard/installs',
  MyRelations = '/dashboard/relations',
  MyAssetsMCP = '/dashboard/assets/mcp',
  MyAssetsA2A = '/dashboard/assets/a2a',
  MyAssetsSkills = '/dashboard/assets/skills',
  DashboardUsage = '/dashboard/usage',
  DashboardMonthlyBilling = '/dashboard/billing/monthly',
  DashboardEarnings = '/dashboard/earnings',
  UserGuide = '/guide',

  SettingsOverview = '/settings',
  SettingsProfile = '/settings/profile',
  SettingsBilling = '/settings/billing',
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

/** Routes that require a session. */
export const protectedRoutes = [
  Routes.Dashboard,
  Routes.AdminUsers,
  Routes.ApiKeys,
  Routes.SettingsOverview,
  Routes.SettingsProfile,
  Routes.SettingsBilling,
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
  Routes.MyDownloads,
  Routes.MyInstalls,
  Routes.AdminRechargeOrders,
  Routes.AdminBankTransfers,
  Routes.AdminSessions,
  Routes.AdminWorkflows,
  Routes.AdminAuthors,
  Routes.AdminCategories,
  Routes.CMSBlog,
  Routes.CMSBlogCategories,
  Routes.CMSBlogAuthors,
  Routes.AdminNewsletterSubscriptions,
  Routes.AdminPayments,
  Routes.AdminUserSubmissions,
  Routes.AdminProviderApplications,
  Routes.AdminProviderPayouts,
  Routes.AdminA2aAgents,
  Routes.AdminMcpServers,
  Routes.AdminSecurityReview,
  Routes.AdminSecurityReviewRejected,
  Routes.AdminSecurityReviewHistory,
  Routes.MyRelations,
  Routes.MyAssetsMCP,
  Routes.MyAssetsA2A,
  Routes.MyAssetsSkills,
  Routes.UserGuide,
]

/** Where to send the user after signing in. */
export const DEFAULT_LOGIN_REDIRECT =
  websiteConfig.routes.defaultLoginRedirect ?? Routes.Dashboard
