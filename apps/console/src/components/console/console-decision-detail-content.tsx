"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  IconArrowLeft,
  IconGitCompare,
  IconInfoCircle,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react"
import { LocaleLink } from "@/i18n/navigation"
import { useFormats } from "@/lib/i18n/format"
import { useTRPC } from "@/lib/trpc/client"
import { ERROR_CODES } from "@/lib/trpc/error-codes"
import type { Board, Candidate } from "@/lib/radar/decisions"
import type { VitalSnapshot } from "@/lib/radar/vitals"

/**
 * 一份工作台：候选、它们冻结的体征、以及结论。
 *
 * 整个轻量工作台里唯一不可逆的是 {@link FrozenVitals}：候选的体征在**加入那一刻**
 * 被拷贝进来，之后不再重算。理由是「30/90 天后回来看这次选型对了没有」这句话——
 * 它问的是当时什么样，而实时计算会把一份半年前的记录改写成今天，那恰好把回访唯一
 * 能回答的东西抹掉。所以这些数字在这里是固定文本，不是任何实时视图。
 *
 * 处置（verdict）与结论（outcome）刻意分开：前者是当时对每个候选的说法，后者是最后
 * 写下的判断。它们允许不一致，而不一致时的信息量比强制一致时更大——「标着已选的那行，
 * 和最后写下的结论不是同一个」正是学到东西的样子。所以写下结论不会去改任何一行的
 * 处置，页面上也不假装它会。
 */

const VERDICTS = ["pending", "shortlisted", "chosen", "rejected"] as const

type Verdict = (typeof VERDICTS)[number]

/** How long typing pauses before the candidate search is sent. */
const SEARCH_DEBOUNCE_MS = 300

export function ConsoleDecisionDetail({ boardId }: { boardId: string }) {
  const t = useTranslations("Decisions")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const board = useQuery(trpc.decisions.read.queryOptions({ boardId }))

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.decisions.read.queryKey({ boardId }),
    })

  const decide = useMutation(
    trpc.decisions.decide.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: (error) => toast.error(error.message),
    })
  )

  if (board.isPending) {
    return <Skeleton className="h-64 w-full" />
  }

  // A board is gone from under a stale link and from a mistyped id in the same
  // way, and both are the address pointing at nothing. They answer the same and
  // offer the same way back.
  if (board.isError || !board.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("notFoundTitle")}</CardTitle>
          <CardDescription>{t("notFoundDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" asChild>
            <LocaleLink href="/console/decisions">
              <IconArrowLeft />
              {t("backToBoards")}
            </LocaleLink>
          </Button>
        </CardContent>
      </Card>
    )
  }

  const { board: row, candidates, maxCandidates } = board.data

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <LocaleLink href="/console/decisions">{t("title")}</LocaleLink>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{row.title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <BoardHeader
        row={row}
        boardId={boardId}
        candidateCount={candidates.length}
        maxCandidates={maxCandidates}
      />

      <CandidateSection
        boardId={boardId}
        candidates={candidates}
        maxCandidates={maxCandidates}
      />

      <OutcomeSection
        row={row}
        pending={decide.isPending}
        onSubmit={(outcome) => decide.mutate({ boardId, outcome })}
      />
    </div>
  )
}

/**
 * The board's own metadata, plus the only thing here that changes it.
 *
 * The metadata is a description list rather than prose because its reader comes
 * back in thirty days to answer one question — "how long ago was this, and did I
 * decide it yet" — and each of these is a measurement next to a label.
 */
function BoardHeader({
  row,
  boardId,
  candidateCount,
  maxCandidates,
}: {
  row: Board
  boardId: string
  candidateCount: number
  maxCandidates: number
}) {
  const t = useTranslations("Decisions")
  const formats = useFormats()

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid min-w-0 flex-1 gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-xl">{row.title}</CardTitle>
              <Badge variant="secondary">{t(`status.${row.status}`)}</Badge>
            </div>
            {row.summary ? (
              <CardDescription>{row.summary}</CardDescription>
            ) : (
              <CardDescription>{t("noSummary")}</CardDescription>
            )}
          </div>
          <BoardEditDialog row={row} boardId={boardId} />
        </div>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("field.created")}>
            {formats.dateTime(row.createdAt)}
          </Field>
          <Field label={t("field.updated")}>
            {formats.dateTime(row.updatedAt)}
          </Field>
          <Field label={t("field.candidates")}>
            {t("candidatesCount", {
              count: candidateCount,
              max: maxCandidates,
            })}
          </Field>
          <Field label={t("field.decided")}>
            {row.decidedAt ? formats.dateTime(row.decidedAt) : t("notDecided")}
          </Field>
        </dl>
      </CardContent>
    </Card>
  )
}

/**
 * Edit the title and the context, and nothing else.
 *
 * Not the candidates and not the verdict: those are the parts of the record whose
 * history matters, and they each have their own control on the page below. A
 * general "edit board" form that reached them would be a second, blunter way to
 * change the thing this tool exists to keep.
 *
 * The dialog owns the mutation so that it can close itself. Held by the parent it
 * would have to be told whether the write landed, and the one moment that matters
 * — the click — is exactly the one where nothing visibly happens.
 */
function BoardEditDialog({ row, boardId }: { row: Board; boardId: string }) {
  const t = useTranslations("Decisions")
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)

  const update = useMutation(
    trpc.decisions.update.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: trpc.decisions.read.queryKey({ boardId }),
        })
        toast.success(t("saved"))
        setOpen(false)
      },
      onError: (error) => toast.error(error.message),
    })
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <IconPencil />
          {t("edit")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("editTitle")}</DialogTitle>
          <DialogDescription>{t("editDescription")}</DialogDescription>
        </DialogHeader>

        {/* Keyed on the id so the form starts from the row being edited in one
            pass. An effect resetting two fields would cost an extra render and
            leave the previous values on screen for a frame. */}
        <EditForm
          key={row.id}
          row={row}
          pending={update.isPending}
          onSave={(patch) => update.mutate({ boardId, ...patch })}
        />
      </DialogContent>
    </Dialog>
  )
}

function EditForm({
  row,
  pending,
  onSave,
}: {
  row: Board
  pending: boolean
  onSave: (patch: { title?: string; summary?: string | null }) => void
}) {
  const t = useTranslations("Decisions")
  const [title, setTitle] = React.useState(row.title)
  const [summary, setSummary] = React.useState(row.summary ?? "")

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (title.trim().length === 0 || pending) return
        onSave({ title: title.trim(), summary: summary.trim() || null })
      }}
    >
      <div className="grid gap-2">
        <Label htmlFor="board-title">{t("createTitle")}</Label>
        <Input
          id="board-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="board-summary">{t("createSummary")}</Label>
        <Textarea
          id="board-summary"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          maxLength={4_000}
          rows={3}
        />
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {t("cancel")}
          </Button>
        </DialogClose>
        <Button
          type="submit"
          disabled={pending || title.trim().length === 0}
          className="gap-2"
        >
          {pending ? <Spinner /> : null}
          {t("save")}
        </Button>
      </DialogFooter>
    </form>
  )
}

function CandidateSection({
  boardId,
  candidates,
  maxCandidates,
}: {
  boardId: string
  candidates: Candidate[]
  maxCandidates: number
}) {
  const t = useTranslations("Decisions")
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.decisions.read.queryKey({ boardId }),
    })

  const addCandidate = useMutation(
    trpc.decisions.addCandidate.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: (error) =>
        // The picker already hides what is on the board, so this fires for the
        // clicks it cannot know about: two clicks before the first one refills
        // the query, or the same board open in two tabs. The server's prose is
        // written for logs; the reader gets the one sentence that says what to
        // do next.
        toast.error(
          error.data?.appCode === ERROR_CODES.duplicateCandidate
            ? t("duplicateCandidate")
            : error.message
        ),
    })
  )

  const updateCandidate = useMutation(
    trpc.decisions.updateCandidate.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: (error) => toast.error(error.message),
    })
  )

  const removeCandidate = useMutation(
    trpc.decisions.removeCandidate.mutationOptions({
      onSuccess: () => void invalidate(),
      onError: (error) => toast.error(error.message),
    })
  )

  const full = candidates.length >= maxCandidates

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("candidatesTitle")}</CardTitle>
        <CardDescription>{t("candidatesDescription")}</CardDescription>
        <CardAction>
          <Badge variant={full ? "outline" : "secondary"}>
            {t("candidatesCount", {
              count: candidates.length,
              max: maxCandidates,
            })}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* Why these numbers are the only ones on the page. A reader who assumes
            they track the repository will read a stale board as a live one, and
            that is precisely the mistake this tool exists to prevent. */}
        <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          <IconInfoCircle className="mt-0.5 size-4 shrink-0" />
          {t("frozenHint")}
        </p>

        {candidates.length === 0 ? (
          <Empty className="border border-dashed border-border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconGitCompare />
              </EmptyMedia>
              <EmptyTitle>{t("emptyBoardTitle")}</EmptyTitle>
              <EmptyDescription>{t("emptyBoardDescription")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
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
          addedRepoIds={candidates.map((candidate) => candidate.repoId)}
          onPick={(repoId) => addCandidate.mutate({ boardId, repoId })}
        />
      </CardContent>
    </Card>
  )
}

function OutcomeSection({
  row,
  pending,
  onSubmit,
}: {
  row: Board
  pending: boolean
  onSubmit: (outcome: string) => void
}) {
  const t = useTranslations("Decisions")
  const formats = useFormats()
  const [outcome, setOutcome] = React.useState("")

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("outcomeTitle")}</CardTitle>
        <CardDescription>{t("outcomeDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {row.outcome ? (
          <div className="grid gap-1 rounded-lg border border-border p-3">
            <span className="text-xs text-muted-foreground">
              {t("recordedOutcome")}
            </span>
            <p className="text-sm break-words whitespace-pre-wrap">
              {row.outcome}
            </p>
            {row.decidedAt ? (
              <span className="text-xs text-muted-foreground">
                {t("decidedAt")} {formats.dateTime(row.decidedAt)}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noOutcome")}</p>
        )}

        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (outcome.trim().length === 0 || pending) return
            onSubmit(outcome.trim())
            setOutcome("")
          }}
        >
          <Label htmlFor="decision-outcome">
            {row.outcome ? t("outcomeReplace") : t("outcome")}
          </Label>
          <Textarea
            id="decision-outcome"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
            placeholder={t("outcomePlaceholder")}
            maxLength={4_000}
            rows={3}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              size="sm"
              disabled={pending || outcome.trim().length === 0}
              className="gap-2"
            >
              {pending ? <Spinner /> : null}
              {row.outcome ? t("outcomeReplace") : t("decide")}
            </Button>
            {row.outcome ? (
              <span className="text-xs text-muted-foreground">
                {t("outcomeReplaceHint")}
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
  candidate: Candidate
  onVerdict: (verdict: Verdict) => void
  onNote: (note: string | null) => void
  onRemove: () => void
}) {
  const t = useTranslations("Decisions")
  const formats = useFormats()
  const [note, setNote] = React.useState(candidate.note ?? "")

  return (
    <div className="grid gap-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <LocaleLink
          href={`/projects/${candidate.owner}/${candidate.name}` as never}
          className="text-sm font-medium hover:underline"
        >
          {candidate.owner}/{candidate.name}
        </LocaleLink>
        <span className="text-xs text-muted-foreground">
          {t("frozenAt", { date: formats.dateTime(candidate.createdAt) })}
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
          <RemoveCandidateButton onRemove={onRemove} />
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

/**
 * Removing a candidate is confirmed rather than immediate.
 *
 * The row's note and its frozen vitals are part of the record, and both go with
 * it — so the one irreversible action on the page is also the one that used to
 * fire on a single stray click next to a dropdown.
 */
function RemoveCandidateButton({ onRemove }: { onRemove: () => void }) {
  const t = useTranslations("Decisions")

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost">
          <IconTrash className="size-4" />
          <span className="sr-only">{t("remove")}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("removeTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("removeDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onRemove}>
            {t("remove")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function CandidatePicker({
  disabled,
  hint,
  pending,
  addedRepoIds,
  onPick,
}: {
  disabled: boolean
  hint: string
  pending: boolean
  addedRepoIds: string[]
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

  // A repository already on the board is dropped from the results rather than
  // shown greyed out: it cannot be added, so a row the reader cannot click is
  // only there to be clicked. Hiding it silently would be worse, though — a
  // search that finds nothing must say *why*, so when every match is already on
  // the board the picker says that instead of showing an empty result.
  const added = new Set(addedRepoIds)
  const matches = results.data ?? []
  const addable = matches.filter((repo) => !added.has(repo.id))
  const everyMatchAdded = matches.length > 0 && addable.length === 0

  return (
    <div className="grid gap-2 border-t border-border pt-4">
      <Label htmlFor="candidate-search">{t("addCandidateTitle")}</Label>
      <Input
        id="candidate-search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder={t("addCandidate")}
        maxLength={200}
        disabled={disabled}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
      {addable.length > 0 ? (
        <ul className="grid gap-1">
          {addable.slice(0, 6).map((repo) => (
            <li key={repo.id}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                disabled={pending}
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
      {everyMatchAdded ? (
        <p className="text-xs text-muted-foreground">{t("allAdded")}</p>
      ) : null}
    </div>
  )
}

/** A label above its value, the layout every metadata block on this page uses. */
function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  )
}
