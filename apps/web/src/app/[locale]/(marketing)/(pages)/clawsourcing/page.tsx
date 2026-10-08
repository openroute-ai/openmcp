import type { Metadata } from "next"
import { ClawsourcingHero } from "./components/clawsourcing-hero"
import { ClawsourcingRoles } from "./components/clawsourcing-roles"
import { ClawsourcingProcess } from "./components/clawsourcing-process"
import { ClawsourcingPricing } from "./components/clawsourcing-pricing"
import { ClawsourcingSecurity } from "./components/clawsourcing-security"
import { ClawsourcingCta } from "./components/clawsourcing-cta"
import { ClawsourcingQa } from "./components/clawsourcing-qa"

export const metadata: Metadata = {
  title: "Clawsourcing - OpenClaw定制服务 | OpenMCP Hub",
  description:
    "全托管的 AI 员工定制服务。端到端定制、持续优化、跨客户学习。￥2,000 一次性设置 + ￥500/月维护。",
}

export default function ClawsourcingPage() {
  return (
    <main className="flex-1">
      <ClawsourcingHero />
      <ClawsourcingRoles />
      <ClawsourcingProcess />
      <ClawsourcingPricing />
      <ClawsourcingSecurity />

      <ClawsourcingCta />

      <ClawsourcingQa />
    </main>
  )
}
