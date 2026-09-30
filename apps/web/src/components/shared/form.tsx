'use client'

import * as React from 'react'
import { Label } from '@workspace/ui/components/label'
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form'
import { cn } from '@/lib/utils'

/**
 * react-hook-form glue for the classic shadcn `Form*` API.
 *
 * `@workspace/ui` ships the shadcn v4 `field` family, which has no `Form*`
 * series, and the ported blog admin plus the contact form both expect the
 * classic API. This is a direct port of that implementation, so callers'
 * JSX needs no changes.
 *
 * It lives in the app rather than `@workspace/ui` because `react-hook-form` is
 * an app dependency, not a dependency of the shared UI package.
 *
 * One deviation from the classic implementation: `FormControl` merges props
 * with `cloneElement` instead of `Slot`. `@radix-ui/react-slot` / `radix-ui`
 * do not resolve from `apps/web` under pnpm's strict dependency layout, and
 * adding a dependency is not worth it here. React 19 treats `ref` as a normal
 * prop, so passing it through `cloneElement` is safe.
 */

const Form = FormProvider

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName
}

const FormFieldContext = React.createContext<FormFieldContextValue>({} as FormFieldContextValue)

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => (
  <FormFieldContext.Provider value={{ name: props.name }}>
    <Controller {...props} />
  </FormFieldContext.Provider>
)

type FormItemContextValue = {
  id: string
}

const FormItemContext = React.createContext<FormItemContextValue>({} as FormItemContextValue)

const useFormField = () => {
  const fieldContext = React.useContext(FormFieldContext)
  const itemContext = React.useContext(FormItemContext)
  const { getFieldState } = useFormContext()
  const formState = useFormState({ name: fieldContext.name })
  const fieldState = getFieldState(fieldContext.name, formState)

  if (!fieldContext) {
    throw new Error('useFormField should be used within <FormField>')
  }

  const { id } = itemContext

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  }
}

const FormItem = React.forwardRef<HTMLDivElement, React.ComponentProps<'div'>>(
  ({ className, ...props }, ref) => {
    const id = React.useId()

    return (
      <FormItemContext.Provider value={{ id }}>
        <div ref={ref} data-slot='form-item' className={cn('grid gap-2', className)} {...props} />
      </FormItemContext.Provider>
    )
  }
)
FormItem.displayName = 'FormItem'

const FormLabel = React.forwardRef<
  React.ComponentRef<typeof Label>,
  React.ComponentProps<typeof Label>
>(({ className, ...props }, ref) => {
  const { error, formItemId } = useFormField()

  return (
    <Label
      ref={ref}
      data-slot='form-label'
      data-error={!!error}
      className={cn('data-[error=true]:text-destructive', className)}
      htmlFor={formItemId}
      {...props}
    />
  )
})
FormLabel.displayName = 'FormLabel'

const FormControl = ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField()

  if (!React.isValidElement(children)) {
    return null
  }

  return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
    id: formItemId,
    'aria-describedby': error ? `${formDescriptionId} ${formMessageId}` : formDescriptionId,
    'aria-invalid': !!error,
    ...props,
  })
}

const FormDescription = React.forwardRef<HTMLParagraphElement, React.ComponentProps<'p'>>(
  ({ className, ...props }, ref) => {
    const { formDescriptionId } = useFormField()

    return (
      <p
        ref={ref}
        data-slot='form-description'
        id={formDescriptionId}
        className={cn('text-muted-foreground text-sm', className)}
        {...props}
      />
    )
  }
)
FormDescription.displayName = 'FormDescription'

const FormMessage = React.forwardRef<HTMLParagraphElement, React.ComponentProps<'p'>>(
  ({ className, children, ...props }, ref) => {
    const { error, formMessageId } = useFormField()
    const body = error ? String(error?.message ?? '') : children

    if (!body) {
      return null
    }

    return (
      <p
        ref={ref}
        data-slot='form-message'
        id={formMessageId}
        className={cn('text-destructive text-sm', className)}
        {...props}
      >
        {body}
      </p>
    )
  }
)
FormMessage.displayName = 'FormMessage'

export { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage, useFormField }
