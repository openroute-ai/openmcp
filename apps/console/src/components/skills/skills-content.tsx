"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { useTRPC } from "@/lib/trpc/client"
import { formatRelative } from "@/lib/format"

type SkillStatus = "all" | "pending" | "synced" | "error"

export function SkillsContent() {
  const trpc = useTRPC()
  const [status, setStatus] = React.useState<SkillStatus>("all")

  const { data: skills = [], isPending } = useQuery(
    trpc.skills.list.queryOptions({ status, limit: 200 })
  )

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid gap-1">
            <CardTitle>Skills</CardTitle>
            <CardDescription>
              SKILL.md documents synced from repositories, with their
              translation and push state
            </CardDescription>
          </div>
          <Tabs
            value={status}
            onValueChange={(value) => setStatus(value as SkillStatus)}
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="pending">Pending</TabsTrigger>
              <TabsTrigger value="synced">Synced</TabsTrigger>
              <TabsTrigger value="error">Errors</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : skills.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No skills in this view.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Skill</TableHead>
                <TableHead>Translated</TableHead>
                <TableHead>Synced to web</TableHead>
                <TableHead>Last attempt</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skills.map((skill) => (
                <TableRow key={skill.id}>
                  <TableCell>
                    <div className="font-medium">{skill.projectName}</div>
                    <div className="text-xs text-muted-foreground">
                      {skill.projectOwner}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{skill.name}</div>
                    <code className="text-xs text-muted-foreground">
                      {skill.skillDir}
                    </code>
                  </TableCell>
                  <TableCell>
                    {skill.descriptionZh ? (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        yes
                      </span>
                    ) : (
                      <span className="text-muted-foreground">no</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {skill.syncedToWebAt
                      ? formatRelative(skill.syncedToWebAt)
                      : "never"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {skill.lastSyncAttemptAt
                      ? formatRelative(skill.lastSyncAttemptAt)
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {skill.lastSyncError ? (
                      <span
                        className="block max-w-60 truncate text-xs text-destructive"
                        title={skill.lastSyncError}
                      >
                        {skill.lastSyncError}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
