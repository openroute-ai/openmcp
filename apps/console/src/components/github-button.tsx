"use client"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { IconBrandGithub } from "@tabler/icons-react"
import { authClient } from "@/lib/auth-client"
import { Button } from "@workspace/ui/components/button"

export function GitHubButton() {
  const router = useRouter()

  async function handleClick() {
    try {
      await authClient.signIn.social({
        provider: "github",
        callbackURL: "/dashboard",
      })
    } catch {
      toast.error("GitHub 登录失败")
    }
    router.refresh()
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="flex w-full cursor-pointer items-center justify-center gap-2"
      onClick={handleClick}
    >
      <IconBrandGithub className="size-4" />
      <span>使用 GitHub 登录</span>
    </Button>
  )
}

export function AuthDivider() {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="bg-background px-2 text-muted-foreground">or</span>
      </div>
    </div>
  )
}