import Image from "next/image"
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared"
import { appName, gitConfig } from "./shared"

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <Image
            src="/logo.svg"
            alt=""
            width={24}
            height={24}
            className="size-6"
            priority
          />
          <span className="font-medium">{appName}</span>
        </>
      ),
      transparentMode: "top",
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  }
}
