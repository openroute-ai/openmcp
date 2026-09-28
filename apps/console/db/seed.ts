import { config } from "dotenv"
import { count } from "drizzle-orm"

config({ path: "../../.env" })

const SECTION_TYPES = [
  "Cover page",
  "Table of contents",
  "Table of figures",
  "Table of authorities",
  "Preface",
  "Acknowledgment page",
  "Abstract page",
  "Introduction",
  "Background",
  "Methodology",
] as const

const REVIEWERS = ["Eddie Lake", "Jamik Tashpulatov", "Courtney Henry"] as const

const STATUSES = ["In Process", "Done", "Cancled", "Rejected"] as const

function at<T>(items: readonly T[], index: number): T {
  const item = items[index % items.length]
  if (item === undefined) {
    throw new Error("unexpected empty list")
  }
  return item
}

async function main() {
  if (!process.env.CONSOLE_DATABASE_URL) {
    throw new Error("CONSOLE_DATABASE_URL is required to run the seed script")
  }

  const { db } = await import("./client")
  const { sections, traffic } = await import("./schema")

  const [{ total: sectionCount } = { total: 0 }] = await db
    .select({ total: count() })
    .from(sections)

  if (sectionCount === 0) {
    await db.insert(sections).values(
      Array.from({ length: 60 }, (_, index) => {
        const type = at(SECTION_TYPES, index)
        const group = Math.floor(index / SECTION_TYPES.length) + 1

        return {
          header: `${type} ${group}`,
          type,
          status: at(STATUSES, index),
          target: 5 + ((index * 7) % 30),
          limit: 2 + ((index * 3) % 10),
          reviewer: at(REVIEWERS, index),
          position: index,
        }
      })
    )
    console.log("seeded 60 sections")
  } else {
    console.log(`sections already present (${sectionCount}), skipping`)
  }

  const [{ total: trafficCount } = { total: 0 }] = await db
    .select({ total: count() })
    .from(traffic)

  if (trafficCount === 0) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const rows = Array.from({ length: 365 }, (_, index) => {
      const offset = 364 - index
      const day = new Date(today)
      day.setDate(day.getDate() - offset)

      const wave = Math.sin(offset / 7) * 60
      const growth = index * 0.25

      return {
        day: day.toISOString().slice(0, 10),
        desktop: Math.round(220 + wave + growth + ((offset * 13) % 40)),
        mobile: Math.round(150 - wave + growth + ((offset * 7) % 30)),
      }
    })

    await db.insert(traffic).values(rows)
    console.log(`seeded ${rows.length} traffic days`)
  } else {
    console.log(`traffic already present (${trafficCount}), skipping`)
  }

  const [{ total: finalCount } = { total: 0 }] = await db
    .select({ total: count() })
    .from(sections)

  console.log(`done: ${finalCount} sections total`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
