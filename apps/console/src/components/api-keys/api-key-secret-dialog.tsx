/**
 * The one-time plaintext display.
 *
 * Its whole reason to exist is that the plaintext cannot be retrieved later, so
 * this dialog has to make the reader *do* something before dismissing it: the
 * copy button, and a checkbox that has to be ticked. That is not a nudge, it is
 * the only mechanism — a key that scrolls past unread is a key that has to be
 * revoked and reissued.
 *
 * So the dialog cannot be closed by clicking outside or pressing Escape while
 * the acknowledgement is unticked. `onInteractOutside` and `onEscapeKeyDown` are
 * cancelled rather than the dialog being modal-with-no-escape: leaving `modal`
 * on keeps the backdrop and the focus trap, which are what actually enforce the
 * copy, and cancelling the two dismiss gestures removes only the ways to lose the
 * value by accident.
 */
"use client"

import * as React from "react"
import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Label } from "@workspace/ui/components/label"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { IconAlertTriangle, IconCheck, IconCopy } from "@tabler/icons-react"

export function ApiKeySecretDialog({
  secret,
  open,
  onAcknowledged,
}: {
  /** The full `mcp_radar_<prefix>_<secret>`. */
  secret: string
  open: boolean
  /**
   * Called when the reader confirms they have the key. The parent closes the
   * dialog and re-renders the list — the key is already in the database either
   * way, so this is purely the "I have taken note of it" signal.
   */
  onAcknowledged: () => void
}) {
  const [stored, setStored] = React.useState(false)

  // The body is keyed by `secret` rather than reset from an effect. An effect
  // would have to fire on every `open` transition, and the rule about not setting
  // state in effects is really a rule about *that*: it costs a second render pass
  // and leaves the previous key's "I have saved this" ticked for one frame --
  // which is exactly the state that silently loses a key. A `key` restarts the
  // body instead, with no intermediate frame and no effect.
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Only a deliberate close from inside is honoured; see the file header.
        if (!next && !stored) return
        if (!next) onAcknowledged()
      }}
    >
      <DialogContent
        className="sm:max-w-lg"
        onInteractOutside={(event) => {
          if (!stored) event.preventDefault()
        }}
        onEscapeKeyDown={(event) => {
          if (!stored) event.preventDefault()
        }}
      >
        <SecretBody
          key={secret}
          secret={secret}
          stored={stored}
          onStoredChange={setStored}
          onAcknowledged={onAcknowledged}
        />
      </DialogContent>
    </Dialog>
  )
}

/** Split out so `key={secret}` can remount it -- see the comment above. */
function SecretBody({
  secret,
  stored,
  onStoredChange,
  onAcknowledged,
}: {
  secret: string
  stored: boolean
  onStoredChange: (value: boolean) => void
  onAcknowledged: () => void
}) {
  const t = useTranslations("ApiKeys")
  const [copied, setCopied] = React.useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
    } catch {
      // A clipboard write can fail on an insecure origin or when the document
      // is not focused. The field is selectable either way, and ticking the box
      // still works, so this is a lost convenience rather than a dead end — but
      // it must not read as success, hence no `setCopied`.
      setCopied(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("secretTitle")}</DialogTitle>
        <DialogDescription>{t("secretWarning")}</DialogDescription>
      </DialogHeader>

      <Alert variant="destructive">
        <IconAlertTriangle className="size-4" />
        <AlertTitle>{t("secretTitle")}</AlertTitle>
        <AlertDescription>{t("secretWarning")}</AlertDescription>
      </Alert>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <code className="block w-full overflow-x-auto rounded-md bg-muted p-3 font-mono text-sm break-all select-all">
            {secret}
          </code>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={copy}
            aria-label={copied ? t("copied") : t("copy")}
          >
            {copied ? (
              <IconCheck className="size-4" />
            ) : (
              <IconCopy className="size-4" />
            )}
          </Button>
        </div>
        {copied ? (
          <p className="text-xs text-muted-foreground">{t("copied")}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="api-key-stored"
          checked={stored}
          onCheckedChange={(value) => onStoredChange(value === true)}
        />
        <Label htmlFor="api-key-stored" className="text-sm font-normal">
          {t("secretStored")}
        </Label>
      </div>

      <DialogFooter>
        <Button type="button" onClick={onAcknowledged} disabled={!stored}>
          {t("copied")}
        </Button>
      </DialogFooter>
    </>
  )
}
