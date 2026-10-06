"use client"

import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
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
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import { IconGitCompare } from "@tabler/icons-react"
import { useLocaleRouter } from "@/i18n/navigation"
import { useTRPC } from "@/lib/trpc/client"

/**
 * 新建一份工作台。
 *
 * 之前这个表单就摆在页面顶上，输入框上方没有一个字说明「这是什么、要拿来干什么」，
 * 于是第一眼看到的是两个输入框而不是一次选型。这里补三件事：弹窗标题说明它是什么、
 * 每个字段下方写清为什么要填、创建成功后直接进入详情页而不是回到列表。
 *
 * 只有标题是必填。背景可以事后补，而一个必填的「背景」会让人为了过这一关而写一段
 * 以后不会读的废话——那是这份记录最不需要的东西。
 */
export function DecisionCreateDialog({
  trigger,
}: {
  trigger?: React.ReactNode
}) {
  const t = useTranslations("Decisions")
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const router = useLocaleRouter()

  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [summary, setSummary] = React.useState("")

  const trimmedTitle = title.trim()

  const reset = () => {
    setTitle("")
    setSummary("")
  }

  const create = useMutation(
    trpc.decisions.create.mutationOptions({
      onSuccess: (board) => {
        void queryClient.invalidateQueries({
          queryKey: trpc.decisions.list.queryKey(),
        })

        toast.success(t("created", { title: board.title }))

        setOpen(false)
        reset()

        // 一份工作台存在的意义在于往里加候选，而候选只在详情页上。所以关掉弹窗回到
        // 列表，等于把刚建的东西又藏回一堆行里——那正是刚才那句「我不知道该做什么」
        // 的另一种说法。
        router.push(`/console/decisions/${board.id}`)
      },
      onError: (error) => {
        toast.error(t("createFailed"), { description: error.message })
      },
    })
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <IconGitCompare />
            {t("create")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("createDialogTitle")}</DialogTitle>
          <DialogDescription>{t("createDialogDescription")}</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!trimmedTitle || create.isPending) return
            create.mutate({
              title: trimmedTitle,
              summary: summary.trim() || null,
            })
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="decision-title">{t("createTitle")}</Label>
            <Input
              id="decision-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t("createTitlePlaceholder")}
              maxLength={200}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {t("createTitleHint")}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="decision-summary">{t("createSummary")}</Label>
            <Textarea
              id="decision-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder={t("createSummaryPlaceholder")}
              maxLength={4_000}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              {t("createSummaryHint")}
            </p>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("cancel")}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!trimmedTitle || create.isPending}
              className="gap-2"
            >
              {create.isPending ? <Spinner /> : null}
              {t("createSubmit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
