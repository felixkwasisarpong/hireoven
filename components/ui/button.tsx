import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-transparent text-sm font-semibold tracking-[-0.01em] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:translate-y-px",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_1px_0_rgba(0,0,0,0.06),0_2px_8px_rgba(255,92,24,0.22)] hover:bg-primary-hover hover:shadow-[0_1px_0_rgba(0,0,0,0.08),0_4px_14px_rgba(255,92,24,0.28)]",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_1px_0_rgba(0,0,0,0.06)] hover:bg-destructive/92",
        outline:
          "border-border bg-surface text-muted-foreground shadow-[0_1px_0_rgba(15,23,42,0.04)] hover:border-border hover:bg-surface-alt hover:text-strong",
        secondary:
          "bg-secondary text-secondary-foreground shadow-[0_1px_0_rgba(15,23,42,0.04)] hover:bg-secondary/88",
        ghost:
          "border-transparent text-muted-foreground shadow-none hover:bg-surface-alt hover:text-strong",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3.5 text-[13px]",
        lg: "h-11 rounded-lg px-6 text-[15px]",
        icon: "h-10 w-10 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
