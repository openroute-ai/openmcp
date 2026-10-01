"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { IconGitCompare, IconPlus, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Textarea } from "@workspace/ui/components/textarea"
import { LocaleLink } from "@/i18n/navigation"
import { useTRPC } from "@/lib/trpc/client"
import type { VitalSnapshot } from "@/lib/radar/vitals"

/**
 * The decision workbench.
 *
 * The whole of §5.5's "报告中心 → 决策留痕", minus the parts §10 cut: there is no
 * five-step wizard, no report centre, and nothing here generates anything. What
 * is left is the part that cannot be reconstructed later — the vitals each
 * candidate had **at the moment it was added**, stored as a copy.
 *
 * That copy is why the readings in each row are rendered as fixed text rather
 * than as anything live. Recomputing them on render would make a six-month-old
 * board describe today, and the question this tool exists to answer is the one
 * that depends on the difference.
 *
 * The verdict and the board's `outcome` are deliberately separate fields. The
 * verdict is what each candidate was called while comparing; the outcome is what
 * was concluded. They are allowed to disagree, and when they do the disagreement
 * is the interesting part — a board where the "chosen" row and the recorded
 * outcome differ is a board where something was learned.
 */

const VERDICTS = ["pending", "shortlisted", "chosen", "rejected"] as const

type Verdict = (typeof VERDICTS)[number]

/** How long typing pauses before the candidate search is sent. */
const SEARCH_DEBOUNCE_MS = 300

export function DecisionWorkbench() {
  const t = useTranslations("Decisions")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const boards = useQuery(trpc.decisions.list.queryOptions())

  const create = useMutation(
    trpc.decisions.create.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.decisions.list.queryKey(),
        })
      },
    })
  )

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconGitCompare className="size-4" />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateBoardForm
            pending={create.isPending}
            onSubmit={(title, summary) => create.mutate({ title, summary })}
          />
        </CardContent>
      </Card>

      {boards.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : boards.data && boards.data.length > 0 ? (
        <div className="grid gap-6">
          {boards.data.map((board) => (
            <BoardPanel key={board.id} boardId={board.id} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {t("empty")}
        </p>
      )}
    </div>
  )
}

function CreateBoardForm({
  onSubmit,
  pending,
}: {
  onSubmit: (title: string, summary: string | null) => void
  pending: boolean
}) {
  const t = useTranslations("Decisions")
  const [title, setTitle] = React.useState("")
  const [summary, setSummary] = React.useState("")

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (title.trim().length === 0) return
        onSubmit(title.trim(), summary.trim() || null)
        setTitle("")
        setSummary("")
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">{t("createTitle")}</span>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">{t("createSummary")}</span>
          <Input
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            maxLength={4_000}
          />
        </label>
      </div>
      <Button
        type="submit"
        size="sm"
        disabled={pending || title.trim().length === 0}
      >
        <IconPlus className="size-4" />
        {t("create")}
      </Button>
    </form>
  )
}

function BoardPanel({ boardId }: { boardId: string }) {
  const t = useTranslations("Decisions")
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [outcome, setOutcome] = React.useState("")

  const board = useQuery(trpc.decisions.read.queryOptions({ boardId }))

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.decisions.read.queryKey({ boardId }),
    })

  const addCandidate = useMutation(
    trpc.decisions.addCandidate.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: (error) => toast.error(error.message),
    })
  )

  const updateCandidate = useMutation(
    trpc.decisions.updateCandidate.mutationOptions({
      onSuccess: () => void invalidate(),
    })
  )

  const removeCandidate = useMutation(
    trpc.decisions.removeCandidate.mutationOptions({
      onSuccess: () => void invalidate(),
    })
  )

  const decide = useMutation(
    trpc.decisions.decide.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: (error) => toast.error(error.message),
    })
  )

  if (board.isPending) {
    return <Skeleton className="h-40 w-full" />
  }
  if (!board.data) return null

  const { board: row, candidates, maxCandidates } = board.data
  const full = candidates.length >= maxCandidates

  return (
    <Card>
      <CardHeader>
        <CardTitle>{row.title}</CardTitle>
        <CardDescription>
          {row.summary ?? ""} · {t(`status.${row.status}`)}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {candidates.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            {t("emptyBoard")}
          </p>
        ) : (
          <div className="grid gap-3">
            {candidates.map((candidate) => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                onVerdict={(verdict) =>
                  updateCandidate.mutate({ candidateId: candidate.id, verdict })
                }
                onNote={(note) =>
                  updateCandidate.mutate({ candidateId: candidate.id, note })
                }
                onRemove={() =>
                  removeCandidate.mutate({ candidateId: candidate.id })
                }
              />
            ))}
          </div>
        )}

        <CandidatePicker
          disabled={full}
          hint={full ? t("full", { max: maxCandidates }) : t("addHint")}
          pending={addCandidate.isPending}
          onPick={(repoId) => addCandidate.mutate({ boardId, repoId })}
        />

        <form
          className="grid gap-2 border-t border-border pt-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (outcome.trim().length === 0) return
            decide.mutate({ boardId, outcome: outcome.trim() })
            setOutcome("")
          }}
        >
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">{t("outcome")}</span>
            <Textarea
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
              placeholder={t("outcomePlaceholder")}
              maxLength={4_000}
              rows={2}
            />
          </label>
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              size="sm"
              disabled={decide.isPending || outcome.trim().length === 0}
            >
              {t("decide")}
            </Button>
            {row.decidedAt ? (
              <span className="text-xs text-muted-foreground">
                {t("decidedAt")}{" "}
                {new Date(row.decidedAt).toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })}
              </span>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

/**
 * The frozen readings of one candidate.
 *
 * Static text, never recomputed. See this file's header: the whole point is that
 * these numbers describe the moment the repository was added to the board.
 */
function FrozenVitals({ snapshot }: { snapshot: VitalSnapshot | null }) {
  const t = useTranslations("Decisions")

  if (!snapshot) {
    return <p className="text-xs text-muted-foreground">—</p>
  }

  const readings: [string, string][] = [
    [
      t("readings.starsThisWeek"),
      snapshot.starsThisWeek === undefined
        ? "—"
        : snapshot.starsThisWeek.toLocaleString("en-US"),
    ],
    [
      t("readings.starFactor"),
      snapshot.starFactor === undefined
        ? "—"
        : `${snapshot.starFactor.toFixed(1)}x`,
    ],
    [
      t("readings.daysSincePush"),
      snapshot.daysSincePush === undefined ? "—" : `${snapshot.daysSincePush}`,
    ],
    [
      t("readings.daysSinceRelease"),
      snapshot.daysSinceRelease === undefined
        ? "—"
        : `${snapshot.daysSinceRelease}`,
    ],
    [t("readings.license"), snapshot.license ?? "—"],
  ]

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-5">
      {readings.map(([label, value]) => (
        <div key={label} className="grid gap-0.5">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-xs font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function CandidateRow({
  candidate,
  onVerdict,
  onNote,
  onRemove,
}: {
  candidate: {
    id: string
    owner: string
    name: string
    verdict: Verdict
    note: string | null
    snapshot: VitalSnapshot | null
    createdAt: Date | string
  }
  onVerdict: (verdict: Verdict) => void
  onNote: (note: string | null) => void
  onRemove: () => void
}) {
  const t = useTranslations("Decisions")
  const [note, setNote] = React.useState(candidate.note ?? "")

  return (
    <div className="grid gap-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <LocaleLink
          href={`/projects/${candidate.owner}/${candidate.name}`}
          className="text-sm font-medium hover:underline"
        >
          {candidate.owner}/{candidate.name}
        </LocaleLink>
        <span className="text-xs text-muted-foreground">
          {t("frozenAt", {
            date: new Date(candidate.createdAt).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
            }),
          })}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <NativeSelect
            size="sm"
            value={candidate.verdict}
            onChange={(event) => onVerdict(event.target.value as Verdict)}
            aria-label={t("verdict")}
          >
            {VERDICTS.map((verdict) => (
              <NativeSelectOption key={verdict} value={verdict}>
                {t(`verdict_${verdict}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
            <IconTrash className="size-4" />
            <span className="sr-only">{t("remove")}</span>
          </Button>
        </div>
      </div>

      <FrozenVitals snapshot={candidate.snapshot} />

      <Textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => {
          // Only writes on blur, and only when the text actually changed: a
          // keystroke-per-request note field would put a database write behind
          // every character of a sentence.
          if (note !== (candidate.note ?? "")) onNote(note || null)
        }}
        placeholder={t("notePlaceholder")}
        maxLength={4_000}
        rows={1}
        className="text-xs"
      />
    </div>
  )
}

function CandidatePicker({
  disabled,
  hint,
  pending,
  onPick,
}: {
  disabled: boolean
  hint: string
  pending: boolean
  onPick: (repoId: string) => void
}) {
  const t = useTranslations("Decisions")
  const trpc = useTRPC()
  const [term, setTerm] = React.useState("")
  const [search, setSearch] = React.useState("")

  React.useEffect(() => {
    const timer = setTimeout(() => setSearch(term), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term])

  const results = useQuery({
    ...trpc.decisions.searchRepos.queryOptions({ search }),
    enabled: !disabled,
  })

  return (
    <div className="grid gap-2 border-t border-border pt-4">
      <Input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder={t("addCandidate")}
        maxLength={200}
        disabled={disabled}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
      {results.data && results.data.length > 0 ? (
        <ul className="grid gap-1">
          {results.data.slice(0, 6).map((repo) => (
            <li key={repo.id}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                disabled={disabled || pending}
                onClick={() => onPick(repo.id)}
              >
                <span className="font-medium">
                  {repo.owner}/{repo.name}
                </span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {repo.stars === null
                    ? "—"
                    : repo.stars.toLocaleString("en-US")}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
