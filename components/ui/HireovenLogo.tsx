import Image from "next/image"
import { cn } from "@/lib/utils"

const LOGO_ASSETS = {
  mark: {
    src: "/brand/hireoven-icon.svg",
    width: 512,
    height: 512,
    alt: "Hireoven icon",
  },
  wordmark: {
    src: "/brand/hireoven-wordmark-transparent.png",
    width: 900,
    height: 180,
    alt: "Hireoven wordmark",
  },
  header: {
    src: "/brand/hireoven-logo-header-transparent.png",
    width: 640,
    height: 160,
    alt: "Hireoven",
  },
  full: {
    src: "/brand/hireoven-logo-full-transparent.png",
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
