"use client"

import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { Button } from "@workspace/ui/components/button"

export function SignOutButton() {
  const router = useRouter()

  return (
    <Button
      variant="outline"
      onClick={async () => {
        await authClient.signOut({
          fetchOptions: {
            onSuccess: () => {
              router.push("/sign-in")
              router.refresh()
            },
          },
        })
      }}
    >
      Sign Out
    </Button>
  )
}
