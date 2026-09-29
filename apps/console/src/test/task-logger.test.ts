import { describe, expect, it } from "vitest"
import { createBufferingLogger } from "@/lib/tasks/runner"
import { describeError } from "@/lib/github/service/task"

describe("describeError", () => {
  it("prefers the stack for an Error", () => {
    expect(describeError(new Error("boom"))).toContain("boom")
  })

  it("stringifies anything else", () => {
    expect(describeError("plain")).toBe("plain")
    expect(describeError(42)).toBe("42")
  })
})

describe("createBufferingLogger", () => {
  it("keeps recent lines and drops the oldest when full", () => {
    const logger = createBufferingLogger(200)
    for (let index = 0; index < 50; index += 1) {
      logger.info(`line ${index}`)
    }

    const text = logger.text()
    expect(text).toContain("line 49")
    // A run that logs heavily should keep its recent context, not its opening.
    expect(text).not.toContain("line 0 ")
    expect(text.length).toBeLessThan(400)
  })

  it("does not throw on a circular argument", () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    const logger = createBufferingLogger()
    expect(() => logger.info("circular", circular)).not.toThrow()
    expect(logger.text()).toContain("circular")
  })

  it("records warnings and errors with their level", () => {
    const logger = createBufferingLogger()
    logger.warn("slower than expected")
    logger.error("upstream failed")

    expect(logger.text()).toContain("WARN slower than expected")
    expect(logger.text()).toContain("ERROR upstream failed")
  })
})
