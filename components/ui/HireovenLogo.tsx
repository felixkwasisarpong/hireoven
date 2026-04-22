import Image from "next/image"
import { cn } from "@/lib/utils"

/* Static files live in /public/brand - keep paths aligned with committed assets. */
const LOGO_ASSETS = {
  mark: {
    src: "/brand/hireoven-icon.svg",
    width: 512,
    height: 512,
    alt: "Hireoven icon",
  },
  wordmark: {
    src: "/brand/hireoven-logo.svg",
    width: 1200,
    height: 300,
    alt: "Hireoven",
  },
  header: {
    src: "/brand/hireoven-logo.svg",
    width: 1200,
    height: 300,
    alt: "Hireoven",
  },
  full: {
    src: "/brand/hireoven-logo.svg",
    width: 1200,
    height: 300,
    alt: "Hireoven",
  },
} as const

export type HireovenLogoVariant = keyof typeof LOGO_ASSETS

type HireovenLogoProps = {
  alt?: string
  className?: string
  priority?: boolean
  variant?: HireovenLogoVariant
}

export default function HireovenLogo({
  alt,
  className,
  priority = false,
  variant = "header",
}: HireovenLogoProps) {
  const asset = LOGO_ASSETS[variant]

  return (
    <Image
      alt={alt ?? asset.alt}
      className={cn("h-auto w-auto", className)}
      height={asset.height}
      priority={priority}
      src={asset.src}
      width={asset.width}
    />
  )
}
