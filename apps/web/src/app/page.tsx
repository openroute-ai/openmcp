import { auth } from "@/lib/auth"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { SignOutButton } from "@/components/sign-out-button"

export default async function Page() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    redirect("/sign-in")
  }

  return (
    <div className="flex min-h-svh p-6">
      <div className="flex max-w-md min-w-0 flex-col gap-4 text-sm leading-loose">
        <div>
          <h1 className="font-medium">Welcome, {session.user.name}</h1>
          <p className="text-muted-foreground">{session.user.email}</p>
        </div>
        <SignOutButton />
      </div>
    </div>
  )
}
