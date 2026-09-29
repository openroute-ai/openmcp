export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-primary/5 p-6">
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}
